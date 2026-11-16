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
    const check = (old = base, url = remote, env = process.env) => spawnSync(process.execPath, [checker, 'fixture', url], {
      cwd: repo, encoding: 'utf8', env, input: `refs/heads/candidate ${git('rev-parse', 'HEAD')} refs/heads/candidate ${old}\n`,
    });
    const push = () => {
      const hooks = join(root, 'hooks'); mkdirSync(hooks, { recursive: true });
      const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
      writeFileSync(join(hooks, 'pre-push'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(checker)} "$@"\n`, { mode: 0o755 });
      git('config', 'core.hooksPath', hooks);
      return run('push', remote, 'HEAD:refs/heads/candidate');
    };
    fn({ root, repo, remote, git, run, commit, check, push, base });
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
  f.commit('branch', email('gmail.com')); f.git('merge', '--no-ff', '-qm', 'merge main', 'main');
  const result = f.check(); refused(result); assert.match(result.stderr, /publication violation \(identity-pii\)/);
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

for (const suffix of ['foo.test', 'example.com', 'foo.invalid', 'site.example']) {
  test(`R1: address splice before ${suffix} is refused`, () => fixture(f => {
    f.git('switch', '-qc', 'candidate');
    f.commit('address', 'real.person@' + 'gmail.com@' + suffix); refused(f.check());
  }));
}
for (const domain of ['gmail.com.invalid', 'gmail.com.test', 'gmail.com.example', 'gmail.com.localhost']) {
  test(`R1: munged domain ${domain} is refused`, () => fixture(f => {
    f.git('switch', '-qc', 'candidate'); f.commit('address', 'real.person@' + domain); refused(f.check());
  }));
}
for (const domain of ['example.com', 'foo.test', 'foo.invalid', 'site.example']) {
  test(`R1: sentence-final ${domain} address is allowed`, () => fixture(f => {
    f.git('switch', '-qc', 'candidate'); f.commit('address', 'Write to ' + email(domain) + '.'); allowed(f.check());
  }));
}
test('R1: real push refuses the splice and leaves the remote unchanged', () => fixture(f => {
  f.git('switch', '-qc', 'candidate'); f.commit('address', 'real.person@' + 'gmail.com@' + 'foo.test');
  refused(f.push());
  assert.equal(f.git('ls-remote', f.remote, 'refs/heads/candidate').split('\t')[0], f.base);
}));
test('R1: real push allows case A through the hook', () => fixture(f => {
  publishedMain(f); f.git('switch', '-qc', 'candidate', f.base);
  f.commit('branch', 'safe'); f.git('merge', '--no-ff', '-qm', 'merge published main', 'main');
  allowed(f.push());
  assert.equal(f.git('ls-remote', f.remote, 'refs/heads/candidate').split('\t')[0], f.git('rev-parse', 'HEAD'));
}));
for (const inherited of [false, true]) {
  test(`R1: grafts cannot hide unpublished credential (inherited override=${inherited})`, () => fixture(f => {
    f.git('switch', '-qc', 'candidate');
    const bad = f.commit('credential', credential);
    const root = f.git('commit-tree', f.git('rev-parse', 'HEAD^{tree}'), '-m', 'synthetic root');
    const grafts = join(f.repo, '.git/info', inherited ? 'custom-grafts' : 'grafts');
    writeFileSync(grafts, `${f.base} ${root}\n${bad} ${root}\n`);
    refused(f.check(f.base, f.remote, inherited ? { ...process.env, GIT_GRAFT_FILE: grafts } : process.env));
  }));
}

test('R1: adjacent allowed addresses retain their separator for matching', () => fixture(f => {
  f.git('switch', '-qc', 'candidate');
  f.commit('address', email('example.com') + ' ' + email('foo.test') + '.'); allowed(f.check());
}));

for (const label of ['home address', 'home city', 'resume path']) {
  for (const domain of ['b.test', 'example.com', 'users.noreply.github.com']) {
    test(`C: label ${label} directly before allowed domain ${domain} is refused`, () => fixture(f => {
      f.git('switch', '-qc', 'candidate'); f.commit('notes', label + ':' + 'a@' + domain);
      const result = f.check(); refused(result); assert.match(result.stderr, /publication violation \(identity-pii\)/);
    }));
  }
}
test('R2: real push cannot strip a sensitive label colon', () => fixture(f => {
  f.git('switch', '-qc', 'candidate'); f.commit('notes', 'home address' + ':' + 'a@' + 'b.test');
  refused(f.push());
  assert.equal(f.git('ls-remote', f.remote, 'refs/heads/candidate').split('\t')[0], f.base);
}));

test('R2: hook Git calls disable commitGraph despite repository configuration', () => fixture(f => {
  f.git('switch', '-qc', 'candidate'); f.commit('safe', 'safe');
  f.git('config', 'core.commitGraph', 'true');
  const bin = join(f.root, 'bin'); mkdirSync(bin);
  const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
  writeFileSync(join(bin, 'git'), `#!${process.execPath}
const {spawnSync} = require('node:child_process');
const args = process.argv.slice(2);
if (args[0] !== '--no-replace-objects' || args[1] !== '-c' || args[2] !== 'core.commitGraph=false') process.exit(71);
const r = spawnSync(${JSON.stringify(realGit)}, args, {stdio: 'inherit'}); process.exit(r.status ?? 1);
`, { mode: 0o755 });
  allowed(f.check(f.base, f.remote, { ...process.env, PATH: bin + ':' + process.env.PATH }));
}));
