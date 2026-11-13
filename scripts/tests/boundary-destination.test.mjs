// Real Git objects, graphs, advertisements and installed hook; only URL transport
// and adverse advertisement responses are substituted at the Git process boundary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { syncClones } from '../ci/boundary-clones.mjs';
const checker = resolve(process.env.BOUNDARY_CHECKER || 'scripts/ci/boundary-prepush.mjs');
const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
const Z = '0'.repeat(40), credential = 'ghp_' + 'z'.repeat(32);
function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'boundary-destination-'));
  const repo = join(root, 'repo'), remote = join(root, 'destination.git'), bin = join(root, 'bin'), log = join(root, 'calls');
  mkdirSync(repo); mkdirSync(bin);
  const git = (...args) => {
    const r = spawnSync(realGit, args, { cwd: repo, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
  };
  const commit = (file, value) => {
    writeFileSync(join(repo, file), value); git('add', file); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD');
  };
  try {
    git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.com');
    const base = commit('base', 'safe\n');
    git('init', '--bare', '-q', remote); git('push', '-q', remote, 'HEAD:refs/heads/main');
    git('switch', '-qc', 'candidate');
    writeFileSync(join(bin, 'git'), `#!${process.execPath}
const {spawnSync} = require('node:child_process');
const {appendFileSync} = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('ls-remote') && !args.includes('--get-url')) {
  appendFileSync(process.env.FIXTURE_LOG, JSON.stringify(args) + '\\n');
  if (process.env.FIXTURE_ADVERTISEMENT !== undefined) {
    process.stdout.write(process.env.FIXTURE_ADVERTISEMENT);
    process.stderr.write(process.env.FIXTURE_STDERR || '');
    process.exit(Number(process.env.FIXTURE_STATUS || 0));
  }
  args[args.length - 1] = process.env.FIXTURE_REMOTE;
}
const r = spawnSync(${JSON.stringify(realGit)}, args, {stdio: 'inherit'}); process.exit(r.status ?? 1);
`, { mode: 0o755 });
    const env = { ...process.env, PATH: bin + ':' + process.env.PATH, FIXTURE_LOG: log, FIXTURE_REMOTE: remote };
    const check = ({ url = remote, overrides = {}, rows = 1 } = {}) => {
      const head = git('rev-parse', 'HEAD');
      return spawnSync(process.execPath, [checker, 'origin', url], { cwd: repo, encoding: 'utf8', env: { ...env, ...overrides },
        input: Array.from({ length: rows }, (_, i) => `refs/heads/candidate ${head} refs/heads/candidate${i} ${Z}\n`).join('') });
    };
    fn({ root, repo, remote, log, git, commit, check, base });
  } finally { rmSync(root, { recursive: true, force: true }); }
}
const refused = r => { assert.equal(r.status, 1, r.stderr); assert.match(r.stderr, /publication violation/); };
for (const url of [undefined, 'ssh://git@github.com:22/fixture/fork.git', 'https://someone' + '@github.com/fixture/fork.git', 'https://GitHub.com/fixture/fork.git']) {
  test(`spoofed tracking refs cannot hide a secret: ${url || 'local destination'}`, () => fixture(({ git, commit, check, log, remote }) => {
    const head = commit('private', credential); git('update-ref', 'refs/remotes/x/main', head);
    git('update-ref', 'refs/heads/main', head); // Same name as the advertised ref, different object ID.
    refused(check({ url }));
    assert.equal(JSON.parse(readFileSync(log, 'utf8').trim()).at(-1), url || remote, 'query the actual push URL');
  }));
}
test('real advertised origin/master history is excluded without any local tracking refs', () => fixture(({ git, commit, check, base, remote, log }) => {
  // The old secret is already on the destination; the candidate adds one clean commit.
  const published = commit('old', credential); git('push', '-q', remote, 'HEAD:refs/heads/master');
  git('update-ref', 'refs/remotes/origin/master', base);
  git('update-ref', '-d', 'refs/remotes/origin/master');
  commit('new', 'safe\n');
  const result = check({ rows: 2 }); assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /PASS \(2 commits\)/);
  assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 1, 'one advertisement per push');
  assert.equal(git('ls-remote', remote, 'refs/heads/master').split('\t')[0], published);
}));
test('advertisement failure ignores partial output, scans from root and withholds child stderr', () => fixture(({ git, commit, check }) => {
  const head = commit('private', credential); git('update-ref', 'refs/remotes/x/main', head);
  const result = check({ overrides: { FIXTURE_ADVERTISEMENT: head + '\trefs/heads/main\n', FIXTURE_STATUS: '1', FIXTURE_STDERR: credential } });
  refused(result); assert.match(result.stderr, /scanning full history/); assert.match(result.stderr, /REFUSED:.*retry or check destination access/); assert.ok(!result.stderr.includes(credential));
}));
test('malformed advertisement fails closed instead of trusting a valid-looking prefix', () => fixture(({ commit, check }) => {
  const head = commit('private', credential);
  refused(check({ overrides: { FIXTURE_ADVERTISEMENT: head + '\trefs/heads/main\ninvalid\n' } }));
}));
test('unknown advertised tip does not exempt an unadvertised local default or tracking ref', () => fixture(({ git, commit, check }) => {
  const head = commit('private', credential); git('update-ref', 'refs/heads/main', head); git('update-ref', 'refs/remotes/x/main', head);
  refused(check({ overrides: { FIXTURE_ADVERTISEMENT: 'f'.repeat(40) + '\trefs/heads/main\n' } }));
}));
test('unavailable destination can still publish a fully clean root history', () => fixture(({ commit, check }) => {
  commit('new', 'safe\n');
  const result = check({ overrides: { FIXTURE_ADVERTISEMENT: '', FIXTURE_STATUS: '1' } });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stderr, /PASS \(2 commits\)/);
}));
test('installed hook refuses a real new-branch push despite a spoofed tracking ref', () => fixture(({ root, git, commit, remote }) => {
  const head = commit('private', credential); git('update-ref', 'refs/remotes/x/main', head);
  syncClones({ root, apply: true, report() {} });
  const result = spawnSync(realGit, ['push', remote, 'HEAD:refs/heads/candidate'], { cwd: join(root, 'repo'), encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /publication violation/);
  assert.equal(git('ls-remote', remote, 'refs/heads/candidate'), '', 'destination remains unchanged');
}));
test('R2: inherited pushInsteadOf plus insteadOf cannot redirect the exclusion advertisement', () => fixture(({ root, repo, git, commit, remote }) => {
  const head = commit('private', credential), fake = join(root, 'fake.git');
  git('init', '--bare', '-q', fake); git('push', '-q', fake, 'HEAD:refs/heads/main');
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  writeFileSync(join(repo, '.git/hooks/pre-push'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(checker)} "$@"\n`, { mode: 0o755 });
  const result = spawnSync(realGit, ['-c', `url.${remote}.pushInsteadOf=${remote}`, '-c', `url.${fake}.insteadOf=${remote}`,
    'push', remote, 'HEAD:refs/heads/candidate'], { cwd: repo, encoding: 'utf8' });
  assert.notEqual(result.status, 0, result.stderr);
  assert.match(result.stderr, /destination URL rewritten/);
  assert.match(result.stderr, /REFUSED:.*retry or check destination access/);
  assert.equal(git('ls-remote', remote, 'refs/heads/candidate'), '', 'secret never reaches the destination');
  assert.equal(git('rev-parse', 'HEAD'), head);
}));
test('30,001 advertised refs fit rev-list stdin and scan only the new commit', () => fixture(({ repo, remote, git, commit, check, base }) => {
  let stream = '';
  for (let i = 1; i <= 30_000; i++) stream += `commit refs/heads/bulk\nmark :${i}\ncommitter Fixture <fixture@example.com> ${1700000000 + i} +0000\ndata 2\nc\n${i > 1 ? `from :${i - 1}\n` : ''}\n`;
  const imported = spawnSync(realGit, ['fast-import', '--quiet'], { cwd: repo, input: stream, encoding: 'utf8' });
  assert.equal(imported.status, 0, imported.stderr);
  const commits = git('rev-list', 'bulk').split('\n'); assert.equal(commits.length, 30_000);
  const refs = commits.map((sha, i) => `create refs/tags/t${i} ${sha}\n`).join('');
  const updated = spawnSync(realGit, ['update-ref', '--stdin'], { cwd: repo, input: refs, encoding: 'utf8' });
  assert.equal(updated.status, 0, updated.stderr);
  git('push', '-q', remote, '--tags');
  const advertised = git('ls-remote', '--refs', remote).split('\n'); assert.equal(advertised.length, 30_001);
  assert.equal(git('rev-parse', 'HEAD'), base); commit('new', 'safe\n');
  const result = check(); assert.equal(result.status, 0, result.stderr); assert.match(result.stderr, /PASS \(1 commits\)/);
}));
