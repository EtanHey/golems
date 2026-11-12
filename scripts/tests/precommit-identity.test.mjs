import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { syncClones } from '../ci/boundary-clones.mjs';

test('installed identity guard refuses bad identities and preserves chaining and drift', () => {
  const scratch = resolve('docs.local/identity-hook-fixtures');
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, 'fixture-'));
  const repo = join(root, 'clone'); mkdirSync(repo);
  const run = (args, env = process.env) => spawnSync('git', args, { cwd: repo, env, encoding: 'utf8' });
  const git = (...args) => { const r = run(args); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  try {
    git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.com');
    const original = join(repo, '.git/hooks/pre-commit');
    writeFileSync(original, '#!/bin/sh\necho chained >> chain-log\nexit 0\n', { mode: 0o755 });
    const bytes = readFileSync(original, 'utf8');
    syncClones({ root, apply: true, report() {} });
    const managed = git('config', '--get', 'core.hooksPath');
    for (const [key, value, identity] of [
      ['GIT_AUTHOR_EMAIL', 'author@' + 'host.local', 'author'],
      ['GIT_COMMITTER_EMAIL', 'committer@' + 'host.local', 'committer'],
      ['GIT_AUTHOR_EMAIL', '', 'author'],
      ['GIT_COMMITTER_EMAIL', '', 'committer'],
      ['GIT_AUTHOR_EMAIL', 'author@' + 'host.LoCaL', 'author'],
      ['GIT_COMMITTER_EMAIL', 'committer@' + 'host.LOCAL', 'committer'],
      ['GIT_AUTHOR_EMAIL', 'author@' + 'host.local.', 'author'],
      ['GIT_COMMITTER_EMAIL', 'committer@' + 'host.LoCaL.', 'committer'],
    ]) {
      const env = { ...process.env, GIT_AUTHOR_NAME: 'Fixture', GIT_COMMITTER_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'a@example.com', GIT_COMMITTER_EMAIL: 'c@example.com', [key]: value };
      const r = run(['commit', '--allow-empty', '-qm', 'refuse'], env);
      assert.notEqual(r.status, 0, `${key}=${value} must refuse`);
      assert.match(r.stderr, new RegExp(`identity-precommit: REFUSED: ${identity}.*git config --global user.email`));
    }
    git('commit', '--allow-empty', '-qm', 'pass');
    assert.equal(readFileSync(join(repo, 'chain-log'), 'utf8'), 'chained\n');
    assert.equal(readFileSync(original, 'utf8'), bytes);
    assert.equal(syncClones({ root, report() {} }), 0);
    unlinkSync(join(managed, 'pre-commit'));
    assert.equal(syncClones({ root, report() {} }), 1);
    syncClones({ root, apply: true, report() {} });
    writeFileSync(join(managed, 'pre-commit'), '#!/bin/sh\nexit 0\n');
    assert.equal(syncClones({ root, report() {} }), 1);
    syncClones({ root, apply: true, report() {} });
    assert.equal(syncClones({ root, report() {} }), 0);
    writeFileSync(original, '#!/bin/sh\nexit 23\n');
    assert.equal(run(['commit', '--allow-empty', '-qm', 'prior refusal']).status, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
