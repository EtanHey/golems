// Shared closeout gates. Unknown GitHub state or unsafe archive paths retain the tree.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
export const PR_QUERY = '.[] | {number, state, merged: (.merged_at != null), head: (if .head.repo.full_name == .base.repo.full_name then .head.ref else (.head.label // ("deleted:" + (.number|tostring))) end), base: .base.ref, headSha: .head.sha}';
export function loadPullRequests(repo) {
  const output = execFileSync('gh', ['api', '--paginate', 'repos/{owner}/{repo}/pulls?state=all&per_page=100', '--jq', PR_QUERY],
    { cwd: repo, encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
  const rows = output.trim() ? output.trim().split('\n').map(line => JSON.parse(line)) : [];
  if (rows.some(p => !Number.isInteger(p.number) || !['open','closed'].includes(p.state) || typeof p.merged !== 'boolean' || typeof p.head !== 'string' || typeof p.base !== 'string' || !/^[a-f0-9]{40,64}$/.test(p.headSha))) throw Error('Invalid PR stack state');
  return rows;
}
export const latestPR = (rows, branch) => rows.filter(p => p.head === branch).sort((a,b) => b.number-a.number)[0];
export function stackHold(repo, branch, rows = loadPullRequests(repo)) {
  if (!branch) throw Error('Detached worktree: stack state unknown');
  const defaultBranch = git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD').replace('refs/remotes/origin/', '');
  // Branch reuse: the latest PR for a head defines its current stack edges.
  const latest = new Map();
  for (const p of rows) if (!latest.has(p.head) || latest.get(p.head).number < p.number) latest.set(p.head, p);
  const edges = [...latest.values(), ...rows.filter(p => p.state === 'open' && latest.get(p.head) !== p)];
  const connected = new Set([branch]); let changed;
  do {
    changed = false;
    for (const p of edges) if (p.base !== defaultBranch && (connected.has(p.head) || connected.has(p.base))) {
      for (const b of [p.head, p.base]) if (!connected.has(b)) { connected.add(b); changed = true; }
    }
  } while (changed);
  const open = edges.filter(p => p.state === 'open' && connected.has(p.head) && (p.head !== branch || p.base !== defaultBranch));
  if (open.length) return `kept: stack ${open.map(p => '#' + p.number).sort().join(', ')} open`;
  const own = latest.get(branch);
  if (own && own.base !== defaultBranch && !latest.get(own.base)?.merged) return `kept: stack #${own.number} base ${own.base} unmerged or unknown`;
  return null;
}
export function liveReferences(p) {
  // Recursive lsof is O(files + process descriptors), twice per removal admission.
  const r = spawnSync('lsof', ['-nP', '-Fpn', '+D', p], { encoding: 'utf8', timeout: 60000, maxBuffer: 16*1024*1024 });
  if (r.status === 1 && !r.stdout && !r.stderr) return null;
  if (/^p\d+/m.test(r.stdout ?? '')) return 'kept: live process cwd/open files under worktree';
  return 'kept: liveness unknown (lsof failed or incomplete)';
}
// Single convention point; attribution survey can replace this policy without rewriting copy logic.
export const archiveConvention = {
  destination: (primary, branch) => path.join(primary, 'docs.local', 'worktree-archive', encodeURIComponent(branch)),
  manifest: (receipt, {pr, branch, threadId}) => ({...receipt, pr: pr?.number ?? null, branch, headSha: receipt.head, threadId: threadId ?? process.env.T3_THREAD_ID ?? process.env.CODEX_THREAD_ID ?? null})
};
function syncFile(p) { const fd=fs.openSync(p,'r'); try {fs.fsyncSync(fd);} finally {fs.closeSync(fd);} }
function syncDirectory(p) { const fd=fs.openSync(p,'r'); try {fs.fsyncSync(fd);} finally {fs.closeSync(fd);} }
function hash(p) {
  const h = createHash('sha256'), fd = fs.openSync(p, 'r'), buffer = Buffer.alloc(65536);
  try { let n; while ((n = fs.readSync(fd, buffer, 0, buffer.length, null))) h.update(buffer.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return h.digest('hex');
}
function directory(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p);
  if (fs.lstatSync(p).isSymbolicLink() || !fs.lstatSync(p).isDirectory()) throw Error(`Unsafe archive directory: ${p}`);
}
export function preserveDocs(worktree, primary, branch, head, attribution = {}) {
  const source = path.join(worktree, 'docs.local');
  if (!fs.existsSync(source)) return { files: [], bytes: 0, destination: null, collision: false };
  const tracked = new Set(git(worktree, 'ls-files', '-z', '--', 'docs.local').split('\0').filter(Boolean));
  function scan() {
    const files = [];
    function walk(p) {
      const s = fs.lstatSync(p), relative = path.relative(worktree, p);
      if (tracked.has(relative)) return;
      if (s.isSymbolicLink()) throw Error(`Symlink in docs.local: ${relative}`);
      if (s.isDirectory()) {
        if (fs.existsSync(path.join(p, '.git'))) throw Error('Nested repository in docs.local');
        for (const name of fs.readdirSync(p).sort()) walk(path.join(p, name));
      } else if (s.isFile()) files.push({ path: path.relative(source, p), bytes: s.size, sha256: hash(p) });
      else throw Error(`Special file in docs.local: ${relative}`);
    }
    walk(source); return files;
  }
  const files = scan();
  if (!files.length) return { files, bytes: 0, destination: null, collision: false };
  const stem = archiveConvention.destination(primary, branch), parent = path.dirname(stem);
  git(primary, 'check-ignore', '--quiet', '--', path.join(stem, 'probe'));
  directory(path.join(primary, 'docs.local')); directory(parent);
  let destination = stem, suffix = 1;
  for (;;) {
    if (fs.existsSync(destination + '.receipt.json')) { destination = stem + '-' + (++suffix); continue; }
    try { fs.mkdirSync(destination); break; }
    catch (e) { if (e.code !== 'EEXIST') throw e; destination = stem + '-' + (++suffix); }
  }
  const manifest = destination + '.receipt.json';
  const targets = [...files.map(f => path.join(destination, f.path)), manifest];
  const ignored = execFileSync('git', ['check-ignore', '--stdin', '-z'], { cwd: primary, input: targets.join('\0') + '\0', encoding: 'utf8' }).split('\0').filter(Boolean);
  if (targets.some(p => !ignored.includes(p))) throw Error('Archive destination is not entirely gitignored');
  for (const file of files) {
    const target = path.join(destination, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(source, file.path), target, fs.constants.COPYFILE_EXCL);
    syncFile(target); for(let dir=path.dirname(target);dir!==path.dirname(destination);dir=path.dirname(dir))syncDirectory(dir);
    if (hash(target) !== file.sha256 || fs.statSync(target).size !== file.bytes) throw Error('Archive hash verification failed');
  }
  // All copies and the complete source inventory must verify before any unlink.
  if (JSON.stringify(scan()) !== JSON.stringify(files)) throw Error('docs.local changed during archival; originals retained');
  const receipt = archiveConvention.manifest({ worktree, head, destination, files, bytes: files.reduce((n, f) => n + f.bytes, 0), collision: suffix > 1 }, {...attribution, branch});
  fs.writeFileSync(manifest, JSON.stringify(receipt, null, 2), { flag: 'wx' });
  syncFile(manifest); syncDirectory(destination); syncDirectory(parent); syncDirectory(path.dirname(parent));
  if (fs.readFileSync(manifest, 'utf8') !== JSON.stringify(receipt, null, 2)) throw Error('Archive receipt readback failed');
  if (JSON.stringify(scan()) !== JSON.stringify(files)) throw Error('docs.local changed before unlink; originals retained');
  for (const file of files) fs.unlinkSync(path.join(source, file.path));
  return receipt;
}
