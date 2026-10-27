import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {parseOptions, resolvePaths, healthMatches, getHealth, acquireStartupLock} = require('../src/launcher/linux-launcher.cjs');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LAUNCHER = path.join(ROOT, 'src/launcher/linux-launcher.cjs');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), 'forge-linux-test-'));
function cleanup(folder) {
  const target = path.resolve(folder);
  if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('forge-linux-test-')) throw Error('Unsafe test cleanup path');
  fs.rmSync(target, {recursive: true, force: true});
}
const eventually = async predicate => {for (let i = 0; i < 100; i++) {if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 30));} assert.fail('Timed out waiting for launcher state');};
async function freePort() {const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;}
function launch(args, folder, extraEnv = {}, observeInternalTemp = false) {
  const observe = 'const {run,parseOptions}=require(' + JSON.stringify(LAUNCHER) + ');run(parseOptions(process.argv.slice(1)),{stdout:line=>{const ready=JSON.parse(line);ready.internalTemp={TEMP:process.env.TEMP,TMP:process.env.TMP,TMPDIR:process.env.TMPDIR};console.log(JSON.stringify(ready))}}).then(code=>process.exitCode=code).catch(error=>{console.error(error);process.exitCode=1});';
  const command = observeInternalTemp ? ['-e', observe, '--', ...args] : [LAUNCHER, ...args];
  const child = spawn(process.execPath, command, {cwd: os.tmpdir(), windowsHide: true,
    env: {...process.env, XDG_STATE_HOME: path.join(folder, 'xdg state'), XDG_CACHE_HOME: path.join(folder, 'xdg cache'), ...extraEnv}, stdio: ['ignore', 'pipe', 'pipe']});
  let output = '', errors = '';
  child.stdout.on('data', chunk => {output += chunk;}); child.stderr.on('data', chunk => {errors += chunk;});
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({code, signal})));
  return {child, exited, output: () => output, errors: () => errors, ready: () => {
    for (const line of output.split('\n')) {try {const value = JSON.parse(line); if (value.event === 'ready') return value;} catch {}}
    return null;
  }};
}
async function stop(instance, signal = 'SIGTERM') {
  if (instance.child.exitCode === null && instance.child.signalCode === null) instance.child.kill(signal);
  return instance.exited;
}

test('Linux CLI validates port and path values and rejects ambiguous options', () => {
  assert.deepEqual(parseOptions(['--no-browser', '--port', '12001', '--state-root', 'saved builds', '--data-root', 'data']),
    {noBrowser: true, port: 12001, stateRoot: 'saved builds', dataRoot: 'data'});
  for (const args of [['--port', '0'], ['--port', '65536'], ['--port', '1.5'], ['--port', '-1'], ['--state-root'], ['--state-root', '--port'], ['--port', '12', '--port', '13'], ['--unknown']]) assert.throws(() => parseOptions(args));
  assert.equal(parseOptions(['--help']).help, true);
});

test('Linux state and cache follow absolute XDG paths without changing HOME', () => {
  const folder = temporary();
  try {
    const env = {HOME: 'must-not-be-changed', XDG_STATE_HOME: path.join(folder, 'state base'), XDG_CACHE_HOME: path.join(folder, 'cache base')};
    const actual = resolvePaths({}, {appRoot: ROOT, env, home: folder});
    assert.equal(actual.stateRoot, path.join(env.XDG_STATE_HOME, 'iron-hands-forge'));
    assert.ok(actual.cacheRoot.startsWith(path.join(env.XDG_CACHE_HOME, 'iron-hands-forge') + path.sep));
    assert.equal(env.HOME, 'must-not-be-changed');
    const fallback = resolvePaths({}, {appRoot: ROOT, env: {XDG_STATE_HOME: 'relative', XDG_CACHE_HOME: 'relative'}, home: folder});
    assert.equal(fallback.stateRoot, path.join(folder, '.local/state/iron-hands-forge'));
    assert.ok(fallback.cacheRoot.startsWith(path.join(folder, '.cache/iron-hands-forge') + path.sep));
    assert.equal(resolvePaths({stateRoot: 'custom state'}, {appRoot: ROOT, env, home: folder}).stateRoot, path.join(ROOT, 'custom state'));
  } finally {cleanup(folder);}
});

