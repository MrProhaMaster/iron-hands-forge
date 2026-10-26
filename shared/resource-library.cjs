'use strict';
const fs = require('node:fs');
const path = require('node:path');

const SOURCE_DIRECTORY = 'assets/characters/SM2-retail-constructors/source-v5';
const VALIDATIONS = ['transformValidation', 'restSkinValidation', 'weightPackingValidation', 'skinProfileWeldValidation'];
const jsonCache = new Map();
const glbCache = new Map();

function fileInfo(file) {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() && stat.size > 0 ? {bytes: stat.size, revision: stat.size + ':' + stat.mtimeMs} : null;
  } catch { return null; }
}

// Only small metadata is parsed. Large model payloads are never read or hashed for a health request.
function readJSON(file, fallback = null) {
  const info = fileInfo(file);
  if (!info) { jsonCache.delete(file); return fallback; }
  const cached = jsonCache.get(file);
  if (cached?.revision === info.revision) return cached.value ?? fallback;
  let value = null;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { }
  if (jsonCache.size > 256) jsonCache.clear();
  jsonCache.set(file, {revision: info.revision, value});
  return value ?? fallback;
}

function containedFile(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\0') ||
      path.isAbsolute(relative) || path.win32.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) return null;
  const file = path.resolve(root, relative);
  return file.startsWith(root + path.sep) ? file : null;
}

function validGLB(file) {
  const info = fileInfo(file);
  if (!info) { glbCache.delete(file); return false; }
  const cached = glbCache.get(file);
  if (cached?.revision === info.revision) return cached.valid;
  let valid = false, handle;
  try {
    const header = Buffer.alloc(12);
    handle = fs.openSync(file, 'r');
    valid = info.bytes >= 28 && fs.readSync(handle, header, 0, 12, 0) === 12 &&
      header.readUInt32LE(0) === 0x46546c67 && header.readUInt32LE(4) === 2 && header.readUInt32LE(8) === info.bytes;
  } catch { } finally { if (handle !== undefined) fs.closeSync(handle); }
  if (glbCache.size > 64) glbCache.clear();
  glbCache.set(file, {revision: info.revision, valid});
  return valid;
}

