#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execute, fleetDir } from './fleet-runtime.mjs';
import { repositories, worktrees, inspect, latest, git } from './worktree-state.mjs';
import { closeWorktree, cleanOutputs } from './worktree-closeout.mjs';
import { stackHold, loadPullRequests, liveReferences } from './worktree-preservation.mjs';
export function sweep(roots, state = {}, now = Date.now(), log = () => {}) {
  const next = structuredClone(state); next.warned ??= {}; const posts = [];
  for (const repo of repositories(roots)) {
    try { git(repo, 'fetch', '--prune', 'origin'); } catch { log('retained repo (fetch failed) ' + repo); continue; }
    let prs; try {prs=loadPullRequests(repo);} catch {log('retained repo (PR lookup failed) '+repo);continue;}
    for (const tree of worktrees(repo)) {
    const path = tree.worktree;
    if (resolve(path) === resolve(repo) || tree.locked || tree.prunable) continue;
    try {
      const hold=stackHold(path, tree.branch?.replace('refs/heads/', ''), prs);
      const before = inspect(path, prs); const age = now - latest(path);
      if (before.dirty || !before.pushed) {
        if (age >= 48 * 3600000 && now - (next.warned[path] ?? 0) >= 86400000) {
          posts.push(`\n### worktree-sweeper → @orc — ${new Date(now).toISOString()} retained ${path}: ${before.dirty ? 'dirty' : 'unpushed'}\n`);
          next.warned[path] = now;
        }
        continue;
      }
      // Recheck immediately before mutation; git remove itself refuses concurrent dirt.
      const current = inspect(path, prs);
      if (current.dirty || !current.pushed || current.head !== before.head) continue;
      if (age < 12 * 3600000) continue;
      if (current.merged && !hold) { const receipt = closeWorktree(path, current.head, false, {prs,now}); log(receipt.receiptLine || receipt.reason); continue; }
      if(hold)log(hold);
      // An open stack keeps source/docs, but does not hold regenerable output.
      const live=liveReferences(path); if(live){log(live);continue;}
      cleanOutputs(path,true);
      const final=inspect(path,prs);
      if(final.dirty||!final.pushed||final.head!==before.head||latest(path)>now-12*3600000)continue;
      const freed=cleanOutputs(path); if(freed)log('cleaned build bytes '+freed+' from '+path);

    } catch { log('retained (inspection/removal failed) ' + path); }
  }
  }
  return { state: next, posts };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = execute('sweeper', (s, c) =>
  sweep(c.repoRoots ?? [join(homedir(), 'Gits'), join(homedir(), '.t3/worktrees')], s, Date.now(),
    text => appendFileSync(join(fleetDir, 'sweeper.log'), new Date().toISOString() + ' ' + text + '\n')));
