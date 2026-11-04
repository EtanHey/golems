#!/usr/bin/env node
import { readFile, lstat, open, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { driveAccessToken } from '../stalker/stalker-drive-archive.mjs';
import { lintName } from './lint-name.mjs';
const API = 'https://www.googleapis.com/drive/v3/files';
const folder = 'application/vnd.google-apps.folder';
const pending = /(?:^|\|)\s*cloud\s*=\s*pending\s*(?=\||$)/i;
const escapeQuery = s => s.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
function driveParts(target) {
  // Recorded Drive-for-Desktop absolute paths remain resolvable without the mount.
  const relative = target.startsWith('Brain Drive/') ? target : target.split('/My Drive/')[1];
  const parts = relative?.split('/');
  if (!parts || parts[0] !== 'Brain Drive' || parts.length < 2 || parts.some(p => !p || p === '.' || p === '..' || /[\\\x00-\x1f]/.test(p))) throw Error('invalid Drive path');
  return parts;
}
export function createDriveReader({ tokenImpl = driveAccessToken, fetchImpl = fetch } = {}) {
  const cache = new Map();
  let account, rootId;
  async function get(url) {
    let token;
    try { token = await tokenImpl(); } catch { throw Error('Drive authentication unavailable'); }
    let response;
    try { response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${token}` } }); }
    catch { throw Error('Drive network/timeout failure'); }
    if (!response.ok) throw Error(`Drive HTTP ${response.status}`);
    return response;
  }
  return async target => {
    const parts = driveParts(target);
    const expectedAccount = /\/GoogleDrive-([^/]+)\/My Drive\//.exec(target)?.[1];
    if (expectedAccount) {
      account ??= (await (await get('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)')).json()).user?.emailAddress;
      if (account?.toLowerCase() !== expectedAccount.toLowerCase()) throw Error('Drive account mismatch');
    }
    rootId ??= (await (await get(`${API}/root?fields=id`)).json()).id;
    if (!rootId) throw Error('invalid Drive root');
    let parent = rootId, entry;
    for (const [i, name] of parts.entries()) {
      const key = `${parent}/${name}`;
      if (!cache.has(key)) {
        const q = `'${escapeQuery(parent)}' in parents and name = '${escapeQuery(name)}' and trashed = false`;
        let data;
        try { data = await (await get(`${API}?${new URLSearchParams({ q, fields: 'files(id,name,mimeType,parents,size,sha256Checksum,trashed),nextPageToken', pageSize: '100' })}`)).json(); }
        catch (error) { if (error instanceof SyntaxError) throw Error('invalid Drive response'); throw error; }
        if (!Array.isArray(data.files) || data.nextPageToken || data.files.length > 1) throw Error('ambiguous/incomplete Drive path');
        if (!data.files.length) throw Error('missing Drive file or folder');
        cache.set(key, data.files[0]);
      }
      entry = cache.get(key);
      if (!entry.id || entry.name !== name || entry.trashed !== false || !entry.parents?.includes(parent)) throw Error('Drive path metadata mismatch');
      if (i < parts.length - 1 && entry.mimeType !== folder) throw Error('Drive parent is not a folder');
      parent = entry.id;
    }
    if (entry.mimeType === folder || !/^\d+$/.test(entry.size) || !Number.isSafeInteger(Number(entry.size))) throw Error('Drive target is not a regular binary file');
    return { bytes: Number(entry.size), sha256: entry.sha256Checksum, hash: async () => {
      const response = await get(`${API}/${encodeURIComponent(entry.id)}?alt=media`);
      const hash = createHash('sha256'); let bytes = 0;
      for await (const chunk of response.body) { bytes += chunk.length; hash.update(chunk); }
      if (bytes !== Number(entry.size)) throw Error('Drive download size mismatch');
      return hash.digest('hex');
    } };
  };
}
function parseRow(line) {
  const fields = line.split('|').map(s => s.trim());
  const paths = /^- (.+?) → (.+)$/.exec(fields.shift());
  const bytes = fields.filter(s => /^bytes=/i.test(s)), sha = fields.filter(s => /^sha256=/i.test(s));
  if (!paths || bytes.length !== 1 || !/^bytes=\d+$/i.test(bytes[0]) || !Number.isSafeInteger(Number(bytes[0].slice(6)))
    || sha.length > 1 || (sha.length && !/^sha256=[a-f0-9]{64}$/i.test(sha[0]))
    || fields.filter(s => /^cloud\s*=/i.test(s)).length !== 1) throw Error('malformed row');
  driveParts(paths[2]);
  return { target: paths[2], bytes: Number(bytes[0].slice(6)), sha256: sha[0]?.slice(7).toLowerCase() };
}
export async function verifyLedger(path, { apply = false, readRemote = createDriveReader() } = {}) {
  if (!(await lstat(path)).isFile()) throw Error('ledger must be a regular file');
  const original = await readFile(path, 'utf8'), rows = [], lines = original.split('\n');
  const stamp = new Date().toISOString();
  for (const [index, line] of lines.entries()) {
    if (!pending.test(line)) continue;
    const result = { line: index + 1, verified: false, naming: [] };
    try {
      const row = parseRow(line);
      result.naming = lintName(basename(row.target)); // Existing names never block custody verification.
      const remote = await readRemote(row.target);
      if (remote.bytes !== row.bytes) throw Error('size mismatch');
      if (row.sha256 && (remote.sha256 ?? await remote.hash()) !== row.sha256) throw Error('hash mismatch');
      result.verified = true;
      lines[index] = line.replace(/(\|\s*)cloud\s*=\s*pending(?=\s*(?:\||$))/i, `$1cloud=verified ${stamp}`);
    } catch (error) { result.reason = /^(Drive |invalid Drive |missing Drive |ambiguous\/incomplete Drive |malformed row$|size mismatch$|hash mismatch$)/.test(error.message) ? error.message : 'Drive verification failed'; }
    rows.push(result);
  }
  const verifiable = rows.filter(r => r.verified).length;
  if (apply && verifiable) {
    const initial = await lstat(path), temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx', initial.mode & 0o777);
    try {
      await handle.writeFile(lines.join('\n')); await handle.sync();
      const current = await lstat(path);
      if (!current.isFile() || current.ino !== initial.ino || current.dev !== initial.dev
        || await readFile(path, 'utf8') !== original) throw Error('ledger changed during verification');
      await rename(temporary, path);
    } finally { await handle.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  return { mode: apply ? 'apply' : 'dry-run', pending: rows.length, verifiable, notVerifiable: rows.length - verifiable, rows };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), apply = args.includes('--apply');
  const paths = args.filter(a => !['--apply', '--dry-run'].includes(a));
  if (paths.length !== 1 || paths[0].startsWith('--') || (apply && args.includes('--dry-run'))) {
    console.error('usage: verify-ledger.mjs <ledger.md> [--dry-run|--apply]'); process.exitCode = 2;
  } else try {
    const result = await verifyLedger(paths[0], { apply });
    for (const row of result.rows) console.log(`line=${row.line} ${row.verified ? 'verifiable' : 'pending: ' + row.reason}${row.naming.length ? ' naming=legacy: ' + row.naming.join('; ') : ''}`);
    console.log(`drive-ledger: mode=${result.mode} pending=${result.pending} verifiable=${result.verifiable} not-verifiable=${result.notVerifiable}`);
    if (result.notVerifiable) process.exitCode = 1;
  } catch { console.error('drive-ledger: unable to read or safely update ledger'); process.exitCode = 2; }
}
