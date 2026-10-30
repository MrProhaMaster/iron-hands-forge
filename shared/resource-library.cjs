'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {loadIronHandsLibrary} = require('./iron-hands-library.cjs');
const {loadAstartesLibrary} = require('./astartes-library.cjs');

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

// Core constructor GLBs use metadata/header checks only; optional Iron Hands payload hashes are cached per file revision.
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


const SERVO_DIRECTORY='assets/customization/servo-arm-v1';
const SERVO_MANIFEST=SERVO_DIRECTORY+'/manifest.json';
const SERVO_CHANNELS=['gun_01_jnt','gun_01_jnt_jiggle','gun_02_jnt','gun_jnt','hand_01_jnt','hand_01_jnt_jiggle','hand_02_jnt','hand_02_jnt_jiggle','hand_03_jnt','hand_03_jnt_jiggle','hand_04_jnt','hand_04_jnt_jiggle','hand_05_jnt','hand_05_jnt_jiggle','hand_06_jnt','hand_06_jnt_jiggle','hand_claw_01_jnt','hand_claw_01_jnt_jiggle','hand_claw_02_jnt','hand_claw_jnt','hand_drill_jnt','hand_index_01_jnt','hand_index_jnt','hand_jnt','hand_jnt_jiggle','hand_pinky_01_jnt','hand_pinky_jnt','hand_thumb_01_jnt','hand_thumb_jnt'];
const SERVO_OPTIONS=['vanity_engineer_common_01','vanity_engineer_mastercrafted_01','vanity_engineer_artificer_01','vanity_engineer_artificer_02','vanity_engineer_relic_01','vanity_engineer_relic_02','vanity_engineer_prestige','vanity_engineer_champion_iron_hands'];
/** Small optional profile inspection without importing Three.js into CJS health checks. */
function inspectServoLibrary(dataRoot){
  const root=path.resolve(dataRoot),directory=path.join(root,SERVO_DIRECTORY),manifestFile=path.join(root,SERVO_MANIFEST);
  if(!fs.existsSync(manifestFile)){
    if(fs.existsSync(directory))throw Error('Servo profile manifest is missing from its prepared directory');
    return{ready:false,profile:null,files:[],manifestPath:SERVO_MANIFEST,revision:'absent'};
  }
  const realRoot=fs.realpathSync(root);
  const regular=relative=>{
    const file=containedFile(root,relative),info=file&&fileInfo(file);
    if(!file||!info)throw Error('Servo profile resource is missing');
    if(!fs.realpathSync(file).startsWith(realRoot+path.sep))throw Error('Servo profile resource link escapes DataRoot');
    return file;
  };
  const manifestBytes=fs.readFileSync(regular(SERVO_MANIFEST)),manifest=JSON.parse(manifestBytes.toString('utf8').replace(/^\uFEFF/,''));
  if(manifest.schema!=='iron-hands-forge-servo-library'||manifest.version!==1||manifest.profile!==SERVO_DIRECTORY+'/default-pose.json'||!Array.isArray(manifest.files)||manifest.files.length!==1)throw Error('Invalid servo profile resource manifest');
  const record=manifest.files[0];
  if(record.path!==manifest.profile||!Number.isSafeInteger(record.bytes)||record.bytes<1||record.bytes>131072||!/^[a-f0-9]{64}$/.test(record.sha256||''))throw Error('Invalid servo profile integrity record');
  const payload=fs.readFileSync(regular(record.path));
  if(payload.length!==record.bytes||require('node:crypto').createHash('sha256').update(payload).digest('hex')!==record.sha256)throw Error('Servo profile checksum mismatch');
  const profile=JSON.parse(payload.toString('utf8').replace(/^\uFEFF/,''));
  if(profile?.schema!=='iron-hands-forge-servo-startup-pose'||profile.version!==1||profile.policy!=='native-startup-pose-original-bind'||profile.source?.clip!=='tacticus_wpn0_idle_mech_arm_intercessor'||!/^[a-f0-9]{64}$/.test(profile.source?.sha256||'')||profile.source.frameIndex!==0||profile.source.retimed!==false)throw Error('Unsupported servo startup profile');
  if(!Array.isArray(profile.channels)||profile.channels.length!==29||new Set(profile.channels.map(c=>c.name)).size!==29||SERVO_CHANNELS.some(name=>!profile.channels.some(c=>c.name===name)))throw Error('Servo profile must contain the verified 29 channels');
  for(const c of profile.channels){
    if(!Array.isArray(c.translation)||c.translation.length!==3||!Array.isArray(c.rotation)||c.rotation.length!==4||[...c.translation,...c.rotation].some(n=>typeof n!=='number'||!Number.isFinite(n))||Math.abs(Math.hypot(...c.rotation)-1)>1e-5)throw Error('Invalid servo startup TRS');
  }
  if(profile.compatibility?.sourceClassId!=='PVE_PVP_ENGINEER'||profile.compatibility.slotId!=='VANITY_3'||!Array.isArray(profile.compatibility.optionIds)||!profile.compatibility.optionIds.length||profile.compatibility.optionIds.some(id=>!SERVO_OPTIONS.includes(id)))throw Error('Unverified servo profile variant policy');
  return{ready:true,profile,files:manifest.files,manifestPath:SERVO_MANIFEST,revision:require('node:crypto').createHash('sha256').update(manifestBytes).update(payload).digest('hex')};
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
  let ironHands;
  try { ironHands = loadIronHandsLibrary(dataRoot); }
  catch (error) {
    ironHands = {ready: false, classes: [], decals: [], textures: {}};
    issues.push('The Iron Hands customization library is incomplete or corrupt: ' + error.message);
  }
  let servo;
  try { servo = inspectServoLibrary(dataRoot); }
  catch (error) {
    servo = {ready: false};
    issues.push('The servo startup library is incomplete or corrupt: ' + error.message);
  }
  let astartes;
  try { astartes = loadAstartesLibrary(dataRoot); }
  catch (error) {
    astartes = {ready:false,profiles:[],models:[],options:[]};
    issues.push('The Astartes customization library is incomplete or corrupt: ' + error.message);
  }
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
  return {dataRoot, armor, manifest, assets, configured, resourcesReady, bundled, ironHandsReady: ironHands.ready, servoPoseReady: servo.ready, astartesReady: astartes.ready, profileClassIds: astartes.profiles.map(p=>p.id),
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

module.exports = {inspectResourceLibrary, resolveDataRoot, readJSON, inspectServoLibrary, SERVO_DIRECTORY, SERVO_MANIFEST};
