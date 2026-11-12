import { lstatSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { run } from './fleet-runtime.mjs';
import { worktreeStatus } from './worktree-closeout.mjs';
export const builds = ['node_modules', '.build', '.build.noindex', '.test-tmp', '.next'];
export const git = (cwd, ...args) => run('git', ['-C', cwd, ...args]);
export function latest(path) {
  const s = lstatSync(path); let m = s.mtimeMs;
  if (s.isDirectory() && !s.isSymbolicLink()) for (const name of readdirSync(path)) m = Math.max(m, latest(join(path, name)));
  return m;
}
export function repositories(roots) {
  const found = new Set();
  function visit(path, depth) {
    if (!existsSync(path) || lstatSync(path).isSymbolicLink()) return;
    if (existsSync(join(path, '.git'))) {
      const common = git(path, 'rev-parse', '--path-format=absolute', '--git-common-dir');
      found.add(resolve(common, '..')); return;
    }
    if (depth) for (const e of readdirSync(path, { withFileTypes: true })) if (e.isDirectory()) visit(join(path, e.name), depth - 1);
  }
  for (const root of roots) visit(root, 2);
  return [...found];
}
export function worktrees(repo) {
  return git(repo, 'worktree', 'list', '--porcelain', '-z').split('\0\0').filter(Boolean).map(block =>
    Object.fromEntries(block.split('\0').filter(Boolean).map(line => { const i = line.indexOf(' '); return i < 0 ? [line, true] : [line.slice(0, i), line.slice(i + 1)]; })));
}
export function inspect(path) {
  // Sweeper admission requires named, resolvable refs; classification is shared.
  const branch = git(path, 'symbolic-ref', '--quiet', 'HEAD');
  const upstream = git(path, 'for-each-ref', '--format=%(upstream)', branch);
  if (upstream) git(path, 'rev-parse', '--verify', upstream);
  git(path, 'symbolic-ref', 'refs/remotes/origin/HEAD');
  const status = worktreeStatus(path);
  const ignored = git(path, 'ls-files', '--others', '--ignored', '--exclude-standard').split('\n').filter(Boolean);
  const privateData = ignored.some(p => !builds.some(b => p.startsWith(b + '/')));
  return { dirty: status.dirty || privateData, pushed: !!upstream && !status.unpushed, merged: status.merged, head: status.head };
}
