#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const hash = data => createHash('sha256').update(data).digest('hex');
const order = (a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path));
const roots = ['skills/golem-powers/', 'scripts/pr-watch-lib/', 'scripts/repogolem/', 'scripts/hooks/', 'packages/golem-skills/'];
const support = new Set(['scripts/release/install.sh', 'release-gate.json', 'scripts/pr-watch', '.claude/hooks/block-dangerous-commands.py', 'hooks/daemon-gate-precheck.py', 'scripts/model-roles.mjs', 'scripts/ci/check-model-role-drift.mjs', 'standards/model-roles.json', 'standards/model-roles.schema.json', '.bun-version', 'LICENSE']);
function shipped(path) {
  if (!support.has(path) && !roots.some(root => path.startsWith(root))) return false;
  return !path.split('/').some(part => /^(?:docs\.local|tests?|__tests__|evals|fixtures|testdata|__snapshots__|__pycache__|node_modules|private|\.git)$/.test(part))
    && !/(?:^|\/)(?:\.env(?:\..*)?|secrets\.(?:env|json|yaml)|.*\.(?:test|spec)\.[^/]+|.*\.(?:pem|key|pyc))$/.test(path);
}
function git(repo, args, input) {
  const result = spawnSync('git', ['-C', repo, ...args], { input, maxBuffer: 128 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr?.toString().trim() || result.error?.message}`);
  return result.stdout;
}
export function createManifest(version, commit, files) {
  return { version, commit, files: [...files].sort(order).map(({ path, data, mode }) => ({ path, sha256: hash(data), mode })) };
}

// USTAR headers contain no machine or clock metadata. Git executable bits are
// normalized to 0755/0644; unsupported links/submodules fail closed.
function tarEntry({ path, data, mode }) {
  const header = Buffer.alloc(512);
  let name = path, prefix = '';
  if (Buffer.byteLength(name) > 100) {
    const split = path.lastIndexOf('/');
    prefix = path.slice(0, split); name = path.slice(split + 1);
  }
  if (Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155) throw new Error(`path too long for USTAR: ${path}`);
  const octal = (value, offset, width) => header.write(value.toString(8).padStart(width - 1, '0') + '\0', offset, width, 'ascii');
  header.write(name, 0, 100); octal(parseInt(mode, 8), 100, 8);
  octal(0, 108, 8); octal(0, 116, 8); octal(data.length, 124, 12); octal(0, 136, 12);
  header.fill(32, 148, 156); header.write('0', 156); header.write('ustar\0', 257); header.write('00', 263);
  header.write(prefix, 345, 155);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return Buffer.concat([header, data, Buffer.alloc((512 - data.length % 512) % 512)]);
}

export function buildRelease({ repo = process.cwd(), commit = 'HEAD', out = 'dist/release' } = {}) {
  const sha = git(repo, ['rev-parse', '--verify', '--end-of-options', `${commit}^{commit}`]).toString().trim();
  const timestamp = Number(git(repo, ['show', '-s', '--format=%ct', sha]).toString().trim());
  const version = `${new Date(timestamp * 1000).toISOString().slice(0, 10).replaceAll('-', '.')}-${sha.slice(0, 7)}`;
  const records = git(repo, ['ls-tree', '-rz', '--full-tree', sha]).toString().split('\0').filter(Boolean).map(record => {
    const [metadata, path] = record.split('\t');
    const [mode, type, oid] = metadata.split(' ');
    return { path, mode, type, oid };
  }).filter(record => shipped(record.path) || record.path === 'package.json').sort(order);
  for (const file of records) if (file.type !== 'blob' || !['100644', '100755'].includes(file.mode)) throw new Error(`unsupported git mode ${file.mode}: ${file.path}`);
  const blobs = git(repo, ['cat-file', '--batch'], records.map(file => file.oid + '\n').join(''));
  let offset = 0;
  const files = records.map(file => {
    const end = blobs.indexOf(10, offset);
    const length = Number(blobs.subarray(offset, end).toString().split(' ')[2]);
    const data = blobs.subarray(end + 1, end + 1 + length);
    offset = end + 2 + length;
    return { path: file.path, data, mode: file.mode === '100755' ? '0755' : '0644' };
  });
  // repoGolem needs these packages. Omit the monorepo's unrelated workspaces
  // and dependencies; P2 owns installing/bundling this runtime dependency set.
  const packageFile = files.find(file => file.path === 'package.json');
  if (packageFile) {
    const source = JSON.parse(packageFile.data);
    const dependencies = Object.fromEntries(['ajv', 'yaml', 'varlock'].map(name => {
      if (!source.dependencies?.[name]) throw new Error(`missing runtime dependency: ${name}`);
      return [name, source.dependencies[name]];
    }));
    packageFile.data = Buffer.from(JSON.stringify({ name: 'golems-release', private: true, type: 'module', dependencies }, null, 2) + '\n');
  }
  const manifest = createManifest(version, sha, files);
  const manifestData = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  const archive = [...files, { path: 'MANIFEST.json', data: manifestData, mode: '0644' }].sort(order);
  const compressed = gzipSync(Buffer.concat([...archive.map(tarEntry), Buffer.alloc(1024)]), { level: 9 });
  compressed[9] = 255; // gzip OS = unknown, identical on macOS and Linux.
  const directory = resolve(out), filename = `golems-${version}.tar.gz`;
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, filename), compressed);
  writeFileSync(resolve(directory, 'MANIFEST.json'), manifestData);
  writeFileSync(resolve(directory, 'SHA256SUMS'), `${hash(compressed)}  ${filename}\n${hash(manifestData)}  MANIFEST.json\n`);
  return { version, commit: sha, tarball: resolve(directory, filename), files: manifest.files.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    for (let i = 2; i < process.argv.length; i++) {
      const flag = process.argv[i], value = process.argv[++i];
      if (!['--repo', '--commit', '--out'].includes(flag) || !value || value.startsWith('--')) throw new Error('usage: build-release.mjs [--repo PATH] [--commit SHA] [--out DIR]');
      options[flag.slice(2)] = value;
    }
    console.log(JSON.stringify(buildRelease(options)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
