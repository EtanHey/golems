import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { verifyLedger, createDriveReader } from '../drive/verify-ledger.mjs';
import { lintName } from '../drive/lint-name.mjs';
const hash = s => createHash('sha256').update(s).digest('hex');
const name = '2026-11-04-golems-routing-report.md';
const row = (file = name, fields = '') => `- /local/${file} → Brain Drive/${file} | bytes=3 | SHA256=${hash('abc')} | cloud=PENDING${fields}\n`;
async function fixture(t, checksum = true) {
  const root = await mkdtemp(join(tmpdir(), 'drive-ledger-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'Brain Drive'));
  await writeFile(join(root, 'Brain Drive', name), 'abc');
  const ledger = join(root, 'ledger.md');
  await writeFile(ledger, row());
  // A temp mount supplies actual bytes; the fake API resolves its exact paths.
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    assert.equal(init.method, 'GET');
    if (new URL(url).pathname.endsWith('/root')) return Response.json({ id: 'opaque-root-id' });
    if (new URL(url).pathname.endsWith('/about')) return Response.json({ user: { emailAddress: 'account' } });
    if (new URL(url).searchParams.get('alt') === 'media') return new Response(await readFile(decodeURIComponent(new URL(url).pathname.split('/files/')[1])));
    const q = new URL(url).searchParams.get('q');
    const [, parent, child] = /'([^']+)' in parents and name = '([^']+)'/.exec(q);
    const dir = parent === 'opaque-root-id' ? root : parent;
    const files = (await readdir(dir)).includes(child) ? [await (async () => {
      const id = join(dir, child), s = await stat(id);
      return { id, name: child, parents: [parent], trashed: false, size: String(s.size),
        mimeType: s.isDirectory() ? 'application/vnd.google-apps.folder' : 'text/plain',
        sha256Checksum: checksum && s.isFile() ? hash(await readFile(id)) : undefined };
    })()] : [];
    return Response.json({ files });
  };
  return { root, ledger, requests, readRemote: createDriveReader({ tokenImpl: async () => 'test-private', fetchImpl }) };
}
test('dry-run verifies fake Drive bytes without writing; apply is idempotent', async t => {
  const f = await fixture(t), before = await readFile(f.ledger, 'utf8');
  const dry = await verifyLedger(f.ledger, { readRemote: f.readRemote });
  assert.deepEqual([dry.pending, dry.verifiable, dry.notVerifiable], [1, 1, 0]);
  assert.equal(await readFile(f.ledger, 'utf8'), before);
  await verifyLedger(f.ledger, { readRemote: f.readRemote, apply: true });
  const applied = await readFile(f.ledger, 'utf8');
  assert.match(applied, /cloud=verified \d{4}-\d\d-\d\dT/);
  const again = await verifyLedger(f.ledger, { readRemote: f.readRemote, apply: true });
  assert.equal(again.pending, 0); assert.equal(await readFile(f.ledger, 'utf8'), applied);
});
for (const [label, input, reason] of [
  ['missing', row('absent.md'), 'missing'],
  ['size mismatch', row().replace('bytes=3', 'bytes=4'), 'size mismatch'],
  ['hash mismatch', row().replace(hash('abc'), hash('abd')), 'hash mismatch'],
  ['malformed', '- broken | cloud=pending\n', 'malformed row'],
  ['duplicate field', row(undefined, ' | bytes=3'), 'malformed row'],
  ['traversal', row('../escape.md'), 'invalid Drive path'],
]) test(`${label} stays pending with a reason`, async t => {
  const f = await fixture(t); await writeFile(f.ledger, input);
  const result = await verifyLedger(f.ledger, { readRemote: f.readRemote, apply: true });
  assert.equal(result.notVerifiable, 1); assert.match(result.rows[0].reason, new RegExp(reason));
  assert.equal(await readFile(f.ledger, 'utf8'), input);
});
test('absolute mount path maps to API root; existing names are report-only', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'Brain Drive', 'Theo.md'), 'abc');
  await writeFile(f.ledger, row('Theo.md').replace('→ Brain Drive/', '→ /abs/Library/CloudStorage/GoogleDrive-account/My Drive/Brain Drive/'));
  const r = await verifyLedger(f.ledger, { readRemote: f.readRemote, apply: true });
  assert.equal(r.verifiable, 1); assert.ok(r.rows[0].naming.length);
  assert.match(await readFile(f.ledger, 'utf8'), /cloud=verified/);
});
for (const problem of ['auth', 'network', 'duplicate', 'paginated']) test(`${problem} never attests remote custody or exposes credentials`, async t => {
  const f = await fixture(t);
  const readRemote = createDriveReader({
    tokenImpl: async () => { if (problem === 'auth') throw Error('test-private'); return 'test-private'; },
    fetchImpl: async url => {
      if (String(url).includes('/root?')) return Response.json({ id: 'opaque-root-id' });
      if (problem === 'network') throw Error('test-private');
      return Response.json(problem === 'duplicate' ? { files: [{}, {}] } : { files: [], nextPageToken: 'more' });
    },
  });
  const r = await verifyLedger(f.ledger, { readRemote, apply: true });
  assert.equal(r.notVerifiable, 1); assert.doesNotMatch(JSON.stringify(r), /test-private/);
  assert.equal(await readFile(f.ledger, 'utf8'), row());
});
for (const [value, valid] of [
  [name, true], ['2026-11-04-voicebar-focus-review-by-opus.md', true],
  ['Theo.md', false], ['2026-11-04-golems-opus-review.md', false],
  ['2026-11-04-golems-theo-opus-report.md', false], ['2026-02-30-golems-routing-report.md', false],
]) test(`name contract: ${value}`, () => assert.equal(lintName(value).length === 0, valid));
test('name CLI blocks new opaque names and grandfathers existing names', () => {
  const cli = join(import.meta.dirname, '../drive/lint-name.mjs');
  assert.equal(spawnSync(process.execPath, [cli, 'Theo.md']).status, 1);
  assert.equal(spawnSync(process.execPath, [cli, '--existing', 'Theo.md']).status, 0);
});
test('account mismatch leaves a mount-path row pending', async t => {
  const f = await fixture(t);
  await writeFile(f.ledger, row().replace('→ Brain Drive/', '→ /GoogleDrive-wrong/My Drive/Brain Drive/'));
  const r = await verifyLedger(f.ledger, { readRemote: f.readRemote, apply: true });
  assert.equal(r.notVerifiable, 1); assert.equal(r.rows[0].reason, 'Drive account mismatch');
});
test('concurrent edit is preserved instead of overwritten', async t => {
  const f = await fixture(t);
  const readRemote = async target => { await writeFile(f.ledger, 'concurrent edit'); return f.readRemote(target); };
  await assert.rejects(verifyLedger(f.ledger, { readRemote, apply: true }), /ledger changed/);
  assert.equal(await readFile(f.ledger, 'utf8'), 'concurrent edit');
});
test('downloads remote bytes when SHA256 metadata is absent', async t => {
  const f = await fixture(t, false);
  assert.equal((await verifyLedger(f.ledger, { readRemote: f.readRemote })).verifiable, 1);
  assert.ok(f.requests.some(r => new URL(r.url).searchParams.get('alt') === 'media'));
});
test('empty ledger is unchanged; partial verification flips only matching rows', async t => {
  const f = await fixture(t); await writeFile(f.ledger, '# Empty\n');
  assert.equal((await verifyLedger(f.ledger, { readRemote: f.readRemote, apply: true })).pending, 0);
  await writeFile(f.ledger, row() + row('missing.md'));
  const r = await verifyLedger(f.ledger, { readRemote: f.readRemote, apply: true });
  assert.deepEqual([r.pending, r.verifiable, r.notVerifiable], [2, 1, 1]);
  assert.ok((await readFile(f.ledger, 'utf8')).endsWith(row('missing.md')));
});
test('a cloud=pending token in a source path is never rewritten', async t => {
  const f = await fixture(t), input = row().replace('/local/', '/local/cloud=pending/');
  await writeFile(f.ledger, input);
  await verifyLedger(f.ledger, { readRemote: f.readRemote, apply: true });
  const output = await readFile(f.ledger, 'utf8');
  assert.ok(output.startsWith('- /local/cloud=pending/')); assert.match(output, /\| cloud=verified /);
});
