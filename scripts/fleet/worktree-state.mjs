import { lstatSync, readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { run } from './fleet-runtime.mjs';
import { latestPR } from './worktree-preservation.mjs';
export const builds = ['node_modules', '.build', '.build.noindex', '.test-tmp', '.next', 'dist', 'target', '__pycache__', '.venv'];
export function outputNames(p) {
  const config=join(p,'.golems-closeout.json'), extra=existsSync(config)?JSON.parse(readFileSync(config,'utf8')).outputs||[]:[];
  if(!Array.isArray(extra)||extra.some(x=>typeof x!=='string'||!x||x==='.'||x==='..'||x.includes('/')||x.includes('\\')||x==='.git'))throw Error('outputs must contain directory basenames only, excluding .git.');
  return [...builds,...extra];
}
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
export function worktreeStatus(worktreePath, prs = []) {
 const w={path:worktreePath};
 const hidden=git(w.path,'ls-files','-v').split('\n').some(l=>/^[a-zS]/.test(l));
 const dirty=hidden||!!git(w.path,'status','--porcelain','--untracked-files=all');
 const unpushed=!!git(w.path,'rev-list','HEAD','--not','--remotes');
 const head=git(w.path,'rev-parse','HEAD');let branch;try{branch=git(w.path,'symbolic-ref','--quiet','--short','HEAD');}catch{}
 const pr=latestPR(prs,branch);let merged=false;
 if(pr?.merged&&pr.headSha){if(head===pr.headSha)merged=true;else try{git(w.path,'merge-base','--is-ancestor',head,pr.headSha);merged=true;}catch{}}
 return {head,dirty,unpushed,state:dirty?'dirty':unpushed?'unpushed':merged?'merged':'pushed-clean',merged};
}
export function inspect(path, prs = []) {
  const branchRef = git(path, 'symbolic-ref', '--quiet', 'HEAD'), branch = branchRef.replace('refs/heads/','');
  const upstream = git(path, 'for-each-ref', '--format=%(upstream)', branchRef);
  const status = worktreeStatus(path,prs), merged=status.merged; let upstreamPresent=false;
  if (upstream) try {git(path, 'rev-parse', '--verify', upstream); upstreamPresent = true;} catch {}
  const ignored = git(path, 'ls-files', '--others', '--ignored', '--exclude-standard', '-z').split('\0').filter(Boolean);
  const names=outputNames(path);
  const privateData = ignored.some(p => !p.startsWith('docs.local/') && !p.split('/').slice(0,-1).some(part=>names.includes(part)));
  return {dirty: status.dirty || privateData, privateData, pushed: merged || upstreamPresent && !status.unpushed,
    merged, head: status.head, branch, remoteDeletedAfterMerge: merged && !upstreamPresent};
}
