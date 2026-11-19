// Synthetic fixtures: scratch repos, a scratch HOME, a local bare remote, no network.
// BOUNDARY_CHECKER may point at another copy (e.g. master's) for fail-first runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gitIdentityStatus, MISSING } from '../hooks/git-identity.mjs';
const checker = resolve(process.env.BOUNDARY_CHECKER || 'scripts/ci/boundary-prepush.mjs');
const scratch = resolve('docs.local/test-scratch');
mkdirSync(scratch, { recursive: true });
const good = 'someone@example.com';
const machine = 'someone@example-host' + '.local';
// Isolate from the machine's system and global Git identity.
const isolated = home => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && k !== 'EMAIL'));
  return { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), GIT_CONFIG_NOSYSTEM: '1' };
};
function fixture(fn) {
  const root = mkdtempSync(join(scratch, 'local-author-'));
  const home = join(root, 'home'), repo = join(root, 'repo'), remote = join(root, 'remote.git'), hooks = join(root, 'hooks');
  for (const dir of [home, repo, hooks]) mkdirSync(dir);
  const base = isolated(home);
  const run = (args, env = base) => spawnSync('git', args, { cwd: repo, env, encoding: 'utf8' });
  const git = (...args) => { const r = run(args); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const commit = (email, file) => {
    writeFileSync(join(repo, file), file + '\n'); git('add', file);
    const env = { ...base, GIT_AUTHOR_NAME: 'Someone', GIT_COMMITTER_NAME: 'Someone', GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_EMAIL: email };
    const r = run(['commit', '-qm', 'synthetic ' + file], env); assert.equal(r.status, 0, r.stderr);
  };
  try {
    git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Someone'); git('config', 'user.email', good);
    git('init', '--bare', '-q', remote);
    const quote = v => "'" + v.replaceAll("'", "'\\''") + "'";
    writeFileSync(join(hooks, 'pre-push'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(checker)} "$@"\n`, { mode: 0o755 });
    const push = () => run(['-c', 'core.hooksPath=' + hooks, 'push', remote, 'HEAD:refs/heads/main']);
    const rawPush = () => git('push', '-q', '--no-verify', remote, 'HEAD:refs/heads/main');
    fn({ commit, push, rawPush, git });
  } finally { rmSync(root, { recursive: true, force: true }); }
}
const passes = r => { assert.equal(r.status, 0, r.stderr); assert.match(r.stderr, /boundary-prepush: PASS/); };
const refused = r => {
  assert.notEqual(r.status, 0, r.stderr);
  assert.match(r.stderr, /boundary-prepush: REFUSED: commit [0-9a-f]{40} has an empty or \.local .*GitHub will not credit it/);
  assert.match(r.stderr, /git commit --amend --reset-author/);
  assert.match(r.stderr, /rebase/);
};

test('push of a .local-author commit is refused, naming the commit', () => fixture(f => {
  f.commit(good, 'base'); f.commit(machine, 'bad'); refused(f.push());
}));
test('push of a .local-committer-only commit is refused', () => fixture(f => {
  f.commit(good, 'base'); f.git('-c', 'user.email=' + machine, 'commit', '--amend', '--no-edit', '-q');
  refused(f.push());
}));
test('push of a normal-author commit passes', () => fixture(f => {
  f.commit(good, 'base'); f.commit(good, 'next'); passes(f.push());
}));
test('a .local commit already on the destination does not block a new good commit', () => fixture(f => {
  f.commit(machine, 'old'); f.rawPush(); f.commit(good, 'new'); passes(f.push());
}));

test('identity status line: MISSING with no identity, ok with one, never the address', () => {
  const root = mkdtempSync(join(scratch, 'identity-home-'));
  try {
    const env = isolated(root);
    const missing = gitIdentityStatus(env);
    assert.equal(missing.ok, false); assert.equal(missing.line, MISSING);
    const machineEnv = { ...env, GIT_AUTHOR_EMAIL: machine };
    assert.equal(gitIdentityStatus(machineEnv).line, MISSING);
    writeFileSync(join(root, '.gitconfig'), `[user]\n\tname = Someone Fixture\n\temail = ${good}\n`);
    const ok = gitIdentityStatus(env);
    assert.equal(ok.ok, true); assert.equal(ok.line, 'git identity: ok Someone Fixture');
    assert.doesNotMatch(ok.line, /@/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
