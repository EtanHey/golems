import { test, expect } from 'bun:test';
import { gzipSync, zstdCompressSync, brotliCompressSync } from 'node:zlib';
import { fixture, plan, join } from './rollup-test-parts/common.mjs';
import { classify } from './classify.mjs';
const repeat = (n, c = 'A') => c.repeat(n);
const ghp = ['gh','p_',repeat(36)].join('');
const attacks = [
  ['application_default_credentials.json', JSON.stringify({client_secret:'GOCSPX-'+repeat(28), refresh_token:'1//0g'+repeat(90)})],
  ['.envrc', ['DATABASE_URL=post', 'gres://admin:', 'password123', '@db.example/app'].join('')],
  ['prod.env', 'ANTHROPIC_API_KEY='+['sk','-ant-api03-',repeat(40)].join('')],
  ['token.txt', 'ya29.'+repeat(120)],
  ['secrets.yaml', 'service_role: eyJ'+repeat(30)+'.'+repeat(80)+'.'+repeat(43)],
  ['.git-credentials', 'https://user:password123@example.com'],
  ['.git-credentials', 'https://user:'+ghp+'@example.com'],
  ['refresh_token.json', JSON.stringify({refresh_token:'1//0e'+repeat(90)})],
  ['credentials.db', 'SQLite format 3\0refresh_token 1//0g'+repeat(90)],
  ['secrets/prod.yaml', 'db_password: "Sup3rS3cret!"'],
];
test.each(attacks)('review attack holds: %s', (name, content) => {
  const repo = fixture({ ['2026-01-01-run/'+name]: content, '2026-01-01-run/readme.md':'clean' });
  expect(plan(repo).upload).toEqual([]);
  expect(classify(join(repo,'docs.local/2026-01-01-run')).status).toBe('HOLD');
});
test.each(['notes.png','clip.mp4'])('text disguised as media is scanned: %s', name => {
  expect(plan(fixture({ ['2026-01-01-run/'+name]: 'GITHUB_TOKEN='+ghp })).upload).toEqual([]);
});
test.each([
  ['archive.zip', Buffer.from('PK\x03\x04stuff')],
  ['unknown.txt', Buffer.from([0xfd,0x37,0x7a,0x58,0x5a,0x00])],
  ['bundle.tgz', gzipSync('clean')],
  ['notes.gz', gzipSync(gzipSync('clean'))],
  ['notes.txt.br', brotliCompressSync('clean')],
  ['notes16.txt', Buffer.from('GITHUB_TOKEN='+ghp, 'utf16le')],
])('unsupported format holds: %s', (name, content) => {
  expect(plan(fixture({['2026-01-01-run/'+name]:content})).upload).toEqual([]);
});

test.each(['.envrc','.git-credentials','application_default_credentials.json','service-account-prod.json','cert.p8','release.keystore','upload.jks','.pgpass','.docker/config.json','.kube/config','.aws/credentials','Login Data','Cookies','client.ovpn','wallet.dat','deploy_rsa','github_ed25519','deploy_ecdsa'])('always-held shape: %s', name => {
  const mp4 = Buffer.from('00000018667479706d703432000000006d70343269736f6d','hex');
  const repo = fixture({['2026-01-01-run/'+name]:mp4});
  expect(plan(repo).upload).toEqual([]);
  expect(classify(join(repo,'docs.local/2026-01-01-run')).status).toBe('HOLD');
});
test.each(['node_modules','site-packages','vendor','.venv'])('package name exception still scans member content: %s', tree => {
  const repo = fixture({ ['2026-01-01-run/'+tree+'/js-tokens/index.js']:'password=longSyntheticValue', '2026-01-01-run/readme.md':'clean' });
  expect(plan(repo).upload).toEqual([]);
  expect(classify(join(repo,'docs.local/2026-01-01-run')).status).toBe('HOLD');
});
test.each(['.env.example','.env.sample'])('clean template exemption still requires a scan: %s', name => {
  expect(plan(fixture({['2026-01-01-run/'+name]:'a clean example'})).held).toEqual([]);
  expect(plan(fixture({['2026-01-01-run/'+name]:'password=longSyntheticValue'})).upload).toEqual([]);
});

test('scan-time hashes verify raw compressed/media bytes and refuse mutations', async () => {
  const { verifyReports } = await import('./classify.mjs');
  const { createHash } = await import('node:crypto');
  const { writeFileSync, unlinkSync } = await import('node:fs');
  const media = Buffer.from('00000018667479706d703432000000006d70343269736f6d','hex');
  const compressed = zstdCompressSync('clean');
  const repo = fixture({'2026-01-01-run/recording.mp4':media, '2026-01-01-run/tokenlayer.jsonl.zst':compressed});
  const root = join(repo,'docs.local/2026-01-01-run');
  const saved = [classify(root)];
  expect(saved[0].status).toBe('CLEAR');
  expect(saved[0].members.map(m=>m.sha256)).toEqual([media,compressed].map(b=>createHash('sha256').update(b).digest('hex')));
  expect(verifyReports(saved)).toBe(true);
  writeFileSync(join(root,'recording.mp4'), Buffer.concat([media,Buffer.from('changed')]));
  expect(verifyReports(saved)).toBe(false);
  writeFileSync(join(root,'recording.mp4'),media);
  writeFileSync(join(root,'extra.txt'),'new');
  expect(verifyReports(saved)).toBe(false);
  unlinkSync(join(root,'extra.txt'));
  unlinkSync(join(root,'recording.mp4'));
  expect(verifyReports(saved)).toBe(false);
});
test('upload preflight CLI returns nonzero after scan-time bytes change', async () => {
  const { writeFileSync } = await import('node:fs');
  const { spawnSync } = await import('node:child_process');
  const repo = fixture({'2026-01-01-run/token.txt':'clean notes'});
  const root = join(repo,'docs.local/2026-01-01-run');
  const receipt = join(repo,'scan.json');
  writeFileSync(receipt,JSON.stringify([classify(root)]));
  const run = () => spawnSync('node',[new URL('./classify.mjs',import.meta.url).pathname,'--verify',receipt],{encoding:'utf8'});
  expect(run().status).toBe(0);
  writeFileSync(join(root,'token.txt'),'other clean notes');
  const changed = run();
  expect(changed.status).toBe(1);
  expect(changed.stderr.trim()).toBe('scan-receipt-mismatch');
});
