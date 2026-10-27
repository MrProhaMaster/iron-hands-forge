// Native acceptance for a test-owned extraction of the actual Linux release archive.
// --browser also runs offline-browser-qa.mjs against the relocated, bundled application.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import {spawn, execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {verifyBundle} from '../scripts/bundle-resources.mjs';

const options = {};
for (let index = 2; index < process.argv.length; index++) {
  const name = process.argv[index];
  if (name === '--browser') options.browser = true;
  else if (['--archive', '--out'].includes(name) && process.argv[index + 1]) options[name.slice(2)] = process.argv[++index];
  else throw Error('Usage: node tests/linux-distribution-qa.mjs --archive RELEASE.tar.gz --out NEW_QA_DIRECTORY [--browser]');
}
assert.equal(process.platform, 'linux', 'This check must run natively on Linux.');
assert.equal(process.arch, 'x64', 'The release targets Linux x64.');
assert.ok(options.archive && options.out, '--archive and --out are required');
const archive = path.resolve(options.archive), out = path.resolve(options.out);
const extracted = path.join(out, 'extracted');
assert.equal(fs.existsSync(extracted), false, 'Use a fresh QA extraction directory.');
fs.mkdirSync(out, {recursive: true});
const report = {passed: false, archive, tests: [], classes: [], motions: [], launchers: [], startedAt: new Date().toISOString()};
const processes = new Set();
let foreign = null;
const json = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const hashFile = file => {
  const hash = crypto.createHash('sha256'), buffer = Buffer.allocUnsafe(4 * 1024 * 1024), fd = fs.openSync(file, 'r');
  try { let size; while ((size = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, size)); }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
};

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function launch(directory, label, args, env) {
  const child = spawn(path.join(directory, 'IronHandsForge'), ['--no-browser', ...args], {
    cwd: out, env, stdio: ['ignore', 'pipe', 'pipe']
  });
  const record = {child, label, directory, stdout: '', stderr: '', pending: '', ready: null, ended: false};
  processes.add(record);
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    record.stdout = (record.stdout + chunk).slice(-65536);
    record.pending += chunk;
    let newline;
    while ((newline = record.pending.indexOf('\n')) >= 0) {
      const line = record.pending.slice(0, newline); record.pending = record.pending.slice(newline + 1);
      try { const message = JSON.parse(line); if (message.event === 'ready') record.ready = message; } catch { }
    }
  });
  child.stderr.on('data', chunk => { record.stderr = (record.stderr + chunk).slice(-65536); });
  record.exit = new Promise(resolve => {
    child.once('error', error => { record.error = error; record.ended = true; resolve({code: null, error: error.message}); });
    child.once('close', (code, signal) => { record.ended = true; record.result = {code, signal}; resolve(record.result); });
  });
  report.launchers.push({label, pid: child.pid, directory});
  return record;
}

async function waitReady(record) {
  const deadline = Date.now() + 45000;
  while (!record.ready && !record.ended && Date.now() < deadline) await delay(50);
  assert.ok(record.ready, record.label + ' did not become ready: ' + record.stdout + '\n' + record.stderr);
  assert.equal(record.ready.appId, 'iron-hands-forge');
  return record.ready;
}

async function waitExit(record, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (!record.ended && Date.now() < deadline) await delay(50);
  assert.equal(record.ended, true, record.label + ' did not exit: ' + record.stderr);
  return record.exit;
}

async function health(base) {
  const response = await fetch(new URL('/api/health', base), {signal: AbortSignal.timeout(5000)});
  assert.equal(response.status, 200);
  return response.json();
}

async function stop(record) {
  if (!record.ended) record.child.kill('SIGTERM');
  const result = await waitExit(record);
  assert.equal(result.code, 0, record.label + ' must handle SIGTERM cleanly: ' + record.stderr);
  if (record.ready && !record.ready.reused) {
    let remains = false;
    try { remains = (await health(record.ready.url)).appRoot === record.directory; } catch { }
    assert.equal(remains, false, record.label + ' left its HTTP server alive');
  }
}

