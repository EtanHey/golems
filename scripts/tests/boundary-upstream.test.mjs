// Real Git graphs/patches; only GitHub metadata and HTTPS transport are fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const checker = resolve(process.env.BOUNDARY_CHECKER ?? 'scripts/ci/boundary-prepush.mjs');
const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
const target = 'https://github.com/fixture/fork.git';
const parentURL = 'https://github.com/fixture/parent.git';
const leak = '/' + 'Users/someone/private';
const credential = 'ghp_' + 'z'.repeat(32);
function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'boundary-parent-')), repo = join(root, 'repo');
  const bin = join(root, 'bin'), parent = join(root, 'parent.git'), destination = join(root, 'destination.git'), log = join(root, 'transport.jsonl');
  mkdirSync(repo); mkdirSync(bin);
  const git = (...args) => {
    const r = spawnSync(realGit, args, { cwd: repo, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
  };
  const commit = (file, text) => { writeFileSync(join(repo, file), text); git('add', '.'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  try {
    git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.com');
    const shared = 'ours-base\n' + 'safe\n'.repeat(20) + 'upstream-base\n';
    commit('shared', shared);
    const base = commit('safe', 'base\n');
    git('init', '--bare', '-q', destination); git('push', '-q', destination, 'HEAD:refs/heads/main');
    const upstreamPII = 'upstream@' + 'private.invalid';
    commit('shared', shared.replace('upstream-base', upstreamPII));
    const published = commit('upstream', upstreamPII + '\n');
    git('init', '--bare', '-q', parent); git('push', '-q', parent, 'HEAD:refs/heads/main');
    git('reset', '--hard', base); git('switch', '-qc', 'candidate');
    commit('shared', shared.replace('ours-base', 'ours-change')); commit('ours', 'safe\n');
    git('merge', '--no-ff', '-qm', 'import upstream', published);
    const metadata = { full_name: 'fixture/fork', fork: true, parent: { full_name: 'fixture/parent' } };
    const env = { ...process.env, PATH: bin + ':' + process.env.PATH, FIXTURE_PARENT: parent, FIXTURE_DESTINATION: destination, FIXTURE_LOG: log,
      FIXTURE_METADATA: JSON.stringify(metadata) };
    writeFileSync(join(bin, 'gh'), `#!${process.execPath}
if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(['api', '--hostname', 'github.com', 'repos/fixture/fork'])) process.exit(2);
if (process.env.FIXTURE_LOOKUP_FAIL) process.exit(1);
process.stdout.write(process.env.FIXTURE_METADATA);
`, { mode: 0o755 });
    writeFileSync(join(bin, 'git'), `#!${process.execPath}
const {spawnSync} = require('node:child_process');
const {appendFileSync} = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('ls-remote') && !args.includes('--get-url')) args[args.length - 1] = process.env.FIXTURE_DESTINATION;
if (args.includes('fetch')) {
  appendFileSync(process.env.FIXTURE_LOG, JSON.stringify({args, gitEnv: Object.keys(process.env).filter(k => k.startsWith('GIT_'))}) + '\\n');
  if (process.env.FIXTURE_FETCH_FAIL || !args.includes(${JSON.stringify(parentURL)})) process.exit(1);
  args[args.indexOf(${JSON.stringify(parentURL)})] = process.env.FIXTURE_PARENT;
  args.unshift('-c', 'protocol.file.allow=always'); // transport fixture only
}
const r = spawnSync(${JSON.stringify(realGit)}, args, {stdio: 'inherit'}); process.exit(r.status ?? 1);
`, { mode: 0o755 });
    const check = (overrides = {}, remote = base, url = target) => spawnSync(process.execPath, [checker, 'origin', url], {
      cwd: repo, env: { ...env, ...overrides }, encoding: 'utf8',
      input: `refs/heads/candidate ${git('rev-parse', 'HEAD')} refs/heads/candidate ${remote}\n`,
    });
    fn({ root, repo, git, commit, check, base, published, metadata, log, destination });
  } finally { rmSync(root, { recursive: true, force: true }); }
}
test('verified parent import and our clean merge pass, including a new branch', () => fixture(({ check, git, log, published }) => {
  for (const remote of [undefined, '0'.repeat(40)]) {
    const r = check({}, remote); assert.equal(r.status, 0, r.stderr);
  }
  const receipts = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(receipts.length, 2, 'fresh fetch for each push');
  assert.ok(receipts.every(r => r.args.includes(parentURL) && r.args.includes('--filter=tree:0')));
  // Untrusted local history must not become an exclusion even on new refs.
  git('update-ref', 'refs/remotes/upstream/main', published);
  assert.equal(check({}, '0'.repeat(40)).status, 0);
}));
test('our intermediate secret stays refused after removal', () => fixture(({ commit, git, check }) => {
  commit('private', credential); git('rm', 'private'); git('commit', '-qm', 'remove secret');
  const r = check(); assert.equal(r.status, 1); assert.match(r.stderr, /publication violation/);
}));
test('spoofed upstream tracking ref and URL rewrite cannot exempt our commit', () => fixture(({ commit, git, check, log }) => {
  const ours = commit('private', leak);
  git('update-ref', 'refs/remotes/upstream/main', ours);
  git('remote', 'add', 'upstream', 'https://github.com/fixture/attacker.git');
  git('config', 'url.https://github.com/fixture/attacker.git.insteadOf', parentURL);
  for (const remote of [undefined, '0'.repeat(40)]) assert.equal(check({}, remote).status, 1);
  assert.ok(readFileSync(log, 'utf8').includes(parentURL));
}));
test('novel merge resolution is scanned', () => fixture(({ git, commit, check }) => {
  git('switch', '-qc', 'side'); commit('side', 'safe\n');
  git('switch', 'candidate'); commit('ours', 'still safe\n');
  git('merge', '--no-ff', '--no-commit', 'side');
  commit('resolution', leak);
  const r = check(); assert.equal(r.status, 1); assert.match(r.stderr, /publication violation/);
}));
for (const failure of ['FIXTURE_LOOKUP_FAIL', 'FIXTURE_FETCH_FAIL']) {
  test(`${failure}: unavailable parent evidence scans upstream too`, () => fixture(({ check }) => {
    const r = check({ [failure]: '1' }); assert.equal(r.status, 1); assert.match(r.stderr, /publication violation/);
  }));
  test(`${failure}: new-ref fallback requires advertised destination history`, () => fixture(({ check, git, commit, destination }) => {
    git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'));
    const unpublished = check({ [failure]: '1' }, '0'.repeat(40));
    assert.equal(unpublished.status, 1, unpublished.stderr);
    git('push', '-q', destination, 'HEAD:refs/heads/main');
    const published = check({ [failure]: '1' }, '0'.repeat(40));
    assert.equal(published.status, 0, published.stderr);
    const secret = commit('private', credential); git('update-ref', 'refs/remotes/origin/main', secret);
    const refused = check({ [failure]: '1' }, '0'.repeat(40));
    assert.equal(refused.status, 1, refused.stderr); assert.match(refused.stderr, /publication violation/);
  }));
}
test('non-fork and mismatched target metadata retain the original scan', () => fixture(({ check, metadata }) => {
  for (const data of [{ ...metadata, fork: false }, { ...metadata, full_name: 'fixture/other' }, { ...metadata, parent: { full_name: '../attacker' } }]) {
    assert.equal(check({ FIXTURE_METADATA: JSON.stringify(data) }).status, 1);
  }
  for (const url of ['https://github.com.evil/fixture/fork.git', 'https://github.com/fixture/fork.git?x', '/local/repo']) {
    assert.equal(check({}, undefined, url).status, 1);
  }
}));
test('parent fetch ignores Git config/alternate object injection and cleans its scratch repo', () => fixture(({ check, log, root }) => {
  const injected = join(root, 'injected.gitconfig'); writeFileSync(injected, '[url "file:///invalid"]\n insteadOf = https://github.com/\n');
  const r = check({ GIT_CONFIG_GLOBAL: injected, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'url.file:///invalid.insteadOf',
    GIT_CONFIG_VALUE_0: 'https://github.com/', GIT_ALTERNATE_OBJECT_DIRECTORIES: join(root, 'untrusted') });
  assert.equal(r.status, 0, r.stderr);
  const receipt = JSON.parse(readFileSync(log, 'utf8').trim());
  assert.ok(!receipt.gitEnv.includes('GIT_CONFIG_COUNT'));
  assert.ok(!receipt.gitEnv.includes('GIT_ALTERNATE_OBJECT_DIRECTORIES'));
  const scratch = receipt.args[receipt.args.indexOf('-C') + 1];
  assert.throws(() => readFileSync(join(scratch, 'HEAD')), /ENOENT/);
}));
