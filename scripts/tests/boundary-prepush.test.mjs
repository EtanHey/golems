import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, unlinkSync } from 'node:fs';
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
    const bad = ['/' + 'Users/someone/x', ['foo', 'tail1234', 'ts', 'net'].join('.'), 'ghp_' + 'z'.repeat(32), '10.' + '20.30.40', 'secret@' + 'private.invalid'];
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
    const hooks = join(repo, '.git/hooks');
    writeFileSync(join(hooks, 'pre-push'), '#!/bin/sh\ncat > chained-input\n', { mode: 0o755 });
    assert.equal(syncClones({ root, report() {} }), 1);
    syncClones({ root, apply: true, report() {} }); assert.equal(syncClones({ root, report() {} }), 0);
    const remote = join(root, 'remote.git'); assert.equal(run(root, 'git', ['init', '--bare', '-q', remote]).status, 0);
    git('remote', 'add', 'fixture', remote);
    // New branch scan includes every commit; current history is clean/allowlisted.
    git('push', 'fixture', 'HEAD:refs/heads/main'); assert.match(readFileSync(join(repo, 'chained-input'), 'utf8'), /refs\/heads\/main/);
    writeFileSync(join(repo, 'leak'), bad[0]); git('add', 'leak'); git('commit', '-qm', 'reject');
    assert.notEqual(run(repo, 'git', ['push', 'fixture', 'HEAD:refs/heads/main']).status, 0);
    unlinkSync(join(hooks, 'pre-push')); assert.equal(syncClones({ root, report() {} }), 1);
    syncClones({ root, apply: true, report() {} }); assert.equal(syncClones({ root, report() {} }), 0);
    syncClones({ root, apply: true, node: join(root, 'missing-node'), report() {} });
    const missing = run(repo, '/bin/sh', [join(hooks, 'pre-push')], '');
    assert.equal(missing.status, 1); assert.match(missing.stderr, /Node missing/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
