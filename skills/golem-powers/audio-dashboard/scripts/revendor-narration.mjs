#!/usr/bin/env bun
// Full version bumps need a dependency closure; the debt refresh lint only resolves declared pairs.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dir, '..');
const upstream = process.env.NARRATIONLAYER_UPSTREAM;
const revision = process.argv[2];
if (!upstream || !revision) throw new Error('NARRATIONLAYER_UPSTREAM and explicit commit required');
const git = (...args) => execFileSync('git', ['-C', upstream, ...args], { encoding: 'utf8' }).trimEnd();
const commit = git('rev-parse', `${revision}^{commit}`);
const stampPath = path.join(root, 'vendor/narrationlayer/VENDOR-VERSION');
const stamp = JSON.parse(readFileSync(stampPath, 'utf8'));
const pairs = new Map(stamp.pairs.map(pair => [pair.sourcePath, pair]));
const seen = new Set();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const write = (file, bytes) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, bytes); };
function copy(source) {
  if (seen.has(source)) return;
  seen.add(source);
  let pair = pairs.get(source);
  if (!pair) {
    pair = { id: source.replace(/\.ts$/, '').replaceAll('/', '-'), sourcePath: source,
      vendorPath: `vendor/narrationlayer/${source}` };
    pairs.set(source, pair);
  }
  const bytes = execFileSync('git', ['-C', upstream, 'show', `${commit}:${source}`]);
  pair.sourceSha256 = sha(bytes);
  const typeShim = ['audio', 'narration-plan'].includes(pair.id);
  if (!typeShim) write(path.join(root, pair.vendorPath), bytes);
  pair.vendorSha256 = sha(readFileSync(path.join(root, pair.vendorPath)));
  if (typeShim) return;
  // Follow static runtime imports/re-exports, retaining upstream relative module layout.
  const text = bytes.toString();
  for (const match of text.matchAll(/(?:import|export)\s+(?!type\s)[\s\S]*?\sfrom\s*["'](\.[^"']+)["']/g)) {
    const specifier = match[1];
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(source), specifier)).replace(/\.js$/, '.ts');
    copy(target);
    const actual = path.join(root, pairs.get(target).vendorPath);
    const expected = path.resolve(root, path.dirname(pair.vendorPath), specifier.replace(/\.js$/, '.ts'));
    if (expected !== actual) {
      // Keep the existing skill-owned profile lookup bridge (NARRATIONLAYER_ROOT).
      if (expected === path.join(root, 'vendor/src/profiles.ts') && existsSync(expected)) continue;
      let relative = path.relative(path.dirname(expected), actual).replace(/\.ts$/, '.js');
      if (!relative.startsWith('.')) relative = `./${relative}`;
      write(expected, `export * from ${JSON.stringify(relative)};\n`);
    }
  }
}
for (const source of [...pairs.keys(), 'src/core/render-types.ts']) copy(source);
const bridges = readdirSync(path.join(root, 'vendor/src'), { recursive: true }).filter(file => file.endsWith('.ts')).map(file => `vendor/src/${file}`);
const internalBridges = readdirSync(path.join(root, 'vendor/narrationlayer/src'), { recursive: true }).filter(file => file.endsWith('.ts')).map(file => `vendor/narrationlayer/src/${file}`).filter(file => /^export \* from [^;]+;\s*$/.test(readFileSync(path.join(root, file), 'utf8')));
stamp.skillBridgeHashes = Object.fromEntries([...bridges, ...internalBridges].map(file => [file, sha(readFileSync(path.join(root, file)))]));
stamp.vendorSideFirst.find(debt => debt.id === 'SKILL_REPO_FREE_RUNNER_BRIDGES').skillPaths = [...bridges, 'scripts/local-tts.mjs'];
stamp.pairs = [...pairs.values()];
stamp.upstream.commit = commit;
stamp.upstream.committedAt = git('show', '-s', '--format=%cI', commit);
stamp.vendorDate = new Date().toISOString().slice(0, 10);
stamp.pendingRevendor = { sourceCommit: commit, status: 'refreshed-with-open-debt',
  aidevNote: 'Exact committed runtime dependency closure; existing type-only shims and repo-free profile/pronunciation bridge debt retained. Historical debt resolutions remain historical.' };
write(stampPath, `${JSON.stringify(stamp, null, 2)}\n`);
console.log(`Vendored ${pairs.size} paired modules from ${commit}`);
