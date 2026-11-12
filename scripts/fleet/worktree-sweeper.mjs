#!/usr/bin/env node
import { appendFileSync, existsSync, lstatSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execute, fleetDir } from './fleet-runtime.mjs';
import { repositories, worktrees, inspect, latest, builds, git } from './worktree-state.mjs';
import { closeWorktree } from './worktree-closeout.mjs';
import { stackHold } from './worktree-preservation.mjs';
export function sweep(roots, state = {}, now = Date.now(), log = () => {}) {
  const next = structuredClone(state); next.warned ??= {}; const posts = [];
  for (const repo of repositories(roots)) {
    try { git(repo, 'fetch', '--prune', 'origin'); } catch { log('retained repo (fetch failed) ' + repo); continue; }
    for (const tree of worktrees(repo)) {
    const path = tree.worktree;
    if (resolve(path) === resolve(repo) || tree.locked || tree.prunable) continue;
    try {
      const before = inspect(path); const age = now - latest(path);
      if (before.dirty || !before.pushed) {
        if (age >= 48 * 3600000 && now - (next.warned[path] ?? 0) >= 86400000) {
          posts.push(`\n### worktree-sweeper → @orc — ${new Date(now).toISOString()} retained ${path}: ${before.dirty ? 'dirty' : 'unpushed'}\n`);
          next.warned[path] = now;
        }
        continue;
      }
      // Recheck immediately before mutation; git remove itself refuses concurrent dirt.
      const current = inspect(path);
      if (current.dirty || !current.pushed || current.head !== before.head) continue;
      if (current.merged) { const receipt = closeWorktree(path, current.head, false); log(receipt.receiptLine || receipt.reason); continue; }
      if (age < 12 * 3600000) continue;
      const hold = stackHold(path, tree.branch?.replace('refs/heads/', ''));
      if (hold) { log(hold); continue; }
      for (const name of builds) {
        const target = join(path, name);
        if (!existsSync(target) || lstatSync(target).isSymbolicLink()) continue;
        // Delete only ignored output, never tracked files or arbitrary named directories.
        if (git(path, 'ls-files', '--', name)) continue;
        try { git(path, 'check-ignore', '--quiet', target); } catch { continue; }
        if (inspect(path).dirty || latest(path) > now - 12 * 3600000) break;
        rmSync(target, { recursive: true }); log('cleaned ' + target);
      }
    } catch { log('retained (inspection/removal failed) ' + path); }
  }
  }
  return { state: next, posts };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = execute('sweeper', (s, c) =>
  sweep(c.repoRoots ?? [join(homedir(), 'Gits'), join(homedir(), '.t3/worktrees')], s, Date.now(),
    text => appendFileSync(join(fleetDir, 'sweeper.log'), new Date().toISOString() + ' ' + text + '\n')));
