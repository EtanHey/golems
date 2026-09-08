import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createDriveArchive } from '../stalker-drive-archive.mjs';

const parentId = 'archive-parent';
const hash = 'a'.repeat(64);
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
async function fixture(t, fetchImpl) {
  const root = await mkdtemp(join(import.meta.dirname, '.drive-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const absolutePath = join(root, 'video.mp4'); await writeFile(absolutePath, 'abc');
  return { request: { absolutePath, relativePath: 'video.mp4', runName: 'theo-2026-09-08', size: 3, sha256: hash },
    archive: createDriveArchive({ parentId, tokenImpl: async () => 'private-test-token', fetchImpl, delayImpl: async () => {} }) };
}
test('Drive verification reads remote size and hash; matching existing file is reused', async t => {
  const calls = [];
  const { archive, request } = await fixture(t, async (url, init) => {
    calls.push(String(url)); assert.equal(init.headers.Authorization, 'Bearer private-test-token');
    if (String(url).includes('/archive-parent?')) return json({ id: parentId, mimeType: 'application/vnd.google-apps.folder', trashed: false });
    if (String(url).includes('q=')) return json({ files: String(url).includes('video.mp4') ? [{ id: 'existing' }] : [{ id: 'run-folder', mimeType: 'application/vnd.google-apps.folder' }] });
    return json({ id: 'existing', name: 'video.mp4', parents: ['run-folder'], size: '3', sha256Checksum: hash, trashed: false });
  });
  const result = await archive(request); assert.equal(result.id, 'existing'); assert.equal(result.sha256, hash);
  assert.ok(calls.some(url => url.includes('/existing?'))); assert.equal(result.size, 3);
});
test('same-name mismatch is preserved and does not certify or overwrite remote content', async t => {
  const { archive, request } = await fixture(t, async (url, init) => {
    assert.equal(init.method ?? 'GET', 'GET');
    if (String(url).includes('/archive-parent?')) return json({ id: parentId, mimeType: 'application/vnd.google-apps.folder', trashed: false });
    if (String(url).includes('q=')) return json({ files: [{ id: String(url).includes('video.mp4') ? 'existing' : 'run-folder', mimeType: 'application/vnd.google-apps.folder' }] });
    return json({ id: 'existing', name: 'video.mp4', parents: ['run-folder'], size: '3', sha256Checksum: 'b'.repeat(64), trashed: false });
  });
  await assert.rejects(archive(request), /mismatch/);
});
test('resumable upload trusts server Range after interruption and fetches fresh final metadata', async t => {
  let checks = 0, put = 0;
  const { archive, request } = await fixture(t, async (url, init) => {
    url = String(url);
    if (url.includes('/archive-parent?')) return json({ id: parentId, mimeType: 'application/vnd.google-apps.folder', trashed: false });
    if (url.includes('q=')) return json({ files: url.includes('video.mp4') ? [] : [{ id: 'run-folder', mimeType: 'application/vnd.google-apps.folder' }] });
    if (url.includes('uploadType=resumable')) return json({}, 200, { location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=test' });
    if (url.includes('upload_id=test')) {
      if (init.headers['Content-Range'] === 'bytes */3') { checks++; return new Response(null, {status:308,headers:{Range:'bytes=0-0'}}); }
      put++; if (put === 1) throw new Error('connection interrupted private-test-token');
      assert.equal(init.headers['Content-Range'], 'bytes 1-2/3'); assert.equal(Buffer.from(init.body).toString(), 'bc');
      return json({ id: 'uploaded' });
    }
    return json({ id: 'uploaded', name: 'video.mp4', parents: ['run-folder'], size: '3', sha256Checksum: hash, trashed: false });
  });
  assert.equal((await archive(request)).id, 'uploaded'); assert.equal(checks, 1); assert.equal(put, 2);
});
test('rejects foreign upload URL before forwarding credentials', async t => {
  const { archive, request } = await fixture(t, async url => {
    if (String(url).includes('/archive-parent?')) return json({ id: parentId, mimeType: 'application/vnd.google-apps.folder', trashed: false });
    if (String(url).includes('q=')) return json({ files: String(url).includes('video.mp4') ? [] : [{id:'run-folder',mimeType:'application/vnd.google-apps.folder'}] });
    return json({}, 200, {location:'https://foreign.invalid/steal'});
  });
  await assert.rejects(archive(request), /invalid resumable/);
});

test('missing MIME type cannot be trusted as an archive folder', async t => {
  const {archive,request}=await fixture(t,async url=>String(url).includes('/archive-parent?')
    ? json({id:parentId,mimeType:'application/vnd.google-apps.folder',trashed:false}) : json({files:[{id:'unknown'}]}));
  await assert.rejects(archive(request),/not a folder/);
});

test('transient retries back off and reset after each acknowledged chunk', async t => {
  const unit=262144, size=unit*4, delays=[], failed=new Set(); let acknowledged=0;
  const {request}=await fixture(t,()=>{}); request.size=size; await writeFile(request.absolutePath,Buffer.alloc(size));
  const archive=createDriveArchive({parentId,chunkBytes:unit,tokenImpl:async()=> 'token',delayImpl:async ms=>delays.push(ms),fetchImpl:async (url,init)=>{
    url=String(url);
    if(url.includes('/archive-parent?'))return json({id:parentId,mimeType:'application/vnd.google-apps.folder',trashed:false});
    if(url.includes('q='))return json({files:url.includes('video.mp4')?[]:[{id:'run-folder',mimeType:'application/vnd.google-apps.folder'}]});
    if(url.includes('uploadType=resumable'))return json({},200,{location:'https://www.googleapis.com/upload/drive/v3/files?upload_id=test'});
    if(url.includes('upload_id=test')){
      const range=init.headers['Content-Range'];
      if(range===`bytes */${size}`)return new Response(null,{status:308,headers:acknowledged?{Range:`bytes=0-${acknowledged-1}`}:{}});
      const start=Number(range.match(/bytes (\d+)/)[1]);
      if(!failed.has(start)){failed.add(start);return json({},429);}
      acknowledged=start+unit;
      return acknowledged===size?json({id:'uploaded'}):new Response(null,{status:308,headers:{Range:`bytes=0-${acknowledged-1}`}});
    }
    return json({id:'uploaded',name:'video.mp4',parents:['run-folder'],size:String(size),sha256Checksum:hash,trashed:false});
  }});
  assert.equal((await archive(request)).size,size); assert.equal(delays.length,4); assert.ok(delays.every(ms=>ms>=1000&&ms<2000));
});

test('concurrent archives share one in-flight folder creation', async t => {
  let creates = 0;
  const { archive, request } = await fixture(t, async (url, init) => {
    const parsed = new URL(url), query = parsed.searchParams.get('q') ?? '';
    if (parsed.pathname.endsWith('/archive-parent')) return json({ id: parentId, mimeType: 'application/vnd.google-apps.folder', trashed: false });
    if (query.includes("name = 'theo-2026-09-08'")) return json({ files: [] });
    if (query.includes("name = 'video.mp4'")) return json({ files: [{ id: 'existing' }] });
    if (init.method === 'POST') {
      creates += 1;
      await new Promise(resolve => setTimeout(resolve, 10));
      return json({ id: 'run-folder', mimeType: 'application/vnd.google-apps.folder' });
    }
    return json({ id: 'existing', name: 'video.mp4', parents: ['run-folder'], size: '3', sha256Checksum: hash, trashed: false });
  });
  const results = await Promise.all([archive(request), archive(request)]);
  assert.deepEqual(results.map(result => result.id), ['existing', 'existing']);
  assert.equal(creates, 1);
});

test('failed folder creation is evicted so a later archive can retry', async t => {
  let creates = 0;
  const { archive, request } = await fixture(t, async (url, init) => {
    const parsed = new URL(url), query = parsed.searchParams.get('q') ?? '';
    if (parsed.pathname.endsWith('/archive-parent')) return json({ id: parentId, mimeType: 'application/vnd.google-apps.folder', trashed: false });
    if (query.includes("name = 'theo-2026-09-08'")) return json({ files: [] });
    if (query.includes("name = 'video.mp4'")) return json({ files: [{ id: 'existing' }] });
    if (init.method === 'POST') return ++creates === 1 ? json({}, 500) : json({ id: 'run-folder', mimeType: 'application/vnd.google-apps.folder' });
    return json({ id: 'existing', name: 'video.mp4', parents: ['run-folder'], size: '3', sha256Checksum: hash, trashed: false });
  });
  await assert.rejects(archive(request), /Drive HTTP 500/);
  assert.equal((await archive(request)).id, 'existing');
  assert.equal(creates, 2);
});

test('native fetch exposes 308 Range without following its Location', async t => {
  const unit = 262144, size = unit + 1, ranges = []; let followed = false;
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { /* consume request body */ }
    const parsed = new URL(request.url, 'http://localhost'), query = parsed.searchParams.get('q') ?? '';
    const send = (status, body, headers = {}) => { response.writeHead(status, { 'Content-Type': 'application/json', ...headers }); response.end(JSON.stringify(body)); };
    if (parsed.pathname === '/must-not-follow') { followed = true; return send(500, {}); }
    if (parsed.pathname.endsWith('/archive-parent')) return send(200, { id: parentId, mimeType: 'application/vnd.google-apps.folder', trashed: false });
    if (query.includes("name = 'theo-2026-09-08'")) return send(200, { files: [{ id: 'run-folder', mimeType: 'application/vnd.google-apps.folder' }] });
    if (query.includes("name = 'video.mp4'")) return send(200, { files: [] });
    if (parsed.searchParams.get('uploadType') === 'resumable') return send(200, {}, { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=local-test' });
    if (parsed.searchParams.get('upload_id') === 'local-test') {
      const range = request.headers['content-range'];
      ranges.push(range);
      if (range === `bytes */${size}` || range.startsWith('bytes 0-')) return send(308, {}, { Range: `bytes=0-${unit - 1}`, Location: `${base}/must-not-follow` });
      return send(200, { id: 'uploaded' });
    }
    if (parsed.pathname.endsWith('/uploaded')) return send(200, { id: 'uploaded', name: 'video.mp4', parents: ['run-folder'], size: String(size), sha256Checksum: hash, trashed: false });
    return send(404, {});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address(), base = `http://127.0.0.1:${address.port}`;
  const { request } = await fixture(t, () => {});
  request.size = size; await writeFile(request.absolutePath, Buffer.alloc(size));
  const archive = createDriveArchive({ parentId, chunkBytes: unit, tokenImpl: async () => 'token',
    fetchImpl: (url, init) => { const parsed = new URL(url); return fetch(`${base}${parsed.pathname}${parsed.search}`, init); } });
  assert.equal((await archive(request)).id, 'uploaded');
  assert.deepEqual(ranges, [`bytes 0-${unit - 1}/${size}`, `bytes ${unit}-${unit}/${size}`]);
  assert.equal(followed, false);
});
