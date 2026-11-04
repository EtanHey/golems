import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, mkdir, writeFile, readFile, utimes, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { planArchive, archiveRuns } from '../drive/archive-qa-video.mjs';
import { fetchImage } from '../drive/fetch-qa-image.mjs';
const hash = b => createHash('sha256').update(b).digest('hex');
async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'qa-archive-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'project'), run = join(repo, 'docs.local/qa-video/old');
  await mkdir(run, { recursive: true });
  await writeFile(join(run, 'frame.png'), 'image');
  await utimes(join(run, 'frame.png'), new Date('2026-09-20'), new Date('2026-09-20'));
  const options = { repos: [{ path: repo, owner: 'qa-seat', harvestedRuns: ['old'] }], now: new Date('2026-11-04') };
  const remote = new Map(); let uploads = 0;
  const upload = async (run, member) => {
    uploads++; remote.set(`${run.target}/${member.path}`, await readFile(member.absolutePath));
    return { id: `id-${uploads}`, url: 'https://drive.google.com/file/d/test/view' };
  };
  const readRemote = async target => {
    if (!remote.has(target)) throw Error('missing Drive file or folder');
    const bytes = remote.get(target);
    return { bytes: bytes.length, sha256: hash(bytes), hash: async () => hash(bytes), id: 'test-id', url: 'https://drive.google.com/file/d/test/view', body: async () => [bytes] };
  };
  return { root, repo, run, options, upload, readRemote, remote, uploads: () => uploads };
}
test('newest member determines age; unknown ownership and producer/credential holds win', async t => {
  const f = await fixture(t);
  assert.equal((await planArchive(f.options)).runs.length, 1);
  await writeFile(join(f.run, 'fresh.md'), 'fresh');
  assert.equal((await planArchive(f.options)).runs.length, 0);
  await rm(join(f.run, 'fresh.md'));
  for (const name of ['.pinned', 'unharvested', 'partial.log', '.env', 'auth.json']) {
    await writeFile(join(f.run, name), 'x');
    assert.equal((await planArchive(f.options)).runs.length, 0, name);
    await rm(join(f.run, name));
  }
  assert.equal((await planArchive({ ...f.options, repos: [{ path: f.repo }] })).runs.length, 0);
  await writeFile(join(f.run, 'notes.md'), 'sk-' + 'a'.repeat(25));
  assert.equal((await planArchive(f.options)).runs.length, 0);
});
test('default dry-run changes nothing; real verifier accepts rows; rerun is idempotent', async t => {
  const f = await fixture(t), plan = await planArchive(f.options);
  await archiveRuns(plan, { upload: f.upload, readRemote: f.readRemote });
  assert.equal(f.uploads(), 0);
  await archiveRuns(plan, { apply: true, account: 'owner@example.com', upload: f.upload, readRemote: f.readRemote });
  const ledger = join(f.repo, 'docs.local/qa-video/_DRIVE-LEDGER.md');
  const before = await readFile(ledger, 'utf8');
  assert.match(before, /bytes=5 \| SHA256=[a-f0-9]{64} \| account=owner@example.com \| cloud=verified/);
  const count = f.uploads();
  await archiveRuns(await planArchive(f.options), { apply: true, account: 'owner@example.com', upload: f.upload, readRemote: f.readRemote });
  assert.equal(f.uploads(), count); assert.equal(await readFile(ledger, 'utf8'), before);
  assert.ok(await stat(f.run));
});
test('prune requires flag, verified remote bytes, and successful restore; failures preserve locals', async t => {
  const f = await fixture(t), plan = await planArchive(f.options);
  await assert.rejects(archiveRuns(plan, { pruneVerified: true }), /requires --apply/);
  const failed = await archiveRuns(plan, { apply: true, pruneVerified: true, account: 'owner@example.com', upload: f.upload, readRemote: async () => { throw Error('missing Drive file'); } });
  assert.equal(failed.pending, 2); assert.equal(failed.holds.length, 1);
  assert.ok(await stat(f.run));
  await archiveRuns(await planArchive(f.options), { apply: true, pruneVerified: true, account: 'owner@example.com', upload: f.upload, readRemote: f.readRemote });
  await assert.rejects(stat(f.run), { code: 'ENOENT' });
});
test('fetches exact cited image to cache; missing, duplicate, mismatched or unauthenticated stays undetermined', async t => {
  const f = await fixture(t);
  await archiveRuns(await planArchive(f.options), { apply: true, account: 'owner@example.com', upload: f.upload, readRemote: f.readRemote });
  const ledger = join(f.repo, 'docs.local/qa-video/_DRIVE-LEDGER.md'), source = join(f.run, 'frame.png');
  const original = await readFile(ledger, 'utf8');
  const args = { ledger, source, cache: join(f.root, 'cache'), readRemote: f.readRemote };
  const restored = await fetchImage(args);
  assert.equal(await readFile(restored.path, 'utf8'), 'image'); assert.match(restored.target, /Brain Drive\/06_ARCHIVE/);
  await assert.rejects(fetchImage({ ...args, source: source + '-absent.png' }));
  for (const readRemote of [async () => { throw Error('Drive authentication unavailable'); }, async () => ({ bytes: 5, body: async () => [Buffer.from('wrong')] })])
    await assert.rejects(fetchImage({ ...args, readRemote }));
  await writeFile(ledger, original + original);
  await assert.rejects(fetchImage(args), /ambiguous/);
  assert.equal(await readFile(ledger, 'utf8'), original + original);
});
test('a changed remote non-sample member blocks pruning even with verified rows and stale metadata', async t => {
  const f = await fixture(t);
  await writeFile(join(f.run, 'report.md'), 'abc'); await utimes(join(f.run, 'report.md'), new Date('2026-09-20'), new Date('2026-09-20'));
  const plan = await planArchive(f.options), stale = new Map();
  await archiveRuns(plan, { apply: true, account: 'owner@example.com', upload: f.upload, readRemote: f.readRemote });
  for (const target of f.remote.keys()) stale.set(target, await f.readRemote(target));
  f.remote.set(`${plan.runs[0].target}/report.md`, Buffer.from('xyz'));
  const readRemote = async target => ({ ...stale.get(target), hash: async () => hash(f.remote.get(target)) });
  await assert.rejects(archiveRuns(plan, { apply: true, pruneVerified: true, account: 'owner@example.com', upload: f.upload, readRemote }), /remote changed/);
  assert.equal(await readFile(join(f.run, 'report.md'), 'utf8'), 'abc');
  assert.ok(await stat(join(f.run, 'frame.png')));
});
test('canonical API upload and GET-only image restore preserve empty members and reuse remote files', async t => {
  const { createUploader } = await import('../drive/archive-qa-video.mjs');
  const { createDriveReader } = await import('../drive/verify-ledger.mjs');
  const f = await fixture(t), folder = 'application/vnd.google-apps.folder';
  await writeFile(join(f.run, 'empty.txt'), ''); await utimes(join(f.run, 'empty.txt'), new Date('2026-09-20'), new Date('2026-09-20'));
  const nodes = [{ id: 'root', name: 'root', mimeType: folder, parents: [], trashed: false }];
  for (const [id, name, parent] of [['brain', 'Brain Drive', 'root'], ['archive', '06_ARCHIVE', 'brain']]) nodes.push({ id, name, parents: [parent], mimeType: folder, trashed: false });
  const methods = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url); methods.push(init.method ?? 'GET');
    if (u.pathname.endsWith('/about')) return Response.json({ user: { emailAddress: 'owner@example.com' } });
    if (u.searchParams.has('q')) {
      const [, parent, name] = /'([^']+)' in parents and name = '([^']+)'/.exec(u.searchParams.get('q'));
      return Response.json({ files: nodes.filter(n => n.name === name && n.parents.includes(parent)) });
    }
    if (init.method === 'POST') {
      const n = { ...JSON.parse(init.body), id: `n${nodes.length}`, trashed: false }; nodes.push(n);
      if (u.searchParams.has('uploadType')) return new Response(null, { status: 200, headers: { Location: `https://www.googleapis.com/upload/drive/v3/files?session=${n.id}` } });
      if (n.mimeType !== folder) Object.assign(n, { size: '0', sha256Checksum: hash(''), bytes: Buffer.alloc(0) });
      return Response.json(n);
    }
    const n = nodes.find(n => n.id === (u.searchParams.get('session') ?? u.pathname.split('/').pop()));
    if (!n) return new Response(null, { status: 404 });
    if (init.method === 'PUT') Object.assign(n, { bytes: Buffer.from(init.body), size: String(init.body.length), sha256Checksum: hash(init.body) });
    return u.searchParams.get('alt') === 'media' ? new Response(n.bytes) : Response.json(n);
  };
  const tokenImpl = async () => 'fake', readRemote = createDriveReader({ tokenImpl, fetchImpl });
  const upload = createUploader('owner@example.com', { tokenImpl, fetchImpl });
  const plan = await planArchive(f.options);
  assert.equal((await archiveRuns(plan, { apply: true, account: 'owner@example.com', upload, readRemote })).pending, 0);
  const count = nodes.length;
  await archiveRuns(plan, { apply: true, account: 'owner@example.com', upload: createUploader('owner@example.com', { tokenImpl, fetchImpl }), readRemote });
  assert.equal(nodes.length, count);
  const offset = methods.length;
  await fetchImage({ ledger: join(f.repo, 'docs.local/qa-video/_DRIVE-LEDGER.md'), source: join(f.run, 'frame.png'), cache: join(f.root, 'cache'), readRemote });
  assert.ok(methods.slice(offset).every(m => m === 'GET'));
  assert.ok(nodes.some(n => n.name === 'empty.txt' && n.size === '0'));
});
test('calendar cutoff uses Jerusalem midnight; CLI inventory is dry-run without config', async t => {
  const { spawnSync } = await import('node:child_process'), f = await fixture(t);
  await utimes(join(f.run, 'frame.png'), new Date('2026-10-01T00:30:00+03:00'), new Date('2026-10-01T00:30:00+03:00'));
  assert.equal((await planArchive(f.options)).runs.length, 0);
  const r = spawnSync(process.execPath, [join(import.meta.dirname, '../drive/archive-qa-video.mjs'), '--dry-run', '--repo', f.repo], { encoding: 'utf8' });
  assert.equal(r.status, 0); assert.match(r.stdout, /mode=dry-run/);
  await assert.rejects(stat(join(f.repo, 'docs.local/qa-video/_DRIVE-LEDGER.md')), { code: 'ENOENT' });
});
test('stale lock holds only its repo, names recovery, and leaves later repos runnable', async t => {
  const f = await fixture(t), g = await fixture(t);
  const lock = join(f.repo, 'docs.local/qa-video/.archive-lock'); await mkdir(lock);
  const result = await archiveRuns({ runs: [...(await planArchive(f.options)).runs, ...(await planArchive(g.options)).runs] }, {
    apply: true, account: 'owner@example.com',
    upload: async (...args) => { assert.notEqual(args[0].path, f.run); return g.upload(...args); }, readRemote: g.readRemote,
  });
  assert.equal(result.holds.length, 1); assert.match(result.holds[0], /\.archive-lock.*rmdir/);
  assert.ok(result.holds[0].includes(lock)); assert.ok(await stat(lock));
  assert.ok(g.uploads() > 0); assert.equal(f.uploads(), 0);
});
test('unverifiable pending rows are counted once across multiple runs in one repo', async t => {
  const f = await fixture(t), other = join(f.repo, 'docs.local/qa-video/other');
  await mkdir(other); await writeFile(join(other, 'frame.png'), 'image');
  await utimes(join(other, 'frame.png'), new Date('2026-09-20'), new Date('2026-09-20'));
  f.options.repos[0].harvestedRuns.push('other');
  const ledger = join(f.repo, 'docs.local/qa-video/_DRIVE-LEDGER.md');
  await writeFile(ledger, `- /missing.png → Brain Drive/missing.png | bytes=5 | SHA256=${hash('image')} | account=owner@example.com | cloud=pending\n`);
  const args = { apply: true, account: 'owner@example.com', upload: f.upload, readRemote: f.readRemote };
  assert.equal((await archiveRuns(await planArchive(f.options), args)).pending, 1);
  assert.equal((await archiveRuns(await planArchive(f.options), args)).pending, 1);
});
test('successful prune removes empty nested folders without an error', async t => {
  const f = await fixture(t); await mkdir(join(f.run, 'empty/nested'), { recursive: true });
  await archiveRuns(await planArchive(f.options), { apply: true, pruneVerified: true, account: 'owner@example.com', upload: f.upload, readRemote: f.readRemote });
  await assert.rejects(stat(f.run), { code: 'ENOENT' });
});
test('missing scheduled config names its path and fields on stderr', async () => {
  const { runCli } = await import('../drive/archive-qa-video.mjs'), errors = [];
  assert.equal(await runCli(['--apply'], { configPath: '/missing/qa-video-archive.json', error: s => errors.push(s) }), 2);
  assert.match(errors.join('\n'), /\/missing\/qa-video-archive\.json/);
  for (const field of ['account', 'repos', 'path', 'owner', 'harvestedRuns']) assert.ok(errors.join('\n').includes(field));
});
