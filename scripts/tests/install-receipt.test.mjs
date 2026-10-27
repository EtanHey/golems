import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { hostname, userInfo } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const cli = resolve('scripts/install-receipt.mjs');
const sha = 'a'.repeat(40), digest = 'b'.repeat(64);
function receipt() {
  return { schema: 'install-receipt/v1', receipt_id: randomUUID(), written_at: '2026-10-27T10:00:00.000Z',
    writer: { agent: 'test-worker', thread_or_session: 'test' }, host: { alias: 'mbp', hostname: hostname(), user: userInfo().username },
    product: 'golems', artifact_kind: 'skills-sync', target: { version: '1.0.0', merge_sha: sha },
    installed: { version: '1.0.0', path: '/fixture/hooks-live', embedded_commit: sha, install_finished_at: '2026-10-27T09:00:00Z' },
    install_source: { mode: 'worktree-pin', path: '/fixture/hooks-live', pin_sha: sha,
      owner_status: { command: 'install-hooks.sh --host mbp --status', exit: 0, drift: false, settings_drift: false } },
    activation: { method: 'new-session', processes: [{ pid: 123, path: '/fixture/bin', started_at: '2026-10-27T09:01:00Z' }],
      self_report: { command: 'golems --version', version: '1.0.0', commit: sha } }, verdict: 'LIVE', reasons: [] };
}
function isolated(fn) {
  mkdirSync(resolve('docs.local'), { recursive: true });
  const home = mkdtempSync(resolve('docs.local/install-receipt-home-'));
  const run = (command, value) => spawnSync(process.execPath, [cli, command, '-'], {
    input: JSON.stringify(value), encoding: 'utf8', env: { ...process.env, HOME: home, XDG_STATE_HOME: join(home, 'xdg-state') } });
  try { fn(run, home); } finally { rmSync(home, { recursive: true, force: true }); }
}
const output = result => { assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout); };

test('1: validate requires a full merge SHA and accepts owner-installer worktree pins', () => isolated(run => {
  assert.equal(output(run('validate', receipt())).verdict, 'LIVE');
  for (const value of [undefined, 'abc', 'g'.repeat(40)]) {
    const r = receipt(); r.target.merge_sha = value; assert.notEqual(run('validate', r).status, 0);
  }
}));
test('2–3: LIVE requires matching identity, fresh process and activation proof; writer never upgrades', () => isolated(run => {
  const cases = [
    [r => { r.installed.embedded_commit = 'c'.repeat(40); }, 'MISMATCH'],
    [r => { r.activation.processes[0].started_at = r.installed.install_finished_at; }, 'INSTALLED_NOT_ACTIVE'],
    [r => { r.activation.processes = []; }, 'INSTALLED_NOT_ACTIVE'],
    [r => { delete r.activation.self_report; }, 'INSTALLED_NOT_ACTIVE'],
    [r => { delete r.installed.embedded_commit; }, 'INSTALLED_NOT_ACTIVE'],
  ];
  for (const [mutate, verdict] of cases) {
    const r = receipt(); mutate(r); assert.notEqual(run('validate', r).status, 0);
    assert.equal(output(run('write', r)).verdict, verdict);
  }
  for (const verdict of ['FAILED', 'MISMATCH', 'INSTALLED_NOT_ACTIVE']) {
    const r = receipt(); r.verdict = verdict; assert.equal(output(run('write', r)).verdict, verdict);
  }
  const probe = receipt(); delete probe.activation.self_report; probe.activation.mcp_probe = { server: 'golems', request: 'ping', ok: true, summary: 'ok' };
  assert.equal(output(run('validate', probe)).verdict, 'LIVE');
  const asset = receipt(); delete asset.installed.embedded_commit; asset.installed.content_sha256 = digest;
  asset.target.release_asset = { name: 'bundle', sha256: digest }; assert.equal(output(run('validate', asset)).verdict, 'LIVE');
  asset.installed.embedded_commit = 'c'.repeat(40); assert.equal(output(run('write', asset)).verdict, 'MISMATCH');
}));
test('4: append-only local event files and atomic latest under HOME; ignore alternate XDG writer path', () => isolated((run, home) => {
  const first = output(run('write', receipt())); const before = readFileSync(first.path, 'utf8');
  const second = output(run('write', receipt()));
  assert.notEqual(first.path, second.path); assert.equal(readFileSync(first.path, 'utf8'), before);
  const dir = join(home, '.local/state/golems/install-receipts/golems');
  assert.equal(first.path.startsWith(dir + '/'), true);
  assert.equal(JSON.parse(readFileSync(join(dir, 'latest.json'))).receipt_id, second.receipt_id);
  assert.equal(readdirSync(dir).length, 3); assert.equal(JSON.parse(before).host.hostname, hostname());
}));
test('reject forbidden fields recursively and unsafe output components without writes', () => isolated((run, home) => {
  assert.equal(output(run('validate', receipt())).schema, 'install-receipt/v1');
  for (const field of ['secrets', 'tokens', 'transcripts', 'dictionary_terms', 'brainlayer_content']) {
    const r = receipt(); r.activation[field] = 'forbidden'; assert.notEqual(run('write', r).status, 0);
  }
  for (const [field, value] of [['product', '../escape'], ['version', '../../escape']]) {
    const r = receipt(); if (field === 'version') r.target.version = value; else r.product = value;
    assert.notEqual(run('write', r).status, 0);
  }
  const foreign = receipt(); foreign.host.hostname = 'other-mac'; assert.notEqual(run('write', foreign).status, 0);
  assert.deepEqual(readdirSync(home), []);
}));

