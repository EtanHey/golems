import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, unlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { syncClones } from '../ci/boundary-clones.mjs';
const checker = resolve('scripts/ci/boundary-prepush.mjs');
const run = (cwd, cmd, args, input, env = process.env) => spawnSync(cmd, args, { cwd, input, env, encoding: 'utf8' });
test('real local push boundary, history, chain and drift', () => {
  const root = mkdtempSync(join(tmpdir(), 'boundary-test-'));
  const repo = join(root, 'clone'); mkdirSync(repo);
  const git = (...args) => { const r = run(repo, 'git', args); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  try {
    git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.com');
    writeFileSync(join(repo, 'safe'), 'safe\n'); git('add', '.'); git('commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD');
    const check = () => run(repo, process.execPath, [checker], `refs/heads/main ${git('rev-parse', 'HEAD')} refs/heads/main ${base}\n`);
    // Each adverse revision must be rejected even after its content is removed.
    const bad = ['/' + 'Users/someone/x', ['foo', 'tail1234', 'ts', 'net'].join('.'), 'ghp_' + 'z'.repeat(32), '10.' + '20.30.40', 'secret@' + 'private.invalid', ['127', '0', '0', '10'].join('.')];
    for (const value of bad) {
      git('reset', '--hard', base);
      writeFileSync(join(repo, 'bad'), value); git('add', '.'); git('commit', '-qm', 'adverse');
      assert.equal(check().status, 1);
      git('rm', 'bad'); git('commit', '-qm', 'remove'); assert.equal(check().status, 1);
    }
    git('reset', '--hard', base);
    writeFileSync(join(repo, 'safe'), 'clean\n'); git('add', '.'); git('commit', '-qm', 'clean'); assert.equal(check().status, 0);
    const allowed = 'scripts/tests/check-publish-boundary.test.sh'; mkdirSync(join(repo, 'scripts/tests'), { recursive: true });
    writeFileSync(join(repo, allowed), bad[0]); git('add', '.'); git('commit', '-qm', 'allowed'); assert.equal(check().status, 0);
    const baselineRemote = join(root, 'baseline.git');
    assert.equal(run(root, 'git', ['init', '--bare', '-q', baselineRemote]).status, 0);
    const clean = git('rev-parse', 'HEAD');
    writeFileSync(join(repo, 'leak'), bad[0]); git('add', 'leak'); git('commit', '-qm', 'baseline leak');
    git('push', baselineRemote, 'HEAD:refs/heads/main'); // RED: Git alone publishes it.
    git('reset', '--hard', clean);
    let hooks = join(repo, '.git/hooks');
    writeFileSync(join(hooks, 'pre-push'), '#!/bin/sh\ncat > chained-input\n', { mode: 0o755 });
    assert.equal(syncClones({ root, report() {} }), 1);
    syncClones({ root, apply: true, report() {} }); hooks = git('rev-parse', '--git-path', 'hooks'); assert.equal(syncClones({ root, report() {} }), 0);
    const remote = join(root, 'remote.git'); assert.equal(run(root, 'git', ['init', '--bare', '-q', remote]).status, 0);
    git('remote', 'add', 'fixture', remote);
    // New branch scan includes every commit; current history is clean/allowlisted.
    git('push', 'fixture', 'HEAD:refs/heads/main'); assert.match(readFileSync(join(repo, 'chained-input'), 'utf8'), /refs\/heads\/main/);
    writeFileSync(join(repo, 'leak'), bad[0]); git('add', 'leak'); git('commit', '-qm', 'reject');
    assert.notEqual(run(repo, 'git', ['push', 'fixture', 'HEAD:refs/heads/main']).status, 0);
    unlinkSync(join(hooks, 'pre-push')); assert.equal(syncClones({ root, report() {} }), 1);
    syncClones({ root, apply: true, report() {} }); hooks = git('rev-parse', '--git-path', 'hooks'); assert.equal(syncClones({ root, report() {} }), 0);
    syncClones({ root, apply: true, node: join(root, 'missing-node'), report() {} });
    const missing = run(repo, '/bin/sh', [join(hooks, 'pre-push')], '');
    assert.equal(missing.status, 1); assert.match(missing.stderr, /Node missing/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('new refs exclude advertised history, never local default history', () => {
  const root = mkdtempSync(join(tmpdir(), 'boundary-newref-'));
  const git = (...args) => { const r = run(root, 'git', args); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  try {
    git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.com');
    writeFileSync(join(root, 'old'), '/' + 'Users/someone/old\n');
    git('add', '.'); git('commit', '-qm', 'already published history');
    const published = git('rev-parse', 'HEAD');
    const remote = join(root, 'destination.git');
    git('init', '--bare', '-q', remote); git('push', '-q', remote, 'HEAD:refs/heads/main');
    git('update-ref', 'refs/remotes/origin/main', published);
    git('switch', '-qc', 'candidate');
    writeFileSync(join(root, 'clean'), 'clean\n'); git('add', '.'); git('commit', '-qm', 'clean new commit');
    const clean = git('rev-parse', 'HEAD');
    const check = (head, url = remote) => run(root, process.execPath, [checker, 'origin', url], `refs/heads/candidate ${head} refs/heads/candidate ${'0'.repeat(40)}\n`);
    assert.equal(check(clean).status, 0, 'clean new branch must ignore old remote history');
    writeFileSync(join(root, 'new'), '/' + 'Users/someone/new\n'); git('add', '.'); git('commit', '-qm', 'bad new commit');
    const bad = git('rev-parse', 'HEAD');
    assert.equal(check(bad).status, 1, 'new violation must be refused');
    git('update-ref', '-d', 'refs/remotes/origin/main');
    const fallback = check(clean);
    assert.equal(fallback.status, 0, 'advertisement works without local tracking refs: ' + fallback.stderr);
    assert.equal(check(bad).status, 1, 'fallback still refuses new violations');
    assert.equal(check(clean, join(root, 'missing.git')).status, 1, 'lookup failure scans historical violation on local default branch');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('broken registered worktree warns without blocking clone installation', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'boundary-broken-')));
  const clones = join(root, 'clones'); mkdirSync(clones);
  const repo = join(clones, 'clone');
  const wt = join(root, 'broken');
  const git = (...args) => { const r = run(repo, 'git', args); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  try {
    assert.equal(run(root, 'git', ['init', '-q', repo]).status, 0);
    git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.com');
    git('commit', '--allow-empty', '-qm', 'base'); git('worktree', 'add', '-qb', 'broken', wt);
    const metadata = git('worktree', 'list', '--porcelain');
    const dotgit = readFileSync(join(wt, '.git'), 'utf8');
    // Point at a deleted gitdir while preserving registration metadata.
    const deleted = join(root, 'deleted-gitdir'); mkdirSync(deleted); rmSync(deleted, { recursive: true });
    writeFileSync(join(wt, '.git'), `gitdir: ${deleted}\n`);
    const brokenDotgit = readFileSync(join(wt, '.git'), 'utf8');
    for (const [apply, expected] of [[false, 1], [true, 0], [false, 0]]) {
      const lines = [];
      assert.equal(syncClones({ root: clones, apply, report: line => lines.push(line) }), expected);
      assert.ok(lines.includes(`boundary-prepush warning: unusable worktree=${wt}`));
      assert.equal(lines.filter(line => /clone=.* drift$/.test(line)).length, expected);
    }
    assert.match(git('config', '--get', 'core.hooksPath'), /golems-boundary-hooks$/);
    assert.equal(git('worktree', 'list', '--porcelain'), metadata);
    assert.equal(readFileSync(join(wt, '.git'), 'utf8'), brokenDotgit);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('valid worktree config read errors still refuse installation', () => {
  const root = mkdtempSync(join(tmpdir(), 'boundary-config-'));
  const clones = join(root, 'clones'); mkdirSync(clones);
  const repo = join(clones, 'clone');
  const wt = join(root, 'valid');
  const git = (...args) => { const r = run(repo, 'git', args); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  try {
    assert.equal(run(root, 'git', ['init', '-q', repo]).status, 0);
    git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.com');
    git('commit', '--allow-empty', '-qm', 'base'); git('config', 'extensions.worktreeConfig', 'true');
    git('worktree', 'add', '-qb', 'valid', wt);
    const gitdir = run(wt, 'git', ['rev-parse', '--git-dir']).stdout.trim();
    // Malformed configuration cannot be read, regardless of file permissions.
    writeFileSync(join(gitdir, 'config.worktree'), '[invalid\n');
    assert.equal(run(wt, 'git', ['rev-parse', '--resolve-git-dir', join(wt, '.git')]).status, 0);
    for (const apply of [false, true]) assert.throws(() => syncClones({ root: clones, apply, report() {} }), /cannot read worktree hooks config/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
