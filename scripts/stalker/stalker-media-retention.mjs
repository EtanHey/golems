import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, open, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, join, posix, resolve } from 'node:path';
import { parseFragment } from 'parse5';
export const MAX_LOCAL_MEDIA_BYTES = 2_000_000_000;
export const MEDIA_RETENTION_RECEIPT = '.stalker-media-retention.json';
const MEDIA_EXTENSION = /\.(?:3gp|aac|aiff?|avi|bmp|caf|flac|gif|jpe?g|m4a|m4v|mkv|mov|mp3|mp4|mpe?g|ogg|opus|pcm|png|tiff?|webm|webp|wav|wma)$/i;
const PERMANENT_TEXT = /\.(?:conf|csv|html?|ini|jsonl?|log|m3u8|md|markdown|srt|toml|tsv|txt|vtt|xml|ya?ml)$/i;
const RAW_NAMES = new Set(['video.mp4', 'video.ts', 'full-audio.wav']);
function requiredRunDir(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('runDir is required');
  return resolve(value);
}
function safeRelative(value, label = 'relative path') {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\')) throw new Error(`${label} is invalid`);
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..') || posix.normalize(value) !== value) throw new Error(`${label} is invalid`);
  return value;
}
function selection(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return new Set(value.map(item => safeRelative(item, label)));
}
function dashboardMediaReferences(dashboard, runName, availablePaths) {
  const references = new Set();
  // Parse inert HTML so quotes, comments, and character references follow browser rules.
  const pending = [parseFragment(dashboard)];
  while (pending.length) {
    const node = pending.pop();
    for (const child of node.childNodes ?? []) pending.push(child);
    if (node.content) pending.push(node.content);
    for (const attribute of node.attrs ?? []) {
      if (!['src', 'poster', 'href'].includes(attribute.name)) continue;
      let value = attribute.value.trim().split(/[?#]/, 1)[0];
      if (!value || value.startsWith('/') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) continue;
      try { value = decodeURIComponent(value); }
      catch { continue; }
      while (value.startsWith('./')) value = value.slice(2);
      try { value = safeRelative(value, 'dashboard media path'); }
      catch { continue; }
      const parts = value.split('/');
      if (parts[0] === 'evidence') {
        if (parts.length < 4 || parts[1] !== runName) continue;
        value = parts.slice(3).join('/');
      }
      if (availablePaths.has(value)) references.add(value);
    }
  }
  return references;
}
async function looksLikeText(absolutePath) {
  const handle = await open(absolutePath, 'r');
  try {
    const sample = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(sample, 0, sample.length, 0);
    const bytes = sample.subarray(0, bytesRead);
    if (bytes.includes(0)) return false;
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return !/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(text);
  } catch { return false; }
  finally { await handle.close(); }
}
async function isMedia(absolutePath, relativePath) {
  if (PERMANENT_TEXT.test(relativePath)) return false;
  const [root] = relativePath.split('/');
  if (RAW_NAMES.has(relativePath) || MEDIA_EXTENSION.test(relativePath)) return true;
  if (/\.ts$/i.test(relativePath)) return !(await looksLikeText(absolutePath));
  return (root === 'frames' || root === 'clips') && !(await looksLikeText(absolutePath));
}
function sameStat(left, right) {
  return ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => left[key] === right[key]);
}
async function sha256(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const input = createReadStream(path);
    input.on('error', reject);
    input.on('data', chunk => hash.update(chunk));
    input.on('end', () => resolveHash(hash.digest('hex')));
  });
}
async function identity(absolutePath, relativePath) {
  const before = await lstat(absolutePath, { bigint: true });
  if (before.isSymbolicLink()) throw new Error(`refusing symlink: ${relativePath}`);
  if (!before.isFile()) throw new Error(`media source is not a regular file: ${relativePath}`);
  if (before.size <= 0n || before.size > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`media source has invalid size: ${relativePath}`);
  const digest = await sha256(absolutePath);
  const after = await lstat(absolutePath, { bigint: true });
  if (!sameStat(before, after)) throw new Error(`media source changed while hashing: ${relativePath}`);
  return { absolutePath, relativePath, size: Number(after.size), sha256: digest };
}
async function maybeStat(path) {
  try { return await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function inventory(runDir) {
  const root = await lstat(runDir);
  if (root.isSymbolicLink() || !root.isDirectory()) throw new Error('runDir must be a real directory, not a symlink');
  const files = [];
  async function walk(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = join(directory, entry.name);
      const info = await lstat(absolutePath);
      if (info.isSymbolicLink()) throw new Error(`refusing symlink: ${relativePath}`);
      if (info.isDirectory()) await walk(absolutePath, relativePath);
      else if (info.isFile() && await isMedia(absolutePath, relativePath)) files.push(await identity(absolutePath, relativePath));
    }
  }
  await walk(runDir);
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
function validateRemote(remote, expected) {
  if (!remote || typeof remote !== 'object' || typeof remote.id !== 'string' || !remote.id
    || typeof remote.path !== 'string' || !remote.path || Number(remote.size) !== expected.size
    || remote.sha256 !== expected.sha256) {
    throw new Error(`remote size/hash mismatch for ${expected.relativePath}`);
  }
  return { id: remote.id, path: remote.path, url: typeof remote.url === 'string' ? remote.url : null,
    size: Number(remote.size), sha256: remote.sha256, md5: typeof remote.md5 === 'string' ? remote.md5 : null };
}
async function atomicReceipt(path, receipt) {
  receipt.updatedAt = new Date().toISOString();
  const temporary = `${path}.new-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`);
  await rename(temporary, path);
}
function checkedReceipt(value, runName) {
  if (!value || value.version !== 1 || value.runName !== runName || !Array.isArray(value.files)) throw new Error('invalid media retention receipt');
  const seen = new Set();
  for (const file of value.files) {
    safeRelative(file?.relativePath, 'receipt path');
    if (seen.has(file.relativePath) || !Number.isSafeInteger(file.size) || file.size <= 0
      || !/^[a-f0-9]{64}$/.test(file.sha256 ?? '') || !['pending', 'verified', 'retained', 'deleted'].includes(file.state)) {
      throw new Error('invalid media retention receipt');
    }
    seen.add(file.relativePath);
  }
  return value;
}
async function loadReceipt(path, runName) {
  try { return checkedReceipt(JSON.parse(await readFile(path, 'utf8')), runName); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) throw new Error('invalid media retention receipt');
    throw error;
  }
}
function assertOptionPaths(paths, available, label) {
  for (const path of paths) if (!available.has(path)) throw new Error(`${label} does not name retained media: ${path}`);
}
function assertIdentity(actual, expected) {
  if (actual.size !== expected.size || actual.sha256 !== expected.sha256) throw new Error(`source changed before unlink: ${expected.relativePath}`);
}
export async function retainRunMedia({ runDir, archiveImpl, keepPaths = [], publishedCopyPaths = [],
  maxRemainingBytes = MAX_LOCAL_MEDIA_BYTES, unlinkImpl = unlink } = {}) {
  if (typeof archiveImpl !== 'function') throw new Error('authenticated archiveImpl is required');
  validateCap(maxRemainingBytes);
  runDir = requiredRunDir(runDir);
  const runName = basename(runDir);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(runName)) throw new Error('invalid run name');
  const keep = selection(keepPaths, 'keepPaths');
  const published = selection(publishedCopyPaths, 'publishedCopyPaths');
  const current = await inventory(runDir);
  const dashboard = await readFile(join(runDir, 'dashboard.html'), 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  const receiptPath = join(runDir, MEDIA_RETENTION_RECEIPT);
  let receipt = await loadReceipt(receiptPath, runName) ?? { version: 1, runName, status: 'retaining',
    startedAt: new Date().toISOString(), files: [] };
  const records = new Map(receipt.files.map(file => [file.relativePath, file]));
  for (const file of current) {
    const prior = records.get(file.relativePath);
    if (prior) assertIdentity(file, prior);
    else records.set(file.relativePath, { relativePath: file.relativePath, size: file.size, sha256: file.sha256, state: 'pending' });
  }
  assertOptionPaths(keep, new Set(records.keys()), 'keepPaths');
  assertOptionPaths(published, new Set(records.keys()), 'publishedCopyPaths');
  const dashboardReferences = dashboardMediaReferences(dashboard, runName, new Set(records.keys()));
  receipt.files = [...records.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  receipt.status = 'retaining';
  delete receipt.failure;
  await atomicReceipt(receiptPath, receipt);
  try {
    for (const record of receipt.files) {
      const absolutePath = join(runDir, record.relativePath);
      const source = await maybeStat(absolutePath);
      if (source?.isSymbolicLink()) throw new Error(`refusing symlink: ${record.relativePath}`);
      if (!source && !['verified', 'deleted'].includes(record.state)) throw new Error(`media source missing before remote verification: ${record.relativePath}`);
      const dashboardReference = dashboardReferences.has(record.relativePath);
      const referenced = dashboardReference && !published.has(record.relativePath);
      if (!source && (keep.has(record.relativePath) || referenced)) throw new Error(`retained media is missing: ${record.relativePath}`);
      const expected = { absolutePath, relativePath: record.relativePath, runName, size: record.size, sha256: record.sha256 };
      record.remote = validateRemote(await archiveImpl(expected), expected);
      if (dashboardReference && published.has(record.relativePath)) record.publishedCopyProven = true;
      else delete record.publishedCopyProven;
      record.state = 'verified';
      await atomicReceipt(receiptPath, receipt);
      if (!source) {
        record.state = 'deleted';
      } else {
        const shouldKeep = keep.has(record.relativePath) || referenced;
        const fresh = await identity(absolutePath, record.relativePath);
        assertIdentity(fresh, record);
        if (shouldKeep) {
          record.state = 'retained';
          record.keepReason = keep.has(record.relativePath) ? 'caller-selected' : 'run-dashboard-reference';
        } else {
          delete record.keepReason;
          await unlinkImpl(absolutePath);
          record.state = 'deleted';
        }
      }
      await atomicReceipt(receiptPath, receipt);
    }
    const remaining = await inventory(runDir);
    const remainingPaths = new Set(remaining.map(file => file.relativePath));
    for (const file of receipt.files) {
      if (file.state === 'retained' && !remainingPaths.has(file.relativePath)) throw new Error(`retained media is missing: ${file.relativePath}`);
      if (file.state !== 'retained' && remainingPaths.has(file.relativePath)) throw new Error(`unarchived media remains: ${file.relativePath}`);
      remainingPaths.delete(file.relativePath);
    }
    if (remainingPaths.size) throw new Error(`untracked local media remains: ${[...remainingPaths].join(',')}`);
    const afterBytes = remaining.reduce((total, file) => total + file.size, 0);
    const beforeBytes = receipt.files.reduce((total, file) => total + file.size, 0);
    receipt.totals = { beforeBytes, afterBytes, freedBytes: beforeBytes - afterBytes };
    if (afterBytes > maxRemainingBytes) throw new Error(`remaining media ${afterBytes} bytes exceeds ${maxRemainingBytes}-byte cap`);
    receipt.status = 'complete';
    receipt.completedAt = new Date().toISOString();
    await atomicReceipt(receiptPath, receipt);
    return receipt;
  } catch (error) {
    receipt.status = 'failed';
    receipt.failure = String(error?.message ?? error);
    await atomicReceipt(receiptPath, receipt);
    throw error;
  }
}
function validateCap(maxRemainingBytes) {
  if (!Number.isSafeInteger(maxRemainingBytes) || maxRemainingBytes < 0) throw new Error('maxRemainingBytes must be a non-negative integer');
}
// Fast monitor/retry check: validates persisted remote evidence and fresh local state,
// but deliberately makes no remote call and never claims fresh Drive verification.
export async function verifyLocalMediaRetention({ runDir, maxRemainingBytes = MAX_LOCAL_MEDIA_BYTES } = {}) {
  validateCap(maxRemainingBytes);
  runDir = requiredRunDir(runDir);
  const runName = basename(runDir);
  const receipt = await loadReceipt(join(runDir, MEDIA_RETENTION_RECEIPT), runName);
  if (!receipt || receipt.status !== 'complete') throw new Error('media retention is not complete');
  if (receipt.files.some(file => !['retained', 'deleted'].includes(file.state))) throw new Error('media retention receipt has unfinished files');
  const current = new Map((await inventory(runDir)).map(file => [file.relativePath, file]));
  const remainingBytes = [...current.values()].reduce((total, file) => total + file.size, 0);
  const dashboard = await readFile(join(runDir, 'dashboard.html'), 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  const dashboardReferences = dashboardMediaReferences(dashboard, runName, new Set(receipt.files.map(file => file.relativePath)));
  for (const record of receipt.files) {
    const expected = { absolutePath: join(runDir, record.relativePath), relativePath: record.relativePath, runName, size: record.size, sha256: record.sha256 };
    validateRemote(record.remote, expected);
    const local = current.get(record.relativePath);
    if (record.state === 'deleted' && local) throw new Error(`deleted media returned locally: ${record.relativePath}`);
    if (record.state === 'deleted' && dashboardReferences.has(record.relativePath) && record.publishedCopyProven !== true) {
      throw new Error(`dashboard media lacks independent-copy proof: ${record.relativePath}`);
    }
    if (record.state === 'retained') {
      if (!local) throw new Error(`retained media is missing: ${record.relativePath}`);
      assertIdentity(local, record);
    }
    current.delete(record.relativePath);
  }
  if (current.size) throw new Error(`untracked local media remains: ${[...current.keys()].join(',')}`);
  const beforeBytes = receipt.files.reduce((total, file) => total + file.size, 0);
  const expectedTotals = { beforeBytes, afterBytes: remainingBytes, freedBytes: beforeBytes - remainingBytes };
  if (JSON.stringify(receipt.totals) !== JSON.stringify(expectedTotals)) throw new Error('media retention receipt totals do not match local state');
  if (remainingBytes > maxRemainingBytes) throw new Error(`remaining media ${remainingBytes} bytes exceeds ${maxRemainingBytes}-byte cap`);
  return { ...receipt, verification: 'local-receipt-only' };
}
export async function verifyRunMediaRetention({ runDir, archiveImpl, maxRemainingBytes = MAX_LOCAL_MEDIA_BYTES } = {}) {
  if (typeof archiveImpl !== 'function') throw new Error('authenticated archiveImpl is required');
  const local = await verifyLocalMediaRetention({ runDir, maxRemainingBytes });
  runDir = requiredRunDir(runDir);
  for (const record of local.files) {
    const expected = { absolutePath: join(runDir, record.relativePath), relativePath: record.relativePath,
      runName: local.runName, size: record.size, sha256: record.sha256 };
    validateRemote(await archiveImpl(expected), expected);
  }
  return { ...local, verification: 'remote-fresh' };
}
