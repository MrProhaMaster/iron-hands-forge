import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {bundleResources, verifyBundle} from './bundle-resources.mjs';
import releasePolicy from '../shared/release-policy.cjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const NODE_VERSION = 'v24.19.0';
const PRIVATE = new Set(['state', 'cache', 'data', '.build', 'tests', '__pycache__', 'node_modules', 'bin', 'obj', '.git']);
const FORBIDDEN = /\.(?:exe|dll|pdb|pak|tpl|tpl_data|sani|sani_data|sso|nmb|glb|gltf|blend|blend1|dds|pyc|pyo|log)$/i;
const PRIVATE_FILES = /^(?:forge\.config\.json|draft-roster\.json|selected-roster\.json|settings\.json|job\.json)$/i;
const ENTRY = '#!/bin/sh\nset -eu\nROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$ROOT/runtime/node" "$ROOT/src/launcher/linux-launcher.cjs" "$@"\n';
const sha256 = file => {
  const hash = crypto.createHash('sha256'), buffer = Buffer.allocUnsafe(4 * 1024 * 1024), fd = fs.openSync(file, 'r');
  try {let size; while ((size = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, size));}
  finally {fs.closeSync(fd);}
  return hash.digest('hex');
};

export function inspectLinuxNode(binary) {
  const fd = fs.openSync(binary, 'r'), header = Buffer.alloc(20);
  try {if (fs.readSync(fd, header, 0, header.length, 0) !== header.length) throw Error('The Node binary is truncated.');}
  finally {fs.closeSync(fd);}
  if (!header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) || header[4] !== 2 || header[5] !== 1 || header.readUInt16LE(18) !== 62)
    throw Error('--node-binary must be an official Linux x64 ELF binary.');
  fs.accessSync(binary, fs.constants.X_OK);
  const version = execFileSync(binary, ['--version'], {encoding: 'utf8', timeout: 10000, env: {...process.env, NODE_OPTIONS: ''}}).trim();
  if (version !== NODE_VERSION) throw Error('Expected Node ' + NODE_VERSION + ', received ' + version);
  return {version, sha256: sha256(binary)};
}

function copyFile(source, target) {
  if (!fs.lstatSync(source).isFile() || fs.lstatSync(source).isSymbolicLink()) throw Error('Only regular source files may be packaged: ' + source);
  fs.mkdirSync(path.dirname(target), {recursive: true, mode: 0o755});
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL); fs.chmodSync(target, 0o644);
}

function copyTree(source, target) {
  for (const entry of fs.readdirSync(source, {withFileTypes: true})) {
    if (PRIVATE.has(entry.name) || PRIVATE_FILES.test(entry.name) || FORBIDDEN.test(entry.name) || /\.(?:animation|ihf)\.json$/i.test(entry.name)) continue;
    if (entry.isSymbolicLink()) throw Error('Links are not allowed in distribution source: ' + path.join(source, entry.name));
    if (entry.isDirectory()) copyTree(path.join(source, entry.name), path.join(target, entry.name));
    else if (entry.isFile()) copyFile(path.join(source, entry.name), path.join(target, entry.name));
  }
}

function files(root, relative = '') {
  return fs.readdirSync(path.join(root, relative), {withFileTypes: true}).flatMap(entry => {
    const name = relative ? relative + '/' + entry.name : entry.name;
    if (entry.isSymbolicLink()) throw Error('Links are not allowed in distributions: ' + name);
    return entry.isDirectory() ? files(root, name) : [name];
  }).sort();
}

