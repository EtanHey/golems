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

// Codex review r1 (2026-11-02): both reproduced with real git objects.
function disposableRepo(manifest) {
  const dir = mkdtempSync(join(tmpdir(), 'guarded-set-repo-'));
  const g = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: dir, encoding: 'utf8' }).trim();
  g('init', '-q');
  mkdirSync(join(dir, 'scripts/hooks'), { recursive: true });
  writeFileSync(join(dir, 'scripts/hooks/manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(dir, 'scripts/hooks/probe.py'), 'one\n');
  g('add', '-A'); g('commit', '-qm', 'base');
  return { dir, g, base: g('rev-parse', 'HEAD') };
}
const verdictIn = (dir, base, head) => spawnSync('bash', [join(root, 'scripts/ratchet/guarded-paths.sh'), base, head], { cwd: dir, encoding: 'utf8' });

test('B1: a regex metacharacter in a manifest source never turns a guarded change into "not guarded"', () => {
  const { dir, g, base } = disposableRepo({ hosts: { test: [{ kind: 'golems', source: 'hooks/bad[/hook.py' }] } });
  try {
    writeFileSync(join(dir, 'scripts/hooks/probe.py'), 'two\n');
    g('add', '-A'); g('commit', '-qm', 'static guarded change');
    assert.equal(verdictIn(dir, base, g('rev-parse', 'HEAD')).status, 0, 'scripts/hooks/ stays guarded');
    mkdirSync(join(dir, 'hooks/bad['), { recursive: true });
    writeFileSync(join(dir, 'hooks/bad[/hook.py'), 'x\n');
    g('add', '-A'); g('commit', '-qm', 'literal metacharacter dir');
    assert.equal(verdictIn(dir, g('rev-parse', 'HEAD~1'), g('rev-parse', 'HEAD')).status, 0, 'hooks/bad[/ matches literally');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('B2: a manifest that exists but cannot be read fails closed (exit 2), never static-only', () => {
  const { dir, g, base } = disposableRepo({ hosts: { test: [{ kind: 'golems', source: 'skills/golem-powers/model-pin-gate' }] } });
  try {
    mkdirSync(join(dir, 'skills/golem-powers/model-pin-gate'), { recursive: true });
    writeFileSync(join(dir, 'skills/golem-powers/model-pin-gate/a.py'), 'one\n');
    g('add', '-A'); g('commit', '-qm', 'gate');
    const mid = g('rev-parse', 'HEAD');
    writeFileSync(join(dir, 'skills/golem-powers/model-pin-gate/a.py'), 'two\n');
    g('add', '-A'); g('commit', '-qm', 'gate change');
    const head = g('rev-parse', 'HEAD');
    assert.equal(verdictIn(dir, mid, head).status, 0, 'readable manifest: the hook dir is guarded');
    const blob = g('rev-parse', `${head}:scripts/hooks/manifest.json`);
    rmSync(join(dir, '.git/objects', blob.slice(0, 2), blob.slice(2)));
    const r = verdictIn(dir, mid, head);
    assert.equal(r.status, 2, `unreadable manifest must be "cannot tell", got ${r.status}: ${r.stdout}${r.stderr}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