function inspectResourceLibrary(dataRoot, motionBindings = {}) {
  dataRoot = path.resolve(dataRoot);
  const missing = new Set(), issues = [];
  const readRequired = relative => {
    const value = readJSON(path.join(dataRoot, relative));
    if (!value || typeof value !== 'object' || Array.isArray(value)) missing.add(relative);
    return value;
  };
  const armor = readRequired('production/roster/armor-options.json') || {classes: []};
  const paints = readRequired('production/roster/armor-paints.json');
  const manifest = readRequired(SOURCE_DIRECTORY + '/manifest.json') || {assets: []};
  const classes = Array.isArray(armor.classes) ? armor.classes : [];
  if (!Array.isArray(armor.classes) || !classes.length) issues.push('The armour catalogue is empty or invalid.');
  if (!paints || !Array.isArray(paints.colors)) issues.push('The armour paint catalogue is missing or invalid.');
  if (!Array.isArray(manifest.assets)) issues.push('The model manifest is invalid.');
  const records = Array.isArray(manifest.assets) ? manifest.assets : [];
  const assets = [];
  for (const record of records) {
    if (!record || !VALIDATIONS.every(key => record[key] === 'passed') || !/^[A-Za-z0-9_]+$/.test(record.asset || '')) continue;
    const relative = SOURCE_DIRECTORY + '/' + record.asset;
    const meta = readJSON(path.join(dataRoot, relative + '.json'));
    const modelReady = validGLB(path.join(dataRoot, relative + '.glb'));
    if (!modelReady) missing.add(relative + '.glb');
    const metadataReady = !!meta && Array.isArray(meta.meshes) && meta.meshes.length > 0;
    if (!metadataReady) missing.add(relative + '.json');
    if (modelReady && metadataReady) assets.push(record);
  }
  const availableAssets = new Set(assets.map(asset => asset.asset));
  const readyClasses = classes.filter(c => c.available && availableAssets.has(c.tpl));
  const configured = issues.length === 0 && readyClasses.length > 0;

  const requiredClips = new Set();
  for (const c of readyClasses) {
    const binding = motionBindings.classes?.[c.id];
    if (binding?.status !== 'validated' || binding.asset !== c.tpl) continue;
    for (const stances of Object.values(binding.clipIds || {})) {
      for (const clipId of Object.values(stances || {})) {
        const output = motionBindings.clips?.[clipId]?.output;
        if (typeof output === 'string') requiredClips.add('assets/animations/' + output);
        else issues.push('A preview motion binding is incomplete: ' + c.id);
      }
    }
  }
  if (requiredClips.size) {
    const motionManifest = readRequired('assets/animations/motion-manifest.json');
    if (!motionManifest || !Array.isArray(motionManifest.clips)) issues.push('The motion manifest is missing or invalid.');
    for (const relative of requiredClips) {
      const file = containedFile(dataRoot, relative);
      const clip = file && readJSON(file);
      if (!clip || !Array.isArray(clip.channels) || !clip.channels.length || !(clip.frameCount >= 2) || !(clip.duration > 0)) missing.add(relative);
    }
  }

  const bundlePath = path.join(dataRoot, 'bundle-manifest.json');
  const bundled = fs.existsSync(bundlePath);
  const bundle = bundled ? readJSON(bundlePath) : null;
  let bundleReady = true;
  if (bundled) {
    if (bundle?.schema !== 'iron-hands-forge-resource-bundle' || bundle.version !== 1 ||
        !Array.isArray(bundle.files) || !bundle.files.length || !Array.isArray(bundle.classIds) || !bundle.classIds.length) {
      issues.push('The included resource bundle manifest is invalid.');
      bundleReady = false;
    } else {
      for (const entry of bundle.files) {
        const file = containedFile(dataRoot, entry?.path);
        const info = file && fileInfo(file);
        if (!info || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 || info.bytes !== entry.bytes) {
          missing.add(typeof entry?.path === 'string' ? entry.path : 'bundle-manifest.json');
          bundleReady = false;
        }
      }
      for (const id of bundle.classIds) {
        if (!readyClasses.some(c => c.id === id)) {
          issues.push('An included armour class is unavailable: ' + id);
          bundleReady = false;
        }
      }
    }
  }
  // A legacy partial library may still supply useful static armour even without every preview clip.
  const resourcesReady = configured && issues.length === 0 && bundleReady &&
    (bundled ? missing.size === 0 : [...requiredClips, 'assets/animations/motion-manifest.json'].every(relative => !missing.has(relative)));
  return {dataRoot, armor, manifest, assets, configured, resourcesReady, bundled,
    classIds: readyClasses.map(c => c.id), missingFiles: [...missing], issues};
}

function resolveDataRoot({appRoot, stateRoot, dataRoot, motionBindings = {}}) {
  appRoot = path.resolve(appRoot);
  const bundledRoot = path.join(appRoot, 'data');
  if (dataRoot !== undefined && dataRoot !== null) return path.resolve(appRoot, dataRoot);
  const config = readJSON(path.join(appRoot, 'forge.config.json'), {});
  const settings = readJSON(path.join(stateRoot, 'settings.json'), {});
  for (const value of [config.dataRoot, settings.dataRoot]) {
    if (typeof value !== 'string' || !value.trim() || value.includes('\0')) continue;
    const candidate = path.resolve(appRoot, value);
    const library = inspectResourceLibrary(candidate, motionBindings);
    if (library.configured && (!library.bundled || library.resourcesReady)) return candidate;
  }
  return bundledRoot;
}

module.exports = {inspectResourceLibrary, resolveDataRoot, readJSON};