export function buildLinux({dataRoot, out, nodeBinary}) {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw Error('Build the Linux x64 distribution on Linux x64, for example with the Linux release workflow.');
  if (!dataRoot || !out || !nodeBinary) throw Error('Usage: --data-root PATH --out DISTDIR --node-binary PATH');
  releasePolicy.assertIterationVersion(JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8')).version);
  out = path.resolve(out); dataRoot = path.resolve(dataRoot); nodeBinary = path.resolve(nodeBinary);
  const relativeOutput = path.relative(ROOT, out);
  if (relativeOutput && !relativeOutput.startsWith('..' + path.sep) && !path.isAbsolute(relativeOutput) &&
      !['dist', '.build'].includes(relativeOutput.split(path.sep)[0]))
    throw Error('Inside the source repository, choose an output under dist/ or .build/ to keep source files separate.');
  const archive = out + '.tar.gz', checksum = archive + '.sha256';
  if ([out, archive, checksum].some(file => fs.existsSync(file))) throw Error('Choose a fresh output folder and archive name.');
  const runtime = inspectLinuxNode(nodeBinary);
  fs.mkdirSync(out, {recursive: true, mode: 0o755});
  for (const folder of ['app', 'shared', 'tools', 'docs', 'licenses', 'examples']) copyTree(path.join(ROOT, folder), path.join(out, folder));
  for (const name of ['package.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) copyFile(path.join(ROOT, name), path.join(out, name));
  for (const name of ['bundle-resources.mjs', 'vendor-three.mjs', 'build-linux.mjs']) copyFile(path.join(ROOT, 'scripts', name), path.join(out, 'scripts', name));
  copyFile(path.join(ROOT, 'src/launcher/linux-launcher.cjs'), path.join(out, 'src/launcher/linux-launcher.cjs'));
  copyFile(nodeBinary, path.join(out, 'runtime/node')); fs.chmodSync(path.join(out, 'runtime/node'), 0o755);
  for (const name of ['IronHandsForge', 'IronHandsForge.sh']) {fs.writeFileSync(path.join(out, name), ENTRY, {mode: 0o755, flag: 'wx'}); fs.chmodSync(path.join(out, name), 0o755);}
  const resources = bundleResources(dataRoot, path.join(out, 'data'));
  if (!fs.existsSync(path.join(out, 'app/web/vendor/three.module.js'))) throw Error('Vendor Three.js before building the application.');
  const copiedRuntime = inspectLinuxNode(path.join(out, 'runtime/node'));
  if (copiedRuntime.sha256 !== runtime.sha256) throw Error('Bundled Node does not match the verified input binary.');
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const build = {appId: 'iron-hands-forge', version, runtimeIdentifier: 'linux-x64', launcher: 'native-node',
    nodeVersion: runtime.version, nodeSHA256: runtime.sha256, resourcesIncluded: true, builtAt: new Date().toISOString()};
  fs.writeFileSync(path.join(out, 'launcher-build.json'), JSON.stringify(build, null, 2) + '\n', {flag: 'wx', mode: 0o644});
  const inventory = files(out);
  for (const name of inventory) {
    const expected = ['IronHandsForge', 'IronHandsForge.sh', 'runtime/node'].includes(name) ? 0o755 : 0o644;
    fs.chmodSync(path.join(out, name), expected);
    if ((fs.statSync(path.join(out, name)).mode & 0o777) !== expected) throw Error('Incorrect POSIX permissions: ' + name);
    if (!name.startsWith('data/') && (FORBIDDEN.test(name) || PRIVATE_FILES.test(path.basename(name)))) throw Error('Private or Windows runtime file in Linux package: ' + name);
  }
  verifyBundle(path.join(out, 'data'));
  execFileSync('tar', ['--format=posix', '--sort=name', '--owner=0', '--group=0', '--numeric-owner', '-czf', archive, '-C', path.dirname(out), '--', path.basename(out)], {stdio: ['ignore', 'pipe', 'pipe']});
  const entries = execFileSync('tar', ['-tzf', archive], {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024}).split('\n').filter(Boolean);
  const prefix = path.basename(out) + '/';
  const archived = entries.filter(name => !name.endsWith('/')).map(name => {
    if (!name.startsWith(prefix) || name.includes('/../') || path.posix.isAbsolute(name)) throw Error('Unsafe path in Linux archive: ' + name);
    return name.slice(prefix.length);
  }).sort();
  if (JSON.stringify(archived) !== JSON.stringify(inventory)) throw Error('The archive inventory differs from the packaged distribution.');
  const digest = sha256(archive); fs.writeFileSync(checksum, digest + '  ' + path.basename(archive) + '\n', {flag: 'wx', mode: 0o644});
  return {ok: true, ...build, directory: out, archive, checksum, sha256: digest, archiveBytes: fs.statSync(archive).size, files: inventory.length, resources};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {}, args = process.argv.slice(2);
    for (let i = 0; i < args.length; i += 2) {
      if (!['--data-root', '--out', '--node-binary'].includes(args[i]) || !args[i + 1] || options[args[i]]) throw Error('Usage: --data-root PATH --out DISTDIR --node-binary PATH');
      options[args[i]] = args[i + 1];
    }
    console.log(JSON.stringify(buildLinux({dataRoot: options['--data-root'], out: options['--out'], nodeBinary: options['--node-binary']})));
  } catch (error) {console.error(error.message); process.exitCode = 1;}
}
