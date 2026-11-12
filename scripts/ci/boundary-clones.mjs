#!/usr/bin/env node
// A managed hooks directory chains every existing hook; original files stay untouched.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, chmodSync } from 'node:fs';
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
  for (const file of ['boundary-prepush.mjs', 'identity-precommit.mjs', 'boundary-clones.mjs', '../publish-boundary-policy.yaml', '../../.publish-boundary-allow']) version.update(readFileSync(join(source, file)));
  const digest = version.digest('hex');
  const targets = new Set();
  let drift = 0;
  const hooks = ['applypatch-msg', 'pre-applypatch', 'post-applypatch', 'pre-commit', 'pre-merge-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit', 'pre-rebase', 'post-checkout', 'post-merge', 'pre-push', 'pre-receive', 'update', 'post-receive', 'post-update', 'push-to-checkout', 'pre-auto-gc', 'post-rewrite', 'sendemail-validate', 'reference-transaction'];
  for (const entry of existsSync(root) ? readdirSync(root) : []) {
    const repo = join(root, entry);
    if (!statSync(repo).isDirectory() || !existsSync(join(repo, '.git'))) continue;
    const common = resolve(repo, git(repo, 'rev-parse', '--git-common-dir'));
    if (targets.has(common)) continue;
    targets.add(common);
    const managed = join(common, 'golems-boundary-hooks');
    const record = join(common, 'golems-boundary-hooks.json');
    const config = spawnSync('git', ['-C', repo, 'config', '--get', 'core.hooksPath'], { encoding: 'utf8' });
    if (![0, 1].includes(config.status)) throw new Error('cannot read hooks config');
    const current = config.status === 0 ? config.stdout.trim() : null;
    let original = existsSync(record) ? JSON.parse(readFileSync(record, 'utf8')).original : current;
    if (current === managed && !existsSync(record)) throw new Error('managed hooks have no custody record');
    if (original === managed || (original !== null && typeof original !== 'string')) throw new Error('invalid original hooks path');
    // Absolute original paths stay absolute; relative ones remain relative to
    // Git's hook cwd, so each worktree retains its own repository hooks.
    const previous = original ?? join(common, 'hooks');
    let bad = current !== managed;
    for (const name of hooks) {
      const prior = join(previous, name);
      const prefix = `#!/bin/sh\n# golems-boundary-managed-v1\n# source-sha256=${digest}\nset -eu\n`;
      const chain = `if [ -x ${quote(prior)} ]; then exec ${quote(prior)} "$@"; fi\n`;
      const wrapper = name === 'pre-push' ? prefix + `command -v ${quote(node)} >/dev/null 2>&1 || { echo 'boundary-prepush: REFUSED: Node missing' >&2; exit 1; }\nupdates=$(cat)\nprintf '%s\\n' "$updates" | ${quote(node)} ${quote(join(source, 'boundary-prepush.mjs'))} "$@" || exit $?\nif [ -x ${quote(prior)} ]; then printf '%s\\n' "$updates" | ${quote(prior)} "$@"; fi\n` : name === 'pre-commit' ? prefix + `command -v ${quote(node)} >/dev/null 2>&1 || { echo 'identity-precommit: REFUSED: Node missing' >&2; exit 1; }\n${quote(node)} ${quote(join(source, 'identity-precommit.mjs'))} "$@" || exit $?\n` + chain : prefix + chain;
      const target = join(managed, name);
      const ok = existsSync(target) && readFileSync(target, 'utf8') === wrapper && (statSync(target).mode & 0o111) !== 0;
      bad ||= !ok;
      if (apply && !ok) { mkdirSync(managed, { recursive: true }); writeFileSync(target, wrapper, { mode: 0o755 }); chmodSync(target, 0o755); }
    }
    // Worktree-specific overrides must never silently bypass the common hook.
    for (const line of git(repo, 'worktree', 'list', '--porcelain').split('\n')) {
      if (!line.startsWith('worktree ')) continue;
      const wt = line.slice(9);
      // Missing registered worktrees cannot serve pushes. Keep their metadata
      // untouched; the common hook config also covers them when restored.
      if (!existsSync(wt)) continue;
      const r = spawnSync('git', ['-C', wt, 'config', '--get', 'core.hooksPath'], { encoding: 'utf8' });
      if (![0, 1].includes(r.status)) throw new Error('cannot read worktree hooks config');
      if (r.status === 0 && r.stdout.trim() !== current && r.stdout.trim() !== managed) throw new Error('worktree-specific hooks override requires explicit reconciliation');
    }
    if (apply) {
      writeFileSync(record, JSON.stringify({ original }) + '\n', { mode: 0o600 });
      git(repo, 'config', '--local', 'core.hooksPath', managed);
    }
    if (bad) drift++;
    report(`boundary-prepush clone=${repo} ${bad ? apply ? 'repaired' : 'drift' : 'ok'}`);
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