async function runBrowser(base, env, bionic = false) {
  const script = fileURLToPath(new URL(bionic ? './left-bionic-browser-qa.mjs' : './offline-browser-qa.mjs', import.meta.url));
  const label = bionic ? 'left-bionic-browser' : 'browser';
  const browserOut = path.join(out, label);
  const child = spawn(process.execPath, [script, '--url', base, '--out', browserOut], {
    env, cwd: out, detached: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  const record = {child, label, stdout: '', stderr: '', ended: false, processGroup: true};
  processes.add(record);
  child.stdout.on('data', chunk => { record.stdout = (record.stdout + chunk).slice(-65536); process.stdout.write(chunk); });
  child.stderr.on('data', chunk => { record.stderr = (record.stderr + chunk).slice(-65536); process.stderr.write(chunk); });
  record.exit = new Promise(resolve => {
    child.once('error', error => { record.ended = true; record.error = error; resolve({code: null}); });
    child.once('close', (code, signal) => { record.ended = true; record.result = {code, signal}; resolve(record.result); });
  });
  const result = await waitExit(record, 25 * 60 * 1000);
  assert.equal(result.code, 0, label + ' acceptance failed: ' + record.stderr);
  const resultReport = json(path.join(browserOut, 'report.json'));
  assert.equal(resultReport.passed, true); assert.equal(resultReport.classes.length, 7);
  if (bionic) {
    assert.deepEqual(resultReport.browserErrors, []); assert.deepEqual(resultReport.httpFailures, []);
    report.leftBionics = {passed: true, report: path.join(browserOut, 'report.json'), classes: resultReport.classes.length};
  } else {
    assert.deepEqual(resultReport.blockedRequests, []);
    report.browser = {passed: true, report: path.join(browserOut, 'report.json'), classes: resultReport.classes.length, build: resultReport.build};
  }
}

try {
  const checksum = fs.readFileSync(archive + '.sha256', 'utf8').trim().split(/\s+/);
  assert.match(checksum[0], /^[a-fA-F0-9]{64}$/);
  assert.equal(checksum.at(-1), path.basename(archive));
  report.sha256 = hashFile(archive);
  assert.equal(report.sha256, checksum[0].toLowerCase(), 'The actual tar.gz must match its published checksum.');
  const entries = execFileSync('tar', ['-tzf', archive], {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024}).split('\n').filter(Boolean);
  const folders = new Set(entries.map(name => name.split('/')[0]));
  assert.equal(folders.size, 1);
  for (const name of entries) assert.ok(!path.posix.isAbsolute(name) && !name.split('/').includes('..'), 'Unsafe archive path: ' + name);
  fs.mkdirSync(extracted);
  execFileSync('tar', ['-xzf', archive, '--no-same-owner', '-C', extracted], {stdio: 'pipe'});
  const folder = [...folders][0];
  let directory = path.join(extracted, folder);
  assert.equal(path.dirname(directory), extracted);
  for (const name of ['IronHandsForge', 'IronHandsForge.sh', 'runtime/node']) {
    fs.accessSync(path.join(directory, name), fs.constants.X_OK);
    assert.ok((fs.statSync(path.join(directory, name)).mode & 0o111) !== 0, name + ' must remain executable after tar extraction.');
  }
  assert.equal(fs.existsSync(path.join(directory, 'runtime/node.exe')), false);
  assert.equal(fs.existsSync(path.join(directory, 'forge.config.json')), false);
  const version = json(path.join(directory, 'package.json')).version;
  assert.equal(execFileSync(path.join(directory, 'runtime/node'), ['--version'], {encoding: 'utf8'}).trim(), 'v24.19.0');
  const payload = verifyBundle(path.join(directory, 'data'));
  assert.equal(payload.classes, 7); assert.equal(payload.files, 22); assert.equal(payload.appVersion, version);
  report.resources = payload;
  report.tests.push({name: 'actual-archive-integrity-posix-executable-modes-and-complete-bundle', passed: true});

  const env = {...process.env, XDG_STATE_HOME: path.join(out, 'xdg state'), XDG_CACHE_HOME: path.join(out, 'xdg cache')};
  const stateRoot = path.join(env.XDG_STATE_HOME, 'iron-hands-forge');
  const port = await freePort();
  const first = launch(directory, 'concurrent-start-a', ['--port', String(port)], env);
  const second = launch(directory, 'concurrent-start-b', ['--port', String(port)], env);
  const [a, b] = await Promise.all([waitReady(first), waitReady(second)]);
  assert.equal(a.url, b.url); assert.equal([a.reused, b.reused].filter(Boolean).length, 1);
  const owner = a.reused ? second : first, reuser = a.reused ? first : second;
  assert.equal((await waitExit(reuser)).code, 0);
  const ready = owner.ready;
  assert.equal(ready.stateRoot, stateRoot);
  assert.ok(ready.cacheRoot.startsWith(path.join(env.XDG_CACHE_HOME, 'iron-hands-forge') + path.sep));
  assert.equal(ready.dataRoot, path.join(directory, 'data')); assert.equal(ready.resourcesReady, true); assert.equal(ready.dataSource, 'bundled');
  assert.equal(fs.existsSync(path.join(directory, 'state')), false); assert.equal(fs.existsSync(path.join(directory, 'cache')), false);
  let current = await health(ready.url);
  assert.equal(current.appRoot, directory); assert.equal(current.dataRoot, path.join(directory, 'data')); assert.equal(current.stateRoot, stateRoot);
  assert.equal(current.resourcesReady, true); assert.equal(current.version, version);
  report.tests.push({name: 'concurrent-launch-reuses-one-owner-and-xdg-state-cache-without-data-root', passed: true});

  const catalog = await fetch(new URL('/api/catalog', ready.url)).then(response => response.json());
  const available = catalog.armor.classes.filter(item => item.available && catalog.manifest.assets.some(asset => asset.asset === item.tpl));
  assert.equal(available.length, 7); assert.equal(catalog.configured, true);
  const paints = await fetch(new URL('/api/paints', ready.url)).then(response => response.json());
  assert.ok(paints.colors.length > 0);
  for (const item of available) {
    const route = new URL('/retail-v5/' + item.tpl + '.glb', ready.url);
    const head = await fetch(route, {method: 'HEAD'}); assert.equal(head.status, 200);
    const bytes = Number(head.headers.get('content-length')); assert.ok(bytes > 10000);
    const range = await fetch(route, {headers: {Range: 'bytes=0-11'}}); assert.equal(range.status, 206);
    const header = Buffer.from(await range.arrayBuffer()); assert.equal(header.length, 12);
    assert.equal(header.readUInt32LE(0), 0x46546c67); assert.equal(header.readUInt32LE(8), bytes);
    const meta = await fetch(new URL('/retail-v5/' + item.tpl + '.json', ready.url), {method: 'HEAD'}); assert.equal(meta.status, 200);
    report.classes.push({classId: item.id, asset: item.tpl, bytes});
    for (const gait of ['walk', 'run']) for (const style of ['unarmed', 'armed']) {
      const motion = await fetch(new URL('/api/motion?' + new URLSearchParams({classId: item.id, gait, style}), ready.url)).then(response => response.json());
      assert.ok(motion.channels.length > 0 && motion.frameCount > 1 && motion.duration > 0);
      assert.equal(motion.binding.classId, item.id); assert.equal(motion.binding.asset, item.tpl);
      report.motions.push({classId: item.id, gait, style, frames: motion.frameCount, channels: motion.channels.length});
    }
  }
  assert.equal(report.motions.length, 28);
  report.tests.push({name: 'seven-real-models-paint-library-and-28-motion-bindings-served-locally', passed: true});
  await stop(owner);
  report.tests.push({name: 'sigterm-stops-only-the-owned-http-server', passed: true});

  // The extracted copy belongs to this QA run. Move it rather than duplicating the large data payload.
  const relocated = path.join(extracted, 'Iron Hands Forge relocated — проверка');
  assert.equal(path.dirname(relocated), extracted); fs.renameSync(directory, relocated); directory = relocated;
  fs.mkdirSync(stateRoot, {recursive: true});
  fs.writeFileSync(path.join(stateRoot, 'settings.json'), JSON.stringify({dataRoot: path.join(extracted, folder, 'data')}));
  const relocatedOwner = launch(directory, 'relocated-with-stale-saved-path', ['--port', String(await freePort())], env);
  const relocatedReady = await waitReady(relocatedOwner);
  current = await health(relocatedReady.url);
  assert.equal(current.appRoot, directory); assert.equal(current.dataRoot, path.join(directory, 'data')); assert.equal(current.resourcesReady, true);
  assert.equal(fs.existsSync(path.join(extracted, folder)), false, 'The old saved location must not be recreated.');
  assert.equal(current.stateRoot, stateRoot);
  report.tests.push({name: 'archive-relocation-spaces-unicode-and-stale-library-fallback', passed: true});
  if (options.browser) {
    await runBrowser(relocatedReady.url, env);
    report.tests.push({name: 'offline-chromium-seven-classes-edit-paint-share-export-and-resource-reset', passed: true});
    await runBrowser(relocatedReady.url, env, true);
    report.tests.push({name: 'seven-left-bionic-arms-native-compatibility-motion-save-share-and-glb-export', passed: true});
  }
  await stop(relocatedOwner);

  foreign = http.createServer((request, response) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({appId: 'unrelated-ci-service'})); });
  await new Promise(resolve => foreign.listen(0, '127.0.0.1', resolve));
  const busyPort = foreign.address().port;
  const fallback = launch(directory, 'busy-port-fallback', ['--port', String(busyPort)], env);
  const fallbackReady = await waitReady(fallback);
  assert.notEqual(fallbackReady.port, busyPort);
  assert.equal((await fetch('http://127.0.0.1:' + busyPort).then(response => response.json())).appId, 'unrelated-ci-service');
  await new Promise(resolve => foreign.close(resolve)); foreign = null;
  const reclaimed = launch(directory, 'preferred-port-freed-reuses-fallback', ['--port', String(busyPort)], env);
  const reused = await waitReady(reclaimed);
  assert.equal(reused.reused, true); assert.equal(reused.url, fallbackReady.url); assert.equal((await waitExit(reclaimed)).code, 0);
  assert.equal((await health(fallbackReady.url)).appRoot, directory);
  await stop(fallback);
  report.tests.push({name: 'foreign-busy-port-survives-and-newly-free-preferred-port-reuses-fallback', passed: true});
  assert.equal(verifyBundle(path.join(directory, 'data')).ok, true, 'Preview, exports and launcher must preserve the included data.');
  report.passed = true;
} catch (error) {
  report.error = error.stack || String(error);
  throw error;
} finally {
  if (foreign) await new Promise(resolve => foreign.close(resolve));
  for (const record of processes) {
    if (!record.ended) {
      try { if (record.processGroup) process.kill(-record.child.pid, 'SIGTERM'); else record.child.kill('SIGTERM'); } catch { }
      const deadline = Date.now() + 5000;
      while (!record.ended && Date.now() < deadline) await delay(50);
      if (!record.ended) try { if (record.processGroup) process.kill(-record.child.pid, 'SIGKILL'); else record.child.kill('SIGKILL'); } catch { }
    }
    const logs = path.join(out, 'lifecycle'); fs.mkdirSync(logs, {recursive: true});
    fs.writeFileSync(path.join(logs, record.label + '.stdout.log'), record.stdout);
    fs.writeFileSync(path.join(logs, record.label + '.stderr.log'), record.stderr);
  }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({passed: report.passed, tests: report.tests.length, classes: report.classes.length, motions: report.motions.length, report: path.join(out, 'report.json')}));
