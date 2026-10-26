'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const http = require('node:http');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {setTimeout: delay} = require('node:timers/promises');

const APP_ID = 'iron-hands-forge';
const APP_ROOT = path.resolve(__dirname, '../..');
const HELP = 'Iron Hands Forge\nUsage: ./IronHandsForge [--no-browser] [--port NUMBER] [--data-root PATH] [--state-root PATH]\nCtrl+C stops this application server. The complete armour library is included.\n';

function parseOptions(args) {
  const options = {};
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (name === '--help' || name === '-h') {options.help = true; continue;}
    if (name === '--no-browser') {options.noBrowser = true; continue;}
    if (!['--port', '--data-root', '--state-root'].includes(name)) throw Error('Unknown argument: ' + name + '. Use --help.');
    if (seen.has(name)) throw Error('Duplicate argument: ' + name);
    seen.add(name);
    const value = args[++i];
    if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.startsWith('--')) throw Error(name + ' requires a value.');
    if (name === '--port') {
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw Error('--port must be an integer between 1 and 65535.');
      options.port = Number(value);
    } else options[name === '--data-root' ? 'dataRoot' : 'stateRoot'] = value;
  }
  return options;
}

function resolvePaths(options = {}, {appRoot = APP_ROOT, env = process.env, home = os.homedir()} = {}) {
  appRoot = fs.realpathSync(path.resolve(appRoot));
  const xdg = (name, fallback) => env[name] && path.isAbsolute(env[name]) ? env[name] : path.join(home, fallback);
  const stateRoot = options.stateRoot ? path.resolve(appRoot, options.stateRoot) : path.join(xdg('XDG_STATE_HOME', '.local/state'), APP_ID);
  const installId = crypto.createHash('sha256').update(appRoot).digest('hex').slice(0, 16);
  const cacheRoot = path.join(xdg('XDG_CACHE_HOME', '.cache'), APP_ID, installId);
  return {appRoot, stateRoot, cacheRoot};
}

function samePath(a, b) {
  return typeof a === 'string' && typeof b === 'string' && path.resolve(a) === path.resolve(b);
}

function healthMatches(health, expected) {
  return health?.appId === APP_ID && health.version === expected.version && health.ready === true &&
    samePath(health.appRoot, expected.appRoot) && samePath(health.dataRoot, expected.dataRoot) && samePath(health.stateRoot, expected.stateRoot);
}

function getHealth(port, timeout = 850) {
  return new Promise(resolve => {
    let done = false;
    const finish = value => {if (!done) {done = true; resolve(value);}};
    const request = http.get({hostname: '127.0.0.1', port, path: '/api/health', agent: false}, response => {
      if (response.statusCode !== 200 || Number(response.headers['content-length']) > 65536) {response.destroy(); finish(null); return;}
      let bytes = 0;
      const chunks = [];
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 65536) {response.destroy(); finish(null);} else chunks.push(chunk);
      });
      response.on('end', () => {try {finish(JSON.parse(Buffer.concat(chunks).toString('utf8')));} catch {finish(null);}});
      response.on('error', () => finish(null));
    });
    const deadline = setTimeout(() => {request.destroy(); finish(null);}, timeout);
    request.on('close', () => clearTimeout(deadline));
    request.on('error', () => finish(null));
  });
}

function lockAddress(appRoot) {
  const user = typeof process.getuid === 'function' ? String(process.getuid()) : os.userInfo().username;
  const key = crypto.createHash('sha256').update(user + '\0' + appRoot).digest('hex').slice(0, 40);
  // Abstract sockets are atomically bound by Linux and disappear on process death.
  // The Windows pipe variant lets the same locking tests run on a development PC.
  return process.platform === 'win32' ? '\\\\.\\pipe\\ihf-start-' + key : '\0ihf-start-' + key;
}

async function acquireStartupLock(appRoot, {signal, timeout = 25000} = {}) {
  const address = lockAddress(appRoot), deadline = Date.now() + timeout;
  while (true) {
    signal?.throwIfAborted();
    const server = net.createServer(socket => socket.destroy());
    server.maxConnections = 1;
    const error = await new Promise(resolve => {
      const failed = error => {server.off('listening', ready); resolve(error);};
      const ready = () => {server.off('error', failed); resolve(null);};
      server.once('error', failed); server.once('listening', ready); server.listen(address);
    });
    if (!error) {
      let released = false;
      return async () => {if (!released) {released = true; await new Promise(resolve => server.close(resolve));}};
    }
    if (error.code !== 'EADDRINUSE') throw error;
    if (Date.now() >= deadline) throw Error('Another launcher is still starting this application. Try again shortly.');
    await delay(100, undefined, {signal});
  }
}

