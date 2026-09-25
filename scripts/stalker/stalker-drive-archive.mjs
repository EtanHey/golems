import { readFile, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const API = 'https://www.googleapis.com/drive/v3/files';
const FIELDS = 'id,name,mimeType,parents,size,md5Checksum,sha256Checksum,trashed,webViewLink';
const folderType = 'application/vnd.google-apps.folder';
const escaped = value => String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'");

// Reuse the installed MCP's locked OAuth refresh; credentials never leave memory.
export async function driveAccessToken() {
  const guardPath = process.env.STALKER_DRIVE_OAUTH_GUARD
    ?? join(homedir(), 'Gits/orchestrator/vendor/google-drive-mcp/oauth-token-guard.mjs');
  const guard = await import(pathToFileURL(resolve(guardPath)).href);
  const result = await guard.preflightRefresh({ logger: {} });
  if (!['already-valid', 'normalized', 'refreshed'].includes(result.status)) throw new Error('Drive authentication unavailable');
  const token = JSON.parse(await readFile(guard.getDefaultTokenPath(), 'utf8')).access_token;
  if (!token) throw new Error('Drive authentication unavailable');
  return token;
}

// Drive files.get checksums, not FileProvider cache bytes, establish remote custody.
// https://developers.google.com/workspace/drive/api/guides/manage-uploads
export function createDriveArchive({ parentId, tokenImpl = driveAccessToken, fetchImpl = fetch, chunkBytes = 32 * 1024 * 1024, delayImpl = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  if (!/^[\w-]+$/.test(parentId ?? '')) throw new Error('Drive archive parent ID is required');
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 262144 || chunkBytes % 262144) throw new Error('invalid upload chunk size');
  const folders = new Map();
  let validated = false;
  async function request(url, init = {}) {
    const u = new URL(url);
    if (u.origin !== 'https://www.googleapis.com' || u.username || u.password) throw new Error('invalid Drive endpoint');
    try {
      return await fetchImpl(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(120000),
        headers: { ...init.headers, Authorization: `Bearer ${await tokenImpl()}` } });
    } catch { throw new Error('Drive transport failed'); } // Never surface token/request objects.
  }
  async function data(url, init) {
    const response = await request(url, init);
    if (!response.ok) throw new Error(`Drive HTTP ${response.status}`);
    return response.json();
  }
  async function metadata(id) { return data(`${API}/${encodeURIComponent(id)}?fields=${FIELDS}`); }
  async function children(parent, name) {
    const q = `'${escaped(parent)}' in parents and name = '${escaped(name)}' and trashed = false`;
    const result = await data(`${API}?${new URLSearchParams({ q, fields: 'files(id,mimeType),nextPageToken', pageSize: '100' })}`);
    if (result.nextPageToken || result.files?.length > 1) throw new Error('ambiguous Drive archive path');
    return result.files ?? [];
  }
  async function folder(parent, name) {
    const key = `${parent}/${name}`;
    if (folders.has(key)) return folders.get(key);
    const pending = (async () => {
      const existing = await children(parent, name);
      if (existing[0] && existing[0].mimeType !== folderType) throw new Error('archive directory is not a folder');
      const entry = existing[0] ?? await data(API, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parents: [parent], mimeType: folderType }) });
      if (!entry.id) throw new Error('Drive folder has no ID');
      return entry.id;
    })();
    folders.set(key, pending);
    try { return await pending; }
    catch (error) {
      if (folders.get(key) === pending) folders.delete(key);
      throw error;
    }
  }
  function verified(entry, expected, parent, name) {
    if (!entry.id || entry.trashed !== false || entry.name !== name || !entry.parents?.includes(parent)
      || Number(entry.size) !== expected.size || !entry.sha256Checksum || entry.sha256Checksum !== expected.sha256) {
      throw new Error(`Drive size/hash/path mismatch for ${expected.relativePath}`);
    }
    return { id: entry.id, size: Number(entry.size), sha256: entry.sha256Checksum, md5: entry.md5Checksum,
      path: `04_MEDIA/stalker/${expected.runName}/${expected.relativePath}`, url: entry.webViewLink ?? `https://drive.google.com/file/d/${entry.id}/view` };
  }
  function offset(response, size) {
    const range = response.headers.get('Range');
    if (!range) return 0;
    const m = /^bytes=0-(\d+)$/.exec(range);
    const n = m ? Number(m[1]) + 1 : NaN;
    if (!Number.isSafeInteger(n) || n < 0 || n > size) throw new Error('invalid Drive upload range');
    return n;
  }
  return async expected => {
    if (!/^[\w-]+$/.test(expected.runName ?? '') || !Number.isSafeInteger(expected.size) || expected.size <= 0
      || !/^[a-f0-9]{64}$/.test(expected.sha256 ?? '') || !expected.relativePath
      || expected.relativePath.split('/').some(part => !part || part === '.' || part === '..' || part.includes('\\'))) throw new Error('invalid archive source');
    if (!validated) {
      const parent = await metadata(parentId);
      if (parent.mimeType !== folderType || parent.trashed !== false) throw new Error('invalid Drive archive parent');
      validated = true;
    }
    const parts = expected.relativePath.split('/'), name = parts.pop();
    let parent = await folder(parentId, expected.runName);
    for (const part of parts) parent = await folder(parent, part);
    const existing = await children(parent, name);
    if (existing.length) return verified(await metadata(existing[0].id), expected, parent, name);
    const start = await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Upload-Content-Length': String(expected.size), 'X-Upload-Content-Type': 'application/octet-stream' },
      body: JSON.stringify({ name, parents: [parent] }),
    });
    if (!start.ok) throw new Error(`Drive upload initiation HTTP ${start.status}`);
    const location = start.headers.get('Location');
    let session;
    try { session = new URL(location); } catch { throw new Error('invalid resumable upload URL'); }
    if (session.origin !== 'https://www.googleapis.com' || !session.pathname.startsWith('/upload/drive/') || session.username || session.password) throw new Error('invalid resumable upload URL');
    const handle = await open(expected.absolutePath, 'r');
    let position = 0, retries = 0, noProgress = 0;
    try {
      while (position < expected.size) {
        const bytes = Buffer.alloc(Math.min(chunkBytes, expected.size - position));
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, position);
        if (bytesRead !== bytes.length) throw new Error('archive source changed during upload');
        let response;
        try {
          response = await request(session.href, { method: 'PUT', headers: { 'Content-Length': String(bytes.length),
            'Content-Range': `bytes ${position}-${position + bytes.length - 1}/${expected.size}` }, body: bytes });
          if (response.status >= 500 || response.status === 429) throw new Error('retry upload');
        } catch {
          if (++retries > 3) throw new Error('Drive upload interrupted repeatedly');
          await delayImpl(Math.min(32000, 1000 * 2 ** (retries - 1)) + Math.floor(Math.random() * 1000));
          response = await request(session.href, { method: 'PUT', headers: { 'Content-Length': '0', 'Content-Range': `bytes */${expected.size}` } });
        }
        if (response.status === 200 || response.status === 201) {
          const complete = await response.json();
          return verified(await metadata(complete.id), expected, parent, name);
        }
        if (response.status !== 308) throw new Error(`Drive upload HTTP ${response.status}`);
        const next = offset(response, expected.size);
        if (next <= position) {
          if (++noProgress > 3) throw new Error('Drive upload made no progress');
        } else { retries = 0; noProgress = 0; }
        position = next;
      }
      throw new Error('Drive upload has no final receipt');
    } finally { await handle.close(); }
  };
}
