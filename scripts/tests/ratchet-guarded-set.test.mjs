import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hookDriftPaths } from '../hooks/install-hooks.mjs';

// FV3 (TLA+ NoFalseFresh, 2026-11-02): 13 of 17 hook-loaded dirs were outside the guarded set, so a merge there
// skipped the live receipt and freshness stayed green on a stale hook. Every hook-loaded dir must be guarded.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(readFileSync(join(root, 'scripts/hooks/manifest.json'), 'utf8'));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

test('the guarded set covers every hook-loaded dir, and live-freshness uses the same set', async () => {
  const { guardedPrefixes, STATIC_GUARDED } = await import('../ratchet/guarded-set.mjs');
  const prefixes = guardedPrefixes([manifest]);
  for (const dir of [...hookDriftPaths(manifest), ...STATIC_GUARDED]) assert.ok(prefixes.includes(dir), `${dir} not guarded`);
  const freshness = readFileSync(join(root, 'scripts/ratchet/live-freshness.mjs'), 'utf8');
  assert.match(freshness, /guardedPrefixes\(/, 'live-freshness must derive its pathspecs from guarded-set.mjs');
  assert.doesNotMatch(freshness, /'skills\/golem-powers\/tmp-block\/'/, 'no second hand-written guarded list');
});

test('guarded-paths.sh: a change in any hook-loaded dir is guarded; docs are not; unknown refs cannot tell', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'guarded-set-'));
  const tree = join(scratch, 'tree');
  try {
    git(root, 'worktree', 'add', '--detach', tree, 'HEAD');
    const base = git(tree, 'rev-parse', 'HEAD');
    const commitTouching = (path) => {
      git(tree, 'checkout', '-q', '--detach', base);
      mkdirSync(join(tree, dirname(path)), { recursive: true });
      writeFileSync(join(tree, path), 'guarded-set test\n');
      git(tree, 'add', '-f', path);
      git(tree, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', `touch ${path}`);
      return git(tree, 'rev-parse', 'HEAD');
    };
    // Run the script under test (this checkout's), with git operating on the scratch tree's commits.
    const verdict = (head, b = base) => spawnSync('bash', [join(root, 'scripts/ratchet/guarded-paths.sh'), b, head], { cwd: tree, encoding: 'utf8' });
    for (const dir of hookDriftPaths(manifest)) {
      const r = verdict(commitTouching(`${dir}guarded-set-probe.txt`));
      assert.equal(r.status, 0, `${dir}: expected guarded, got ${r.status}: ${r.stdout}${r.stderr}`);
    }
    assert.equal(verdict(commitTouching('docs/guarded-set-probe.md')).status, 1);
    assert.equal(verdict(base, 'deadbeef'.repeat(5)).status, 2);
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', tree], { cwd: root });
    rmSync(scratch, { recursive: true, force: true });
  }
});