test('reject impossible calendar dates and missing hooks-live pin evidence', () => isolated(run => {
  const r = receipt(); r.installed.install_finished_at = '2026-02-30T09:00:00Z'; assert.notEqual(run('validate', r).status, 0);
  const pin = receipt(); delete pin.install_source.pin_sha; assert.notEqual(run('validate', pin).status, 0);
}));

test('writer refuses symlinked state directories', () => isolated((run, home) => {
  const elsewhere = join(home, 'elsewhere'); mkdirSync(elsewhere);
  symlinkSync(elsewhere, join(home, '.local'));
  assert.notEqual(run('write', receipt()).status, 0); assert.deepEqual(readdirSync(elsewhere), []);
}));

test('4: concurrent CLI writers publish complete latest receipts and preserve every successful event', async () => {
  mkdirSync(resolve('docs.local'), { recursive: true });
  const home = mkdtempSync(resolve('docs.local/install-receipt-home-'));
  try {
    const results = [];
    const jobs = Array.from({ length: 8 }, () => new Promise((done, reject) => {
      const child = spawn(process.execPath, [cli, 'write', '-'], { env: { ...process.env, HOME: home, XDG_STATE_HOME: join(home, 'xdg') } });
      let stdout = '', stderr = '';
      child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
      child.on('error', reject); child.on('close', status => { results.push({ status, stdout, stderr }); done(); });
      child.stdin.end(JSON.stringify(receipt()));
    }));
    const dir = join(home, '.local/state/golems/install-receipts/golems');
    let reads = 0;
    while (results.length < jobs.length) {
      try { assert.equal(JSON.parse(readFileSync(join(dir, 'latest.json'))).schema, 'install-receipt/v1'); reads++; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await new Promise(done => setImmediate(done));
    }
    await Promise.all(jobs);
    const successes = results.filter(r => r.status === 0).map(output);
    assert.ok(successes.length > 0); assert.ok(reads > 0);
    for (const failed of results.filter(r => r.status !== 0)) assert.match(failed.stderr, /EEXIST/);
    for (const r of successes) assert.equal(JSON.parse(readFileSync(r.path)).receipt_id, r.receipt_id);
    assert.equal(readdirSync(dir).length, successes.length + 1);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

for (const [name, mutate, expected] of [
  ['pre-merge worktree pin', r => { r.install_source.pin_sha = 'c'.repeat(40); }, 'MISMATCH'],
  ['older self-report commit', r => { r.activation.self_report.commit = 'c'.repeat(40); }, 'MISMATCH'],
  ['owner status exit', r => { r.install_source.owner_status.exit = 1; }, 'INSTALLED_NOT_ACTIVE'],
  ['owner status drift', r => { r.install_source.owner_status.drift = true; }, 'INSTALLED_NOT_ACTIVE'],
  ['owner settings drift', r => { r.install_source.owner_status.settings_drift = true; }, 'INSTALLED_NOT_ACTIVE'],
]) {
  test(`2–3: ${name} prevents LIVE`, () => isolated(run => {
    const r = receipt(); mutate(r);
    assert.notEqual(run('validate', r).status, 0);
    assert.equal(output(run('write', r)).verdict, expected);
    r.verdict = expected; assert.equal(output(run('validate', r)).verdict, expected);
  }));
}
test('schema requires lowercase commit SHAs and content hashes', () => isolated(run => {
  for (const mutate of [r => { r.target.merge_sha = sha.toUpperCase(); },
    r => { r.install_source.pin_sha = sha.toUpperCase(); },
    r => { r.installed.embedded_commit = sha.toUpperCase(); },
    r => { r.activation.self_report.commit = sha.toUpperCase(); },
    r => { r.installed.content_sha256 = digest.toUpperCase(); }]) {
    const r = receipt(); mutate(r); assert.notEqual(run('validate', r).status, 0);
    assert.notEqual(run('write', r).status, 0);
  }
}));
test('writer accepts symlinked HOME while still checking its state directories', () => isolated((run, home) => {
  const alias = join(home, 'home-alias'); symlinkSync(home, alias);
  const r = output(spawnSync(process.execPath, [cli, 'write', '-'], { input: JSON.stringify(receipt()), encoding: 'utf8',
    env: { ...process.env, HOME: alias, XDG_STATE_HOME: join(alias, 'xdg') } }));
  assert.equal(r.verdict, 'LIVE'); assert.equal(JSON.parse(readFileSync(r.path)).receipt_id, r.receipt_id);
}));

test('symlinked CLI rejects a bad receipt for validate and write', () => isolated((_run, home) => {
  const link = join(home, 'receipt-cli.mjs'); symlinkSync(cli, link);
  for (const command of ['validate', 'write']) {
    const result = spawnSync(process.execPath, [link, command, '-'], { input: '{}', encoding: 'utf8' });
    assert.equal(result.status, 1); assert.match(result.stderr, /install-receipt:/);
  }
}));
