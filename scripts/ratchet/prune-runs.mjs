#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function defaultRoot() {
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
  return path.resolve(common, '..', 'docs.local/ratchet-runs');
}
function checkedRoot(root) {
  root = path.resolve(root);
  if (fs.lstatSync(root).isSymbolicLink() || fs.realpathSync(root) !== root) throw new Error('symlink root refused');
  if (!fs.statSync(root).isDirectory()) throw new Error('root must be a directory');
  return root;
}
// Inspect all descendants: writes to an existing log need not update the run directory.
// Only read-only size measurement permits links; lstat counts the link, never its target.
export function inspectTree(target, { allowSymlinks = false } = {}) {
  const st = fs.lstatSync(target);
  if (st.isSymbolicLink() && !allowSymlinks) throw new Error(`symlink refused: ${target}`);
  let bytes = st.blocks * 512, modified = st.mtimeMs;
  if (st.isDirectory()) for (const name of fs.readdirSync(target)) {
    const child = inspectTree(path.join(target, name), { allowSymlinks });
    bytes += child.bytes; modified = Math.max(modified, child.modified);
  }
  return { bytes, modified, dev: st.dev, ino: st.ino };
}
export function planRuns(root, { keep = 3, citations, now = Date.now() } = {}) {
  root = checkedRoot(root);
  if (!Number.isSafeInteger(keep) || keep < 1) throw new Error('keep must be a positive integer');
  if (typeof citations !== 'string') throw new Error('open PR citations required');
  const hashes = citations.match(/\b[0-9a-f]{7,40}\b/gi) ?? [];
  const rows = fs.readdirSync(root).sort().map(name => {
    const target = path.join(root, name);
    const measured = inspectTree(target);
    const match = /^(.+)-([0-9a-f]{7,40})-(\d{8}T\d{6,12})(?:Z)?$/.exec(name);
    const row = { name, ...measured, action: 'keep', reason: 'unparseable name' };
    if (!fs.statSync(target).isDirectory() || !match) return row;
    Object.assign(row, { lane: match[1], sha: match[2], timestamp: match[3] });
    if (citations.includes(name) || hashes.some(h => h.toLowerCase().startsWith(row.sha) || row.sha.startsWith(h.toLowerCase()))) row.reason = 'open PR citation';
    else if (now - measured.modified < 2 * 3600000) row.reason = 'modified within two hours';
    else { row.action = 'delete'; row.reason = 'outside retention'; }
    return row;
  });
  for (const lane of new Set(rows.filter(r => r.lane).map(r => r.lane))) {
    const runs = rows.filter(r => r.lane === lane).sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.name.localeCompare(a.name));
    const latest = new Map();
    for (const row of runs) if (!latest.has(row.sha)) latest.set(row.sha, row);
    for (const row of [...latest.values()].slice(0, keep)) { row.action = 'keep'; row.reason = 'latest SHA retention'; }
  }
  return rows;
}
export function applyPlan(root, plan) {
  root = checkedRoot(root);
  for (const row of plan.filter(r => r.action === 'delete')) {
    if (path.basename(row.name) !== row.name || row.name === '.' || row.name === '..') throw new Error('not a direct child');
    const target = path.join(root, row.name);
    const current = inspectTree(target);
    if (fs.realpathSync(target) !== target || current.dev !== row.dev || current.ino !== row.ino || current.modified !== row.modified || current.bytes !== row.bytes) throw new Error(`run changed: ${row.name}`);
    if (Date.now() - current.modified < 2 * 3600000) throw new Error(`recent run: ${row.name}`);
    fs.rmSync(target, { recursive: true });
  }
}
function citationsFromGitHub() {
  // Fetch bodies and all issue/review comments for every open PR; failure means no deletion.
  const api = endpoint => JSON.parse(execFileSync('gh', ['api', '--paginate', '--slurp', endpoint], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })).flat();
  const prs = api('repos/EtanHey/golems/pulls?state=open&per_page=100');
  const text = [];
  for (const pr of prs) {
    text.push(pr.body ?? '');
    for (const type of [`issues/${pr.number}/comments`, `pulls/${pr.number}/comments`, `pulls/${pr.number}/reviews`]) {
      for (const comment of api(`repos/EtanHey/golems/${type}?per_page=100`)) text.push(comment.body ?? '');
    }
  }
  return text.join('\n');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.some(a => !['--dry-run', '--apply'].includes(a)) || args.length > 1) throw new Error('usage: prune-runs.mjs [--dry-run|--apply]');
    const root = defaultRoot();
    if (!fs.existsSync(root)) { console.log(`No run root: ${root}`); process.exit(0); }
    const plan = planRuns(root, { keep: Number(process.env.GOLEMS_RATCHET_RUNS_KEEP ?? 3), citations: citationsFromGitHub() });
    for (const row of plan) console.log(`${row.action.toUpperCase()} ${row.name} ${(row.bytes / 1e9).toFixed(3)} GB: ${row.reason}`);
    const removed = plan.filter(r => r.action === 'delete');
    console.log(`${args[0] === '--apply' ? 'Apply' : 'Dry-run'}: ${removed.length}/${plan.length} entries, ${(removed.reduce((sum, r) => sum + r.bytes, 0) / 1e9).toFixed(3)} GB reclaimable`);
    if (args[0] === '--apply') applyPlan(root, plan);
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