async function openBrowser(url) {
  for (const [command, args] of [['xdg-open', [url]], ['gio', ['open', url]]]) {
    const launched = await new Promise(resolve => {
      const child = spawn(command, args, {stdio: 'ignore', detached: true});
      child.once('error', () => resolve(false));
      child.once('spawn', () => {child.unref(); resolve(true);});
    });
    if (launched) return;
  }
  console.error('Open this address in your browser: ' + url);
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const failed = error => {server.off('listening', ready); reject(error);};
    const ready = () => {server.off('error', failed); resolve();};
    server.once('error', failed); server.once('listening', ready); server.listen(port, '127.0.0.1');
  });
}

async function closeOwned(server) {
  if (!server) return;
  await new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  });
}

async function run(options, {appRoot = APP_ROOT, env = process.env, stdout = console.log} = {}) {
  const paths = resolvePaths(options, {appRoot, env});
  appRoot = paths.appRoot;
  const {stateRoot, cacheRoot} = paths;
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  const version = read(path.join(appRoot, 'package.json')).version;
  if (typeof version !== 'string' || !version) throw Error('package.json must define the application version.');
  let config = {};
  if (fs.existsSync(path.join(appRoot, 'forge.config.json'))) config = read(path.join(appRoot, 'forge.config.json'));
  const preferredPort = options.port ?? config.port ?? 8767;
  if (!Number.isSafeInteger(preferredPort) || preferredPort < 1 || preferredPort > 65535) throw Error('The configured port must be between 1 and 65535.');
  const {resolveDataRoot} = require(path.join(appRoot, 'shared/resource-library.cjs'));
  const motionBindings = read(path.join(appRoot, 'shared/motion-bindings.json'));
  const dataRoot = resolveDataRoot({appRoot, stateRoot, dataRoot: options.dataRoot, motionBindings});
  const expected = {version, appRoot, dataRoot, stateRoot};
  fs.mkdirSync(stateRoot, {recursive: true, mode: 0o700});
  fs.mkdirSync(cacheRoot, {recursive: true, mode: 0o700});
  const temp = path.join(cacheRoot, 'tmp'); fs.mkdirSync(temp, {recursive: true, mode: 0o700});
  process.env.TEMP = temp; process.env.TMP = temp; process.env.TMPDIR = temp;
  process.env.NODE_DISABLE_COMPILE_CACHE = '1';
  const abort = new AbortController();
  let server = null, release = null, stopping = null;
  const stop = () => {
    if (stopping) return stopping;
    abort.abort();
    stopping = closeOwned(server);
    return stopping;
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, stop);
  try {
    release = await acquireStartupLock(appRoot, {signal: abort.signal});
    const ports = [...new Set([preferredPort, ...Array.from({length: 11}, (_, i) => 8767 + i)])];
    const announce = async (port, health, reused) => {
      const url = 'http://127.0.0.1:' + port + '/';
      stdout(JSON.stringify({appId: APP_ID, event: 'ready', version, url, port, dataRoot, stateRoot, cacheRoot,
        resourcesReady: health.resourcesReady, dataSource: health.dataSource, reused}));
      await release(); release = null;
      if (!options.noBrowser) await openBrowser(url);
    };
    for (const port of ports) {
      abort.signal.throwIfAborted();
      const health = await getHealth(port);
      if (healthMatches(health, expected)) {await announce(port, health, true); return 0;}
    }
    const {createForgeServer} = require(path.join(appRoot, 'app/server.cjs'));
    for (const port of ports) {
      abort.signal.throwIfAborted();
      const candidate = createForgeServer({dataRoot, stateRoot, port});
      try {await listen(candidate, port);} catch (error) {
        if (error.code === 'EADDRINUSE') continue;
        throw error;
      }
      server = candidate;
      const closed = new Promise(resolve => server.once('close', resolve));
      const health = await getHealth(port);
      if (!healthMatches(health, expected)) throw Error('The server did not pass its application/root/version health check.');
      server.on('error', error => {console.error('Iron Hands Forge: ' + error.message); void stop();});
      await announce(port, health, false);
      if (abort.signal.aborted) await closeOwned(server);
      await closed;
      return 0;
    }
    throw Error('No application port is available. Ports 8767–8777 are occupied; existing services were left running.');
  } catch (error) {
    if (abort.signal.aborted && error.name === 'AbortError') return 0;
    throw error;
  } finally {
    if (release) await release();
    await closeOwned(server);
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.off(signal, stop);
  }
}

module.exports = {parseOptions, resolvePaths, healthMatches, getHealth, lockAddress, acquireStartupLock, run};
if (require.main === module) {
  (async () => {const options = parseOptions(process.argv.slice(2)); if (options.help) process.stdout.write(HELP); else process.exitCode = await run(options);})()
    .catch(error => {console.error('Iron Hands Forge: ' + error.message); process.exitCode = 1;});
}
