import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {inspectResourceLibrary, resolveDataRoot} = require('../shared/resource-library.cjs');
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bindings = JSON.parse(fs.readFileSync(path.join(project, 'shared/motion-bindings.json'), 'utf8'));
const source = 'assets/characters/SM2-retail-constructors/source-v5';
const asset = 'cc_sm_constructor_soldier';
const classId = 'PVE_PVP_SOLDIER';
const writeJSON = (file, value) => {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify(value));
};

function workspace(t) {
  const build = path.join(project, '.build');
  fs.mkdirSync(build, {recursive: true});
  const base = fs.mkdtempSync(path.join(build, 'startup-resources-'));
  t.after(() => {
    assert.equal(path.dirname(base), build);
    fs.rmSync(base, {recursive: true, force: true});
  });
  return base;
}

function library(root, {bundle = false} = {}) {
  writeJSON(path.join(root, 'production/roster/armor-options.json'), {
    classes: [{id: classId, available: true, tpl: asset, slots: [{id: 'HELMET', options: [{id: 'fixture', meshes: ['fixture'], resolvedObjectIds: ['fixture-object']}]}]}]
  });
  writeJSON(path.join(root, 'production/roster/armor-paints.json'), {colors: [{id: 'fixture', rgbTint: [20, 20, 20]}]});
  writeJSON(path.join(root, source, 'manifest.json'), {assets: [{asset,
    transformValidation: 'passed', restSkinValidation: 'passed', weightPackingValidation: 'passed', skinProfileWeldValidation: 'passed'}]});
  writeJSON(path.join(root, source, asset + '.json'), {meshes: [{name: 'fixture', objectId: 'fixture-object'}]});
  const json = Buffer.from('{"asset":{"version":"2.0"}}  ');
  const glb = Buffer.alloc(20 + json.length);
  glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(json.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); json.copy(glb, 20);
  fs.writeFileSync(path.join(root, source, asset + '.glb'), glb);
  const clips = Object.entries(bindings.clips);
  writeJSON(path.join(root, 'assets/animations/motion-manifest.json'), {completed: true, clips: clips.map(([id, clip]) => ({id, output: clip.output}))});
  for (const [, clip] of clips) writeJSON(path.join(root, 'assets/animations', clip.output), {
    frameCount: 2, fps: 1, duration: 1, times: [0, 1], channels: [{name: 'root', positions: [[0, 0, 0], [0, 0, 0]], rotations: [[0, 0, 0, 1], [0, 0, 0, 1]]}]
  });
  if (bundle) {
    const files = [];
    function walk(folder) {
      for (const entry of fs.readdirSync(folder, {withFileTypes: true})) {
        const file = path.join(folder, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (entry.name !== 'bundle-manifest.json') files.push({path: path.relative(root, file).split(path.sep).join('/'),
          bytes: fs.statSync(file).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});
      }
    }
    walk(root);
    writeJSON(path.join(root, 'bundle-manifest.json'), {schema: 'iron-hands-forge-resource-bundle', version: 1, classIds: [classId], files});
  }
  return root;
}

function serverFixture(base) {
  for (const relative of ['app/server.cjs', 'shared/resource-library.cjs', 'shared/left-bionic.cjs', 'shared/motion-bindings.json', 'package.json']) {
    const target = path.join(base, relative);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.copyFileSync(path.join(project, relative), target);
  }
  return require(path.join(base, 'app/server.cjs')).createForgeServer;
}

async function serve(create, options, fn) {
  const server = create(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { return await fn('http://127.0.0.1:' + server.address().port); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const post = (url, value) => fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(value)});

test('bundled library is ready using files, metadata and pinned motion, without external paths', t => {
  const base = workspace(t), data = library(path.join(base, 'data'), {bundle: true});
  const result = inspectResourceLibrary(data, bindings);
  assert.equal(result.configured, true);
  assert.equal(result.resourcesReady, true);
  assert.deepEqual(result.classIds, [classId]);
  assert.deepEqual(result.missingFiles, []);
  assert.equal(resolveDataRoot({appRoot: base, stateRoot: path.join(base, 'state'), motionBindings: bindings}), data);
});

test('validated flags cannot make an absent or malformed GLB ready', t => {
  const base = workspace(t), data = library(path.join(base, 'data'));
  const file = path.join(data, source, asset + '.glb');
  fs.unlinkSync(file);
  let result = inspectResourceLibrary(data, bindings);
  assert.equal(result.configured, false); assert.equal(result.resourcesReady, false);
  assert.ok(result.missingFiles.includes(source + '/' + asset + '.glb'));
  fs.writeFileSync(file, Buffer.alloc(64));
  result = inspectResourceLibrary(data, bindings);
  assert.equal(result.configured, false); assert.equal(result.assets.length, 0);
});

test('missing mesh metadata makes the asset unavailable', t => {
  const base = workspace(t), data = library(path.join(base, 'data'));
  fs.unlinkSync(path.join(data, source, asset + '.json'));
  const result = inspectResourceLibrary(data, bindings);
  assert.equal(result.configured, false); assert.equal(result.resourcesReady, false);
  assert.deepEqual(result.assets, []);
});

test('a missing motion prevents readiness while a legacy library can still preview static armour', t => {
  const base = workspace(t), data = library(path.join(base, 'data'));
  const clip = 'assets/animations/' + bindings.clips.walk_unarmed.output;
  fs.unlinkSync(path.join(data, clip));
  const result = inspectResourceLibrary(data, bindings);
  assert.equal(result.configured, true); assert.equal(result.resourcesReady, false);
  assert.ok(result.missingFiles.includes(clip));
});

test('strict bundled inventory notices a truncated file without hashing model payloads', t => {
  const base = workspace(t), data = library(path.join(base, 'data'), {bundle: true});
  fs.appendFileSync(path.join(data, source, asset + '.json'), ' ');
  const result = inspectResourceLibrary(data, bindings);
  assert.equal(result.resourcesReady, false);
  assert.ok(result.missingFiles.includes(source + '/' + asset + '.json'));
});

test('stale saved and configured libraries fall back without creating their old directories', t => {
  const base = workspace(t), data = library(path.join(base, 'data'), {bundle: true}), stateRoot = path.join(base, 'state');
  writeJSON(path.join(stateRoot, 'settings.json'), {dataRoot: path.join(base, 'old saved library')});
  writeJSON(path.join(base, 'forge.config.json'), {dataRoot: path.join(base, 'old configured library')});
  assert.equal(resolveDataRoot({appRoot: base, stateRoot, motionBindings: bindings}), data);
  assert.equal(fs.existsSync(path.join(base, 'old saved library')), false);
  assert.equal(fs.existsSync(path.join(base, 'old configured library')), false);
});

test('valid relative saved/config overrides resolve against the application, not the shell directory', t => {
  const base = workspace(t), stateRoot = path.join(base, 'state');
  library(path.join(base, 'data'), {bundle: true});
  const saved = library(path.join(base, 'saved library'));
  const configured = library(path.join(base, 'configured library'));
  writeJSON(path.join(stateRoot, 'settings.json'), {dataRoot: 'saved library'});
  assert.equal(resolveDataRoot({appRoot: base, stateRoot, motionBindings: bindings}), saved);
  writeJSON(path.join(base, 'forge.config.json'), {dataRoot: 'configured library'});
  assert.equal(resolveDataRoot({appRoot: base, stateRoot, motionBindings: bindings}), configured);
});

test('an explicit CLI data path is preserved even when unavailable', t => {
  const base = workspace(t), stateRoot = path.join(base, 'state');
  library(path.join(base, 'data'), {bundle: true});
  assert.equal(resolveDataRoot({appRoot: base, stateRoot, dataRoot: 'intentional override', motionBindings: bindings}), path.join(base, 'intentional override'));
  assert.equal(fs.existsSync(path.join(base, 'intentional override')), false);
});

test('default server starts ready from its own included data and restores it after a custom override', async t => {
  const base = workspace(t), data = library(path.join(base, 'data'), {bundle: true});
  library(path.join(base, 'extra library'));
  const create = serverFixture(base);
  await serve(create, {}, async url => {
    let health = await fetch(url + '/api/health').then(r => r.json());
    assert.equal(health.resourcesReady, true); assert.equal(health.dataRoot, data); assert.equal(health.dataSource, 'bundled');
    let response = await post(url + '/api/settings', {dataRoot: 'extra library'});
    assert.equal(response.status, 200);
    assert.equal((await response.json()).dataRoot, path.join(base, 'extra library'));
    assert.equal(JSON.parse(fs.readFileSync(path.join(base, 'state/settings.json'))).dataRoot, 'extra library');
    response = await post(url + '/api/settings', {useBundled: true});
    assert.equal(response.status, 200);
    health = await fetch(url + '/api/health').then(r => r.json());
    assert.equal(health.resourcesReady, true); assert.equal(health.dataRoot, data);
    const settings = await fetch(url + '/api/settings').then(r => r.json());
    assert.equal(settings.bundledAvailable, true); assert.equal(settings.dataSource, 'bundled');
    assert.equal(JSON.parse(fs.readFileSync(path.join(base, 'state/settings.json'))).dataRoot, 'data');
  });
});

test('server health reports a missing included motion and refuses resetting to an incomplete bundle', async t => {
  const base = workspace(t), data = library(path.join(base, 'data'), {bundle: true});
  const create = serverFixture(base);
  fs.unlinkSync(path.join(data, 'assets/animations', bindings.clips.walk_unarmed.output));
  await serve(create, {}, async url => {
    const health = await fetch(url + '/api/health').then(r => r.json());
    assert.equal(health.resourcesReady, false);
    assert.equal((await post(url + '/api/settings', {useBundled: true})).status, 400);
    assert.equal((await fetch(url + '/api/settings').then(r => r.json())).bundledAvailable, false);
  });
});
