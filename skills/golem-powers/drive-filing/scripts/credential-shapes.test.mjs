import { test, expect } from 'bun:test';
import { gzipSync, zstdCompressSync } from 'node:zlib';
import { chmodSync, readFileSync } from 'node:fs';
import { contentShapes, isCredentialFile, isCredentialDir } from './rollup.mjs';
import { fixture, plan, rollup, join, spawnSync } from './rollup-test-parts/common.mjs';

const value = ['gh', 'p_', 'A'.repeat(36)].join('');
test('ordinary words in file and directory names pass', () => {
  for (const name of ['js-tokens', 'tokenlayer', 'brief0026-secret-1.wav.mp4', 'tokenlayer-2026.jsonl.zst']) {
    expect(isCredentialFile(name)).toBe(false);
    expect(isCredentialDir(name)).toBe(false);
  }
  const repo = fixture({
    '2026-01-01-run/node_modules/js-tokens/index.js': 'module.exports = {};',
    '2026-01-01-run/brief0026-secret-1.wav.mp4': Buffer.from([0, 1]),
    '2026-01-01-run/tokenlayer-2026.jsonl.zst': zstdCompressSync('clean text'),
  });
  expect(plan(repo).held).toEqual([]);
});
test.each(['.env.local', 'auth.json', 'id_ed25519', 'archive.p12', 'vault.kdbx', 'client_secret.json'])('%s holds the whole run', name => {
  const repo = fixture({ [`2026-01-01-run/${name}`]: 'x', '2026-01-01-run/readme.md': 'clean' });
  expect(plan(repo).held).toHaveLength(1);
  expect(plan(repo).upload).toEqual([]);
});
test.each([['gz', gzipSync], ['zst', zstdCompressSync]])('decompressed %s content holds without leaking values', (ext, compress) => {
  const repo = fixture({ [`2026-01-01-run/notes.jsonl.${ext}`]: compress(`GITHUB_TOKEN=${value}`) });
  const p = plan(repo);
  expect(p.held).toHaveLength(1);
  expect(p.held[0].content.some(c => c.shape === 'credential-adjacent-1')).toBe(true);
  expect(p.upload).toEqual([]);
  expect(JSON.stringify(p)).not.toContain(value);
  expect(rollup(repo).stdout).not.toContain(value);
});
test('unreadable member holds with a safe named reason', () => {
  const repo = fixture({ '2026-01-01-run/notes.txt': 'clean' });
  chmodSync(join(repo, 'docs.local/2026-01-01-run/notes.txt'), 0);
  const p = plan(repo);
  expect(p.held[0].content).toContainEqual({path:'docs.local/2026-01-01-run/notes.txt', shape:'scan-unreadable'});
  expect(p.upload).toEqual([]);
});
test('corrupt compressed input fails closed', () => {
  const repo = fixture({ '2026-01-01-run/notes.zst': 'broken' });
  expect(plan(repo).held[0].content[0].shape).toBe('scan-decompression-error');
});
test('binary non-media cannot bypass content scanning with a NUL', () => {
  const repo = fixture({ '2026-01-01-run/notes.bin': `\0GITHUB_TOKEN=${value}` });
  expect(plan(repo).upload).toEqual([]);
});

test('documented basename rules match the canonical policy', async () => {
  const { credentialNames } = await import('./credential-policy.mjs');
  const doc = readFileSync(new URL('../SKILL.md', import.meta.url), 'utf8');
  const block = doc.split('<!-- credential-names:start -->')[1].split('<!-- credential-names:end -->')[0];
  expect([...block.matchAll(/`([^`]+)`/g)].map(m => m[1])).toEqual(credentialNames);
  for (const name of ['.env.example', '.env.sample']) expect(isCredentialFile(name)).toBe(true);
});
test('oversized decompressed stream holds', () => {
  const repo = fixture({ '2026-01-01-run/notes.gz': gzipSync(Buffer.alloc(65 * 1024 * 1024, 32)) });
  expect(plan(repo).held[0].content[0].shape).toBe('scan-size-limit');
});
test('full-folder classification counts files and named holds', async () => {
  const { classify } = await import('./classify.mjs');
  const repo = fixture({ 'node_modules/js-tokens/index.js': 'clean', 'brief0026-secret-1.wav.mp4': Buffer.from([0]), 'notes.jsonl.zst': zstdCompressSync(`GITHUB_TOKEN=${value}`) });
  const report = classify(join(repo, 'docs.local'));
  expect(report.files).toBe(3);
  expect(report.heldMembers).toBe(1);
  expect(report.reasons['credential-adjacent-1']).toBe(1);
  expect(JSON.stringify(report)).not.toContain(value);
});
test('expired budget and worker timeout fail closed', () => {
  const repo = fixture({ '2026-01-01-run/notes.txt': 'clean' });
  const file = join(repo, 'docs.local/2026-01-01-run/notes.txt');
  expect(contentShapes(file, 0)).toEqual(['scan-run-time-limit']);
  expect(contentShapes(file, 1)).toEqual(['scan-run-time-limit']);
});

test('Node CLI classifies actual zstd bytes read-only', () => {
  const repo = fixture({ 'notes.jsonl.zst': zstdCompressSync(`GITHUB_TOKEN=${value}`) });
  const result = spawnSync('node', [new URL('./classify.mjs', import.meta.url).pathname, join(repo, 'docs.local')], {encoding:'utf8'});
  expect(result.status).toBe(0);
  const report = JSON.parse(result.stdout)[0];
  expect(report.heldMembers).toBe(1);
  expect(report.reasons['credential-adjacent-1']).toBe(1);
  expect(result.stdout).not.toContain(value);
});
test('every canonical glob matches and word-only former holds are released', async () => {
  const { credentialNames } = await import('./credential-policy.mjs');
  for (const glob of credentialNames) expect(isCredentialFile(glob.replaceAll('*', 'sample'))).toBe(true);
  for (const name of ['credentials.txt', 'prod-env.json', 'app-env.yml', 'staging_env', 'api-token.json', 'github_token_tokenizer.txt', 'app-secrets.yml', '2026-02-21-auth.json']) {
    expect(isCredentialFile(name)).toBe(false);
  }
});
