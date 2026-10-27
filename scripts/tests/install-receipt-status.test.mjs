import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { collectStatus, latestRelease, readRemote, readLocal } from '../install-receipt-status.mjs';

const sha = 'a'.repeat(40), old = 'b'.repeat(40);
function receipt(host = 'mbp') {
  return { schema: 'install-receipt/v1', receipt_id: '00000000-0000-4000-8000-000000000000', written_at: '2026-10-27T10:00:00Z',
    writer: { agent: 'fixture', thread_or_session: 'fixture' }, host: { alias: host, hostname: 'fixture-host', user: 'fixture-user' },
    product: 'golems', artifact_kind: 'skills-sync', target: { version: '1.0.0', merge_sha: sha, tag: 'v1.0.0' },
    installed: { version: '1.0.0', path: '/fixture/hooks-live', embedded_commit: sha, install_finished_at: '2026-10-27T09:00:00Z' },
    install_source: { mode: 'worktree-pin', path: '/fixture/hooks-live', pin_sha: sha,
      owner_status: { command: 'install-hooks.sh --host mbp --status', exit: 0, drift: false, settings_drift: false } },
    activation: { method: 'none', processes: [] }, verdict: 'INSTALLED_NOT_ACTIVE', reasons: [] };
}
const release = { version: '1.0.0', tag: 'v1.0.0', merge_sha: sha };
const run = (local, remote, extra = {}) => collectStatus({ products: { golems: 'EtanHey/golems' },
  localReader: () => local, remoteReader: () => remote, releaseReader: () => release, ...extra });

test('5: product × host matrix uses hooks-live pin without release.json; never promotes activation', () => {
  const rows = run({ golems: receipt() }, { golems: receipt('m1') });
  assert.deepEqual(rows.map(r => [r.product, r.host, r.status, r.activation]), [
    ['golems', 'mbp', 'CURRENT', 'INSTALLED_NOT_ACTIVE'], ['golems', 'm1', 'CURRENT', 'INSTALLED_NOT_ACTIVE']]);
});
test('5: older valid installation is BEHIND; identity drift is MISMATCH', () => {
  const behind = receipt(); behind.target.merge_sha = old; behind.installed.embedded_commit = old; behind.install_source.pin_sha = old;
  behind.target.version = behind.installed.version = '0.9.0'; behind.target.tag = 'v0.9.0';
  assert.equal(run({ golems: behind }, {}).at(0).status, 'BEHIND');
  for (const mutate of [r => { r.installed.embedded_commit = old; }, r => { r.install_source.pin_sha = old; },
    r => { r.install_source.owner_status.drift = true; }, r => { r.install_source.owner_status.settings_drift = true; },
    r => { r.install_source.owner_status.exit = 1; }, r => { r.verdict = 'FAILED'; },
    r => { r.host.alias = 'm1'; }, r => { delete r.target.merge_sha; }]) {
    const r = receipt(); mutate(r); assert.equal(run({ golems: r }, {})[0].status, 'MISMATCH');
  }
});
test('5: absent receipts stay UNKNOWN; corrupt receipt and remote failure never fail open', () => {
  assert.deepEqual(run({}, {}).map(r => [r.status, r.activation]), [['NO-RECEIPT', 'UNKNOWN'], ['NO-RECEIPT', 'UNKNOWN']]);
  assert.equal(run({ golems: { error: 'invalid-json' } }, {})[0].status, 'MISMATCH');
  const rows = run({ golems: receipt() }, {}, { remoteReader: () => { throw Error('ssh failed'); } });
  assert.equal(rows[0].status, 'CURRENT'); assert.equal(rows[1].status, 'UNREACHABLE');
  assert.equal(run({ golems: receipt() }, {}, { releaseReader: () => { throw Error('offline'); } })[0].status, 'UNKNOWN');
});
test('5: release lookup includes prereleases and resolves the tag rather than target branch', () => {
  const calls = [];
  const result = latestRelease('EtanHey/golems', (file, args) => {
    calls.push([file, args]);
    if (args.includes('--paginate')) return JSON.stringify([[{ tag_name: 'v1.0.0', published_at: '2026-10-01' }],
      [{ tag_name: 'v1.1.0-rc.1', prerelease: true, published_at: '2026-10-27', target_commitish: 'master' },
        { tag_name: 'v9', draft: true, published_at: '2026-10-28' }]]);
    assert.equal(args[1], 'repos/EtanHey/golems/commits/v1.1.0-rc.1'); return JSON.stringify({ sha });
  });
  assert.deepEqual(result, { version: '1.1.0-rc.1', tag: 'v1.1.0-rc.1', merge_sha: sha });
  assert.equal(calls.length, 2); assert.ok(calls.every(([file]) => file === 'gh'));
});
test('5: remote transport is exclusively BatchMode ssh to m1 with a read-only reader', () => {
  const result = readRemote(['golems'], (file, args) => {
    assert.equal(file, 'ssh'); assert.deepEqual(args.slice(0, 3), ['-o', 'BatchMode=yes', 'm1']);
    assert.match(args[3], /readFileSync/); assert.doesNotMatch(args[3], /writeFile|unlink|mkdir/);
    return JSON.stringify({ golems: receipt('m1') });
  });
  assert.equal(result.golems.host.alias, 'm1');
});
test('5: a target claim alone cannot make an unidentified install CURRENT', () => {
  const r = receipt(); delete r.installed.embedded_commit;
  assert.equal(run({ golems: r }, {})[0].status, 'UNKNOWN');
});

test('5: local and remote script read latest receipts, distinguish corrupt files, without network', () => {
  mkdirSync(resolve('docs.local'), { recursive: true });
  const home = mkdtempSync(resolve('docs.local/install-status-fixture-'));
  const previousHome = process.env.HOME;
  try {
    process.env.HOME = home;
    const dir = join(home, '.local/state/golems/install-receipts/golems');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'latest.json'), bytes = JSON.stringify(receipt('m1'));
    writeFileSync(file, bytes);
    assert.equal(readLocal(['golems']).golems.host.alias, 'm1');
    const remote = readRemote(['golems'], (_file, args) => execFileSync('/bin/sh', ['-c', args[3]], { encoding: 'utf8' }));
    assert.equal(remote.golems.install_source.pin_sha, sha);
    assert.equal(readLocal(['absent']).absent, null);
    writeFileSync(file, '{'); assert.deepEqual(readLocal(['golems']).golems, { error: 'unreadable-receipt' });
  } finally {
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  }
});
test('5: status CLI loads without an unsettled top-level await', () => {
  // Invalid input stops before transport or release lookup, so this is fully offline.
  try { execFileSync(process.execPath, ['scripts/install-receipt.mjs', 'status', '../invalid'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.fail('invalid product accepted');
  } catch (error) { assert.equal(error.status, 1); assert.match(error.stderr, /Usage: status/); }
});
