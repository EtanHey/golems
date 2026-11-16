// Synthetic publication fixtures; no external services or installed hook edits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const checker = resolve(process.env.BOUNDARY_CHECKER || 'scripts/ci/boundary-prepush.mjs');
const scratch = resolve('docs.local/test-scratch');
mkdirSync(scratch, { recursive: true });
const email = domain => 'fixture@' + domain;
const credential = 'ghp_' + 'z'.repeat(32);
function fixture(fn) {
  const root = mkdtempSync(join(scratch, 'published-'));
  const repo = join(root, 'repo'), remote = join(root, 'remote.git');
  mkdirSync(repo);
  const run = (...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  const git = (...args) => { const r = run(...args); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const commit = (file, text) => {
    writeFileSync(join(repo, file), text + '\n'); git('add', file); git('commit', '-qm', 'synthetic fixture'); return git('rev-parse', 'HEAD');
  };
  try {
    git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.com');
    const base = commit('shared', 'base');
    git('init', '--bare', '-q', remote); git('push', '-q', remote, 'HEAD:refs/heads/main', 'HEAD:refs/heads/candidate');
    const check = (old = base, url = remote) => spawnSync(process.execPath, [checker, 'fixture', url], {
      cwd: repo, encoding: 'utf8', input: `refs/heads/candidate ${git('rev-parse', 'HEAD')} refs/heads/candidate ${old}\n`,
    });
    fn({ root, remote, git, run, commit, check, base });
  } finally { rmSync(root, { recursive: true, force: true }); }
}
const allowed = r => { assert.equal(r.status, 0, r.stderr); assert.match(r.stderr, /boundary-prepush: PASS/); };
const refused = r => { assert.equal(r.status, 1, r.stderr); assert.match(r.stderr, /publication violation/); };
function publishedMain({ git, commit, remote }, conflict = false) {
  commit(conflict ? 'shared' : 'published', email('example.invalid'));
  // A separate non-exempt class isolates graph/diff correctness from email policy.
  commit('old-credential', credential);
  git('push', '-q', remote, 'HEAD:refs/heads/main');
}
test('A: existing branch ignores main history already on the destination', () => fixture(f => {
  publishedMain(f); f.git('switch', '-qc', 'candidate', f.base);
  f.commit('branch', 'safe'); f.git('merge', '--no-ff', '-qm', 'merge published main', 'main');
  allowed(f.check());
}));
for (const adverse of [false, true]) {
  test(`B: conflict resolution ${adverse ? 'adding a new address is refused' : 'importing published lines is allowed'}`, () => fixture(f => {
    publishedMain(f, true); f.git('switch', '-qc', 'candidate', f.base);
    f.commit('shared', 'branch version');
    assert.equal(f.run('merge', '--no-ff', '--no-commit', 'main').status, 1);
    f.commit('shared', email('example.invalid') + '\nresolved safely' + (adverse ? '\n' + email('gmail.com') : ''));
    const result = f.check();
    (adverse ? refused : allowed)(result);
    if (adverse) assert.match(result.stderr, /publication violation \(identity-pii\)/);
  }));
}
for (const domain of ['foo.invalid', 'bar.test', 'example', 'site.example', 'localhost', 'app.localhost', 'example.com']) {
  test(`C: reserved address domain ${domain} is allowed`, () => fixture(f => {
    f.git('switch', '-qc', 'candidate'); f.commit('address', email(domain)); allowed(f.check());
  }));
}
for (const domain of ['evil.invalid.com', 'gmail.com', 'example.com.evil.com', 'foo.test.evil.com', 'site.example.evil.com']) {
  test(`C: nonreserved address domain ${domain} is refused`, () => fixture(f => {
    f.git('switch', '-qc', 'candidate'); f.commit('address', email(domain)); refused(f.check());
  }));
}
test('D: new branch violation is refused when main is merged in the same push', () => fixture(f => {
  publishedMain(f); f.git('switch', '-qc', 'candidate', f.base);
  f.commit('branch', email('gmail.com')); f.git('merge', '--no-ff', '-qm', 'merge main', 'main'); refused(f.check());
}));
test('unpublished parent violations survive combined merge scanning, even after removal', () => fixture(f => {
  f.git('switch', '-qc', 'side'); f.commit('transient', credential);
  f.git('rm', 'transient'); f.git('commit', '-qm', 'remove transient');
  f.git('switch', '-qc', 'candidate', f.base); f.commit('branch', 'safe');
  f.git('merge', '--no-ff', '-qm', 'merge unpublished side', 'side'); refused(f.check());
}));
test('existing branch without destination evidence scans unpublished main', () => fixture(f => {
  publishedMain(f); f.git('switch', '-qc', 'candidate', f.base);
  f.commit('branch', 'safe'); f.git('merge', '--no-ff', '-qm', 'merge main', 'main');
  refused(f.check(f.base, join(f.root, 'missing.git')));
}));
