#!/usr/bin/env node
import { readFile, mkdir, mkdtemp, open, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDriveReader, parseRow } from './verify-ledger.mjs';
export async function fetchImage({ ledger, source, cache = join(homedir(), '.cache/qa-video'), readRemote = createDriveReader() }) {
  if (!/\.(png|jpe?g|webp|gif)$/i.test(source)) throw Error('citation must name an image');
  const matches = (await readFile(ledger, 'utf8')).split('\n').filter(line => line.startsWith(`- ${source} → `));
  if (matches.length !== 1) throw Error('missing/ambiguous cited image row');
  if (!/\|\s*cloud=verified\s+[^|]+/.test(matches[0])) throw Error('image custody is unverified');
  const row = parseRow(matches[0]), remote = await readRemote(row.target, row.account);
  if (remote.bytes !== row.bytes) throw Error('image size mismatch');
  await mkdir(cache, { recursive: true, mode: 0o700 });
  const dir = await mkdtemp(join(cache, 'restore-')), path = join(dir, `image${extname(source)}`);
  try {
    const handle = await open(path, 'wx', 0o600), hash = createHash('sha256'); let bytes = 0;
    try {
      for await (const chunk of await remote.body()) {
        bytes += chunk.length; if (bytes > row.bytes) throw Error('image size mismatch');
        hash.update(chunk); await handle.writeFile(chunk);
      }
    } finally { await handle.close(); }
    if (bytes !== row.bytes || hash.digest('hex') !== row.sha256) throw Error('image size/hash mismatch');
    return { path, target: row.target, id: remote.id, url: remote.url, sha256: row.sha256, source };
  } catch (error) { await rm(dir, { recursive: true, force: true }); throw error; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4) { console.error('usage: fetch-qa-image.mjs <ledger.md> <original-image-path>'); process.exitCode = 2; }
  else try { console.log(JSON.stringify(await fetchImage({ ledger: process.argv[2], source: process.argv[3] }))); }
  catch { console.error('NOT DETERMINED: image missing, ambiguous, unverified or unavailable'); process.exitCode = 1; }
}