test('instance reuse requires exact identity, version, roots and Linux path case', () => {
  const expected = {version: VERSION, appRoot: '/tmp/Forge', dataRoot: '/tmp/Forge/data', stateRoot: '/tmp/state'};
  const health = {appId: 'iron-hands-forge', ready: true, ...expected};
  assert.equal(healthMatches(health, expected), true);
  for (const patch of [{appId: 'another-app'}, {version: 'old'}, {ready: false}, {appRoot: '/tmp/forge'}, {dataRoot: '/other/data'}, {stateRoot: '/other/state'}, {dataRoot: null}])
    assert.equal(healthMatches({...health, ...patch}, expected), false);
});

test('health probe bounds response size and handles non-Forge and stalled services', async () => {
  let mode = 'oversized';
  const server = http.createServer((req, res) => {
    if (mode === 'oversized') res.end(' '.repeat(65537));
    else if (mode === 'invalid') res.end('not JSON');
    else if (mode === 'status') {res.writeHead(404); res.end('{}');}
    else if (mode === 'valid') res.end(JSON.stringify({appId: 'iron-hands-forge'}));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port;
  try {
    for (mode of ['oversized', 'invalid', 'status', 'stalled']) assert.equal(await getHealth(port, 80), null);
    mode = 'valid'; assert.deepEqual(await getHealth(port), {appId: 'iron-hands-forge'});
  } finally {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}
});

test('startup lock is atomic and a released lock can be acquired immediately', async () => {
  const key = temporary(); let first, next;
  try {
    first = await acquireStartupLock(key);
    await assert.rejects(acquireStartupLock(key, {timeout: 80}), /Another launcher/);
    await first(); first = null;
    next = await acquireStartupLock(key, {timeout: 80});
  } finally {if (first) await first(); if (next) await next(); cleanup(key);}
});

test('kernel startup lock disappears when the owner is terminated', async () => {
  const key = temporary(); let child;
  try {
    const code = 'const {acquireStartupLock}=require(' + JSON.stringify(LAUNCHER) + '); acquireStartupLock(' + JSON.stringify(key) + ').then(()=>console.log("locked"));';
    child = spawn(process.execPath, ['-e', code], {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    let output = ''; child.stdout.on('data', chunk => {output += chunk;});
    await eventually(() => output.includes('locked'));
    const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    const release = await acquireStartupLock(key, {timeout: 500}); await release();
  } finally {if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); cleanup(key);}
});

test('launcher starts from another cwd, honours CLI paths, reuses only its instance and preserves foreign services', async () => {
  const folder = temporary(), data = path.join(folder, 'empty explicit data'), state = path.join(folder, 'private state'), port = await freePort();
  let primary, duplicate, fallback;
  const foreign = http.createServer((req, res) => res.end('foreign service'));
  foreign.listen(0, '127.0.0.1'); await once(foreign, 'listening'); const busy = foreign.address().port;
  try {
    primary = launch(['--no-browser', '--port', String(port), '--data-root', data, '--state-root', state], folder);
    await eventually(() => primary.ready() || primary.child.exitCode !== null);
    assert.ok(primary.ready(), primary.errors());
    assert.equal(primary.ready().reused, false); assert.equal(primary.ready().dataRoot, data); assert.equal(primary.ready().stateRoot, state);
    assert.equal((await getHealth(port)).resourcesReady, false);
    duplicate = launch(['--no-browser', '--port', String(port), '--data-root', data, '--state-root', state], folder);
    assert.equal((await duplicate.exited).code, 0, duplicate.errors()); assert.equal(duplicate.ready().reused, true);
    assert.equal((await getHealth(port)).appId, 'iron-hands-forge');
    fallback = launch(['--no-browser', '--port', String(busy), '--data-root', data, '--state-root', path.join(folder, 'other state')], folder);
    await eventually(() => fallback.ready() || fallback.child.exitCode !== null);
    assert.ok(fallback.ready(), fallback.errors()); assert.notEqual(fallback.ready().port, busy);
    assert.equal(await fetch('http://127.0.0.1:' + busy).then(r => r.text()), 'foreign service');
  } finally {
    for (const instance of [fallback, duplicate, primary]) if (instance) await stop(instance);
    await new Promise(resolve => foreign.close(resolve)); cleanup(folder);
  }
});

test('Linux shutdown signals close the owned server without stopping a reused instance', {skip: process.platform !== 'linux'}, async () => {
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const folder = temporary(), port = await freePort(); let instance;
    try {
      instance = launch(['--no-browser', '--port', String(port), '--data-root', path.join(folder, 'empty')], folder);
      await eventually(() => instance.ready());
      const result = await stop(instance, signal); assert.equal(result.code, 0, instance.errors());
      assert.equal(await getHealth(port), null);
    } finally {if (instance) await stop(instance); cleanup(folder);}
  }
});

test('real Linux browser launch keeps the original temp environment while the server uses its private cache', {skip: process.platform !== 'linux'}, async () => {
  const folder = temporary(), bin = path.join(folder, 'bin'), userTemp = path.join(folder, 'user-tmp');
  const report = path.join(folder, 'browser-environment.json'), script = path.join(folder, 'capture-browser-env.cjs');
  const longCache = path.join(folder, 'intentionally-long-cache-parent-for-native-browser-socket-regression-'.repeat(3));
  const port = await freePort(); let instance;
  const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  try {
    fs.mkdirSync(bin); fs.mkdirSync(userTemp);
    fs.writeFileSync(script, "const fs=require('node:fs');fs.writeFileSync(process.env.FORGE_BROWSER_ENV_REPORT,JSON.stringify({TEMP:process.env.TEMP,TMP:process.env.TMP,TMPDIR:process.env.TMPDIR,url:process.argv[2]}));\n");
    fs.writeFileSync(path.join(bin, 'xdg-open'), '#!/bin/sh\nexec ' + shellQuote(process.execPath) + ' ' + shellQuote(script) + ' "$@"\n', {mode: 0o755});
    instance = launch(['--port', String(port), '--data-root', path.join(folder, 'empty explicit data')], folder, {
      XDG_CACHE_HOME: longCache, TEMP: userTemp, TMP: userTemp, TMPDIR: userTemp,
      PATH: bin + path.delimiter + process.env.PATH, FORGE_BROWSER_ENV_REPORT: report
    }, true);
    await eventually(() => instance.ready() || instance.child.exitCode !== null);
    assert.ok(instance.ready(), instance.errors());
    let browser;
    await eventually(() => {try {browser = JSON.parse(fs.readFileSync(report, 'utf8')); return true;} catch {return false;}});
    const ready = instance.ready(), privateTemp = path.join(ready.cacheRoot, 'tmp');
    assert.ok(Buffer.byteLength(path.join(privateTemp, 'com.google.Chrome.XXXXXX', 'SingletonSocket')) > 108, 'The regression fixture must exceed the Linux socket limit');
    assert.deepEqual(browser, {TEMP: userTemp, TMP: userTemp, TMPDIR: userTemp, url: ready.url});
    assert.deepEqual(ready.internalTemp, {TEMP: privateTemp, TMP: privateTemp, TMPDIR: privateTemp});
    assert.ok(fs.statSync(privateTemp).isDirectory());
    assert.equal((await getHealth(port)).appId, 'iron-hands-forge');
  } finally {if (instance) await stop(instance); cleanup(folder);}
});
