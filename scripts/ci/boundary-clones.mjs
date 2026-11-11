#!/usr/bin/env node
// Manage only pre-push; leave core.hooksPath and every other hook untouched.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, renameSync, chmodSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
const quote = s => "'" + s.replaceAll("'", "'\\''") + "'";
const source = dirname(fileURLToPath(import.meta.url));
function git(repo, ...args) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('clone Git evidence unavailable');
  return r.stdout.trim();
}
export function syncClones({ root = join(homedir(), 'Gits'), apply = false, node = process.execPath, report = console.log } = {}) {
  const version = createHash('sha256');
  for (const file of ['boundary-prepush.mjs', 'boundary-clones.mjs', '../publish-boundary-policy.yaml', '../../.publish-boundary-allow']) version.update(readFileSync(join(source, file)));
  const digest = version.digest('hex');
  const targets = new Set();
  for (const entry of readdirSync(root)) {
    const repo = join(root, entry);
    if (!statSync(repo).isDirectory() || !existsSync(join(repo, '.git'))) continue;
    for (const line of git(repo, 'worktree', 'list', '--porcelain').split('\n')) {
      if (!line.startsWith('worktree ')) continue;
      const worktree = line.slice(9);
      targets.add(resolve(worktree, git(worktree, 'rev-parse', '--git-path', 'hooks'), 'pre-push'));
    }
  }
  let drift = 0;
  for (const target of targets) {
    const prior = target + '.golems-original';
    const wrapper = `#!/bin/sh\n# golems-boundary-managed-v1\n# source-sha256=${digest}\nset -eu\ncommand -v ${quote(node)} >/dev/null 2>&1 || { echo 'boundary-prepush: REFUSED: Node missing' >&2; exit 1; }\nupdates=$(cat)\nprintf '%s\\n' "$updates" | ${quote(node)} ${quote(join(source, 'boundary-prepush.mjs'))} "$@" || exit $?\nif [ -x ${quote(prior)} ]; then printf '%s\\n' "$updates" | ${quote(prior)} "$@"; fi\n`;
    const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
    const ok = current === wrapper && (statSync(target).mode & 0o111) !== 0;
    if (!ok) {
      drift++;
      if (apply) {
        mkdirSync(dirname(target), { recursive: true });
        if (current && !current.includes('# golems-boundary-managed-v1')) {
          if (existsSync(prior)) throw new Error('foreign hook and backup both exist; refusing overwrite');
          renameSync(target, prior);
        }
        writeFileSync(target, wrapper, { mode: 0o755 }); chmodSync(target, 0o755);
      }
    }
    report(`boundary-prepush clone=${target} ${ok ? 'ok' : apply ? 'repaired' : 'drift'}`);
  }
  report(`boundary-prepush-drift=${apply ? 0 : drift} clones=${targets.size}`);
  return apply ? 0 : drift;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.some(a => a !== '--apply' && a !== '--status')) throw new Error('usage: boundary-clones.mjs [--apply|--status]');
    process.exitCode = syncClones({ apply: args.includes('--apply') }) ? 1 : 0;
  } catch (e) { console.error(`boundary-prepush: REFUSED: ${e.message}`); process.exitCode = 1; }
}
