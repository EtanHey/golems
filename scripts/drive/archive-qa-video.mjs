#!/usr/bin/env node
import { readdir, lstat, realpath, readFile, mkdir, writeFile, appendFile, unlink, rmdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir, hostname } from 'node:os';
import { join, basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDriveReader, verifyLedger, parseRow } from './verify-ledger.mjs';
import { createDriveArchive, driveAccessToken } from '../stalker/stalker-drive-archive.mjs';
import { contentShapes, isCredentialDir, isCredentialFile, isRegenerableDir } from '../../skills/golem-powers/drive-filing/scripts/rollup.mjs';
const heldName = /(?:^|[-_.])(latest|active|pinned|hold|partial|unharvested)(?:$|[-_.])/i;
const safe = value => typeof value === 'string' && !/[|\r\n\x00-\x1f\\]| → /.test(value);
async function digest(path) {
  const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function directoryPaths(root) {
  const dirs = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory()) dirs.push(...await directoryPaths(join(root, entry.name)));
  }
  return [...dirs, root];
}
async function members(root, relative = '') {
  const path = join(root, relative), s = await lstat(path);
  if (s.uid !== process.getuid() || s.isSymbolicLink() || !safe(relative) || heldName.test(basename(path))
    || isCredentialDir(basename(path)) || isCredentialFile(basename(path))) throw Error('ownership/producer/credential hold');
  if (s.isDirectory()) {
    if (isRegenerableDir(basename(path))) throw Error('regenerable directory needs restore recipe');
    return (await Promise.all((await readdir(path)).sort().map(name => members(root, join(relative, name))))).flat();
  }
  if (!s.isFile() || contentShapes(path).length) throw Error('special file/credential-content hold');
  return [{ path: relative, absolutePath: path, bytes: s.size, mtime: s.mtimeMs, sha256: await digest(path) }];
}
export async function planArchive({ repos, now = new Date() }) {
  if (!Number.isFinite(+now)) throw Error('invalid date');
  const monthOf = value => { const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' }).formatToParts(value); return `${p.find(p => p.type === 'year').value}-${p.find(p => p.type === 'month').value}`; };
  const [year, month] = monthOf(now).split('-').map(Number);
  const cutoff = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7), runs = [], held = [];
  const names = new Set(); let ageRuns = 0, ageBytes = 0;
  for (const repo of repos) {
    const name = basename(resolve(repo.path)), root = join(resolve(repo.path), 'docs.local/qa-video');
    if (!safe(root) || !/^[\w.-]+$/.test(name) || names.has(name)) throw Error('invalid/duplicate repo');
    names.add(name);
    try { if (!(await lstat(root)).isDirectory() || await realpath(root) !== root) throw Error('invalid qa root'); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('_') || entry.name === '.archive-lock' || entry.name === '.DS_Store') continue;
      const path = join(root, entry.name);
      try {
        if (!entry.isDirectory()) throw Error('non-run');
        const files = await members(path);
        if (!files.length) throw Error('empty run');
        if (files.some(f => f.path === 'MANIFEST.json')) throw Error('existing manifest needs reconciliation');
        const newest = files.reduce((max, f) => Math.max(max, f.mtime), 0);
        if (monthOf(new Date(newest)) >= cutoff) continue;
        ageRuns++; ageBytes += files.reduce((n, f) => n + f.bytes, 0);
        if (!repo.owner || !safe(repo.owner)) throw Error('unknown ownership');
        if (!repo.harvestedRuns?.includes(entry.name) || !/^[\w-]+$/.test(entry.name)) throw Error('unknown harvest state/unsupported run name');
        const month = monthOf(new Date(newest));
        runs.push({ root, path, name: entry.name, owner: repo.owner, files, newest,
          target: `Brain Drive/06_ARCHIVE/docs-local/${name}/qa-video/${month}/${entry.name}` });
      } catch (error) { held.push({ path, reason: error.message }); }
    }
  }
  return { cutoff: `${cutoff}-01T00:00:00[Asia/Jerusalem]`, ageRuns, ageBytes, runs, held, files: runs.reduce((n, r) => n + r.files.length, 0), bytes: runs.reduce((n, r) => n + r.files.reduce((b, f) => b + f.bytes, 0), 0) };
}
// Canonical parents are resolved from root, never guessed from a folder name search.
export function createUploader(account, { tokenImpl = driveAccessToken, fetchImpl = fetch } = {}) {
  const parents = new Map(), uploaders = new Map();
  async function request(url, init = {}) {
    const token = await tokenImpl();
    const response = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(120000), headers: { ...init.headers, Authorization: `Bearer ${token}` } });
    if (!response.ok) throw Error('Drive archive request failed');
    return response.json();
  }
  return async (run, member) => {
    const API = 'https://www.googleapis.com/drive/v3/files';
    if (!/^Brain Drive\/06_ARCHIVE\/docs-local\/[\w.-]+\/qa-video\/\d{4}-\d{2}\/[\w-]+$/.test(run.target)) throw Error('invalid canonical target');
    if (!parents.size) {
      const identity = await request('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)');
      if (identity.user?.emailAddress?.toLowerCase() !== account.toLowerCase()) throw Error('Drive account mismatch');
      parents.set('', (await request(`${API}/root?fields=id`)).id);
    }
    const parts = run.target.split('/'); parts.pop(); let parent = parents.get('');
    for (let i = 0; i < parts.length; i++) {
      const key = parts.slice(0, i + 1).join('/');
      if (!parents.has(key)) {
        const q = `'${parent}' in parents and name = '${parts[i]}' and trashed = false`;
        const found = await request(`${API}?${new URLSearchParams({ q, fields: 'files(id,mimeType),nextPageToken' })}`);
        if (!Array.isArray(found.files) || found.nextPageToken || found.files.length > 1 || (!found.files.length && i < 2)) throw Error('missing/ambiguous canonical Drive folder');
        const entry = found.files[0] ?? await request(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: parts[i], parents: [parent], mimeType: 'application/vnd.google-apps.folder' }) });
        if (!entry.id || entry.mimeType !== 'application/vnd.google-apps.folder') throw Error('invalid archive folder');
        parents.set(key, entry.id);
      }
      parent = parents.get(key);
    }
    if (!uploaders.has(run.target)) uploaders.set(run.target, createDriveArchive({ parentId: parent, tokenImpl, fetchImpl }));
    return uploaders.get(run.target)({ runName: run.name, relativePath: member.path, absolutePath: member.absolutePath, size: member.bytes, sha256: member.sha256 });
  };
}
const rowFor = (source, target, f, account, receipt, manifest) => `- ${source} → ${target} | bytes=${f.bytes} | SHA256=${f.sha256} | account=${account} | cloud=pending | id=${receipt.id} | url=${receipt.url} | manifest=${manifest}\n`;
export async function archiveRuns(plan, { apply = false, pruneVerified = false, account, upload, readRemote = createDriveReader() } = {}) {
  if (pruneVerified && !apply) throw Error('prune requires --apply');
  if (!apply) return { runs: plan.runs.length, files: plan.files, bytes: plan.bytes, pending: 0, holds: [] };
  if (!/^[^@\s/|]+@[^@\s/|]+$/.test(account ?? '')) throw Error('expected account required');
  upload ??= createUploader(account);
  const ledgers = new Set(), heldRoots = new Set(), holds = [];
  for (const run of plan.runs) {
    if (heldRoots.has(run.root)) continue;
    const lock = join(run.root, '.archive-lock');
    try { await mkdir(lock); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      heldRoots.add(run.root);
      holds.push(`Repo held by lock ${lock}; confirm no archive is active, then clear this empty directory with rmdir and rerun.`);
      continue;
    }
    try {
      const fresh = await members(run.path);
      if (JSON.stringify(fresh) !== JSON.stringify(run.files)) throw Error('source changed since plan');
      const ledger = join(run.root, '_DRIVE-LEDGER.md'), manifestDir = join(run.root, '_archive-manifests');
      await mkdir(manifestDir, { recursive: true });
      if (!(await lstat(manifestDir)).isDirectory() || await realpath(manifestDir) !== manifestDir) throw Error('invalid manifest directory');
      const manifestPath = join(manifestDir, `${createHash('sha256').update(run.target).digest('hex')}.json`);
      const manifest = { source: run.path, host: hostname(), producer: run.owner,
        files: run.files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })),
        restore: 'Resolve each member via _DRIVE-LEDGER.md; GET exact Drive path, verify bytes/SHA256; preserve relative paths. Images: node scripts/drive/fetch-qa-image.mjs <ledger> <original-image-path>' };
      const text = JSON.stringify(manifest, null, 2) + '\n';
      try { await writeFile(manifestPath, text, { flag: 'wx' }); }
      catch (error) { if (error.code !== 'EEXIST' || await readFile(manifestPath, 'utf8') !== text) throw Error('manifest conflict'); }
      try { if (!(await lstat(ledger)).isFile()) throw Error('invalid ledger'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; await writeFile(ledger, '# QA-video Drive ledger\n', { flag: 'wx' }); }
      ledgers.add(ledger);
      const all = [...run.files, { path: 'MANIFEST.json', absolutePath: manifestPath, bytes: Buffer.byteLength(text), sha256: await digest(manifestPath) }];
      for (const f of all) {
        const target = `${run.target}/${f.path}`, existing = (await readFile(ledger, 'utf8')).split('\n').filter(line => line.includes(` → ${target} |`));
        if (existing.length) {
          if (existing.length !== 1 || parseRow(existing[0]).sha256 !== f.sha256 || parseRow(existing[0]).bytes !== f.bytes || parseRow(existing[0]).account !== account) throw Error('archive row conflict');
          continue;
        }
        const receipt = await upload(run, f);
        if (![receipt.id, receipt.url].every(safe)) throw Error('invalid upload receipt');
        await appendFile(ledger, rowFor(f.absolutePath, target, f, account, receipt, `${run.target}/MANIFEST.json`));
      }
      const sample = all.find(f => /\.(png|jpe?g|webp)$/i.test(f.path)) ?? all[0], hash = createHash('sha256'); let bytes = 0;
      try {
        for await (const chunk of await (await readRemote(`${run.target}/${sample.path}`, account)).body()) { bytes += chunk.length; if (bytes > sample.bytes) throw Error('restore size mismatch'); hash.update(chunk); }
        if (bytes !== sample.bytes || hash.digest('hex') !== sample.sha256) throw Error('restore drill failed');
      } catch { holds.push(`Restore drill failed for ${run.path}; local evidence retained.`); continue; }
      await verifyLedger(ledger, { apply: true, readRemote });
      if (!pruneVerified) continue;
      for (const f of all) {
        const line = (await readFile(ledger, 'utf8')).split('\n').find(line => line.includes(` → ${run.target}/${f.path} |`));
        if (!/\| cloud=verified /.test(line ?? '')) throw Error('prune requires verified rows');
        const remote = await readRemote(`${run.target}/${f.path}`, account);
        if (remote.bytes !== f.bytes || await remote.hash() !== f.sha256) throw Error('remote changed before prune');
      }
      if (JSON.stringify(await members(run.path)) !== JSON.stringify(fresh)) throw Error('source changed before prune');
      for (const f of run.files) await unlink(f.absolutePath);
      for (const dir of await directoryPaths(run.path)) {
        try { await rmdir(dir); }
        catch (error) { if (!['ENOTEMPTY', 'EEXIST', 'ENOENT'].includes(error.code)) throw error; }
      }
    } finally { await rmdir(lock); }
  }
  let pending = 0;
  for (const ledger of ledgers) pending += (await readFile(ledger, 'utf8')).split('\n').filter(line => /(?:^|\|)\s*cloud\s*=\s*pending\s*(?=\||$)/i.test(line)).length;
  return { runs: plan.runs.length, files: plan.files, bytes: plan.bytes, pending, holds };
}
export async function runCli(args, { configPath = join(homedir(), '.config/golems/qa-video-archive.json'), error = console.error, log = console.log } = {}) {
  try {
    const repos = [], flags = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--repo' && args[i + 1] && !args[i + 1].startsWith('--')) repos.push({ path: args[++i] });
      else if (['--apply', '--dry-run', '--prune-verified'].includes(args[i])) flags.push(args[i]);
      else throw Error('usage');
    }
    if ((flags.includes('--apply') && flags.includes('--dry-run')) || (repos.length && flags.includes('--apply'))) throw Error('inventory is dry-run only');
    let config;
    if (repos.length) config = { repos };
    else try { config = JSON.parse(await readFile(configPath, 'utf8')); }
    catch (caught) {
      if (caught.code !== 'ENOENT') throw caught;
      error(`qa-video-archive: missing config ${configPath}; configure account and repos entries with path, owner and harvestedRuns, then run --dry-run before enabling the monthly job.`);
      return 2;
    }
    const plan = await planArchive(config), apply = args.includes('--apply');
    const result = await archiveRuns(plan, { apply, pruneVerified: args.includes('--prune-verified'), account: config.account });
    for (const hold of result.holds) error(`qa-video-archive: ${hold}`);
    log(`qa-video-archive: mode=${apply ? 'apply' : 'dry-run'} runs=${result.runs} files=${result.files} bytes=${result.bytes} age-runs=${plan.ageRuns} age-bytes=${plan.ageBytes} held=${plan.held.length + result.holds.length} pending=${result.pending}`);
    return result.pending || result.holds.length ? 1 : 0;
  } catch { error('qa-video-archive: stopped; check outside-repo config, ownership/holds, auth and archive conflicts'); return 2; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCli(process.argv.slice(2));
}
