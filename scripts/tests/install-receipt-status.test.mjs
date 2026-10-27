import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { collectStatus, latestRelease, readRemote, readLocal, compareInstall, peelTag, printStatus } from '../install-receipt-status.mjs';

const sha = 'a'.repeat(40), old = 'b'.repeat(40);
function receipt(host = 'mbp') {
  return { schema: 'install-receipt/v1', receipt_id: '00000000-0000-4000-8000-000000000000', written_at: '2026-10-27T10:00:00Z',
    writer: { agent: 'fixture', thread_or_session: 'fixture' }, host: { alias: host, hostname: 'fixture-host', user: 'fixture-user' },
    product: 'golems', artifact_kind: 'skills-sync', target: { version: '1.0.0', merge_sha: sha, released_sha: sha, ancestry: { method: 'gh-compare', status: 'identical', checked_at: '2026-10-27T09:00:00Z' }, tag: 'v1.0.0' },
    installed: { version: '1.0.0', path: '/fixture/hooks-live', embedded_commit: sha, install_finished_at: '2026-10-27T09:00:00Z' },
    install_source: { mode: 'worktree-pin', path: '/fixture/hooks-live', pin_sha: sha,
      owner_status: { pin_sha: sha, command: 'install-hooks.sh --host mbp --status', exit: 0, drift: false, settings_drift: false } },
    activation: { method: 'none', processes: [] }, verdict: 'INSTALLED_NOT_ACTIVE', reasons: [] };
}
const release = { version: '1.0.0', tag: 'v1.0.0', released_sha: sha };
const run = (local, remote, extra = {}) => collectStatus({ products: { golems: 'EtanHey/golems' },
  localReader: () => local, remoteReader: () => remote, releaseReader: () => release, localHostname: 'fixture-mbp', comparisonReader: () => 'behind', resolver: { peelTag: () => { throw Error('offline'); } }, ...extra });

test('5: product × host matrix uses hooks-live pin without release.json; never promotes activation', () => {
  const rows = run({ golems: receipt() }, { golems: receipt('m1') });
  assert.deepEqual(rows.map(r => [r.product, r.host, r.status, r.activation]), [
    ['golems', 'mbp', 'LIVE-UNVERIFIED', 'INSTALLED_NOT_ACTIVE'], ['golems', 'm1', 'LIVE-UNVERIFIED', 'INSTALLED_NOT_ACTIVE']]);
});
test('5: older valid installation is BEHIND; identity drift is MISMATCH', () => {
  const behind = receipt(); behind.target.merge_sha = old; behind.target.released_sha = old; behind.installed.embedded_commit = old; behind.install_source.pin_sha = behind.install_source.owner_status.pin_sha = old;
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
  assert.equal(rows[0].status, 'LIVE-UNVERIFIED'); assert.equal(rows[1].status, 'UNREACHABLE');
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
  assert.deepEqual(result, { version: '1.1.0-rc.1', tag: 'v1.1.0-rc.1', released_sha: sha });
  assert.equal(calls.length, 2); assert.ok(calls.every(([file]) => file === 'gh'));
});
test('5: remote transport is exclusively BatchMode ssh to m1 with a read-only reader', () => {
  const result = readRemote(['golems'], (file, args) => {
    assert.equal(file, 'ssh'); assert.deepEqual(args.slice(0, 3), ['-o', 'BatchMode=yes', 'm1']);
    assert.equal(args[3], 'cat -- "$HOME/.local/state/golems/install-receipts/golems/latest.json"');
    return JSON.stringify(receipt('m1'));
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
test('5: status CLI rejects invalid products without transport', () => {
  // Invalid input stops before transport or release lookup, so this is fully offline.
  try { execFileSync(process.execPath, ['scripts/install-receipt.mjs', 'status', '../invalid'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.fail('invalid product accepted');
  } catch (error) { assert.equal(error.status, 1); assert.match(error.stderr, /Usage: status/); }
});

test('5: M1 hostname uses local receipts as m1; unknown host fails closed', () => {
  assert.equal(run({ golems: receipt('m1') }, {}, { localHostname: 'fixture-m1' })[1].status, 'LIVE-UNVERIFIED');
  assert.throws(() => run({}, {}, { localHostname: 'unknown-host' }), /Unknown local host/);
});
test('5: installs descended from the latest release are AHEAD; divergence is UNKNOWN', () => {
  const r = receipt(); r.target.merge_sha = old; r.target.released_sha = old; r.installed.embedded_commit = old; r.install_source.pin_sha = r.install_source.owner_status.pin_sha = old;
  r.target.version = r.installed.version = '2.0.0'; r.target.tag = 'v2.0.0';
  assert.equal(run({ golems: r }, {}, { comparisonReader: () => 'ahead' })[0].status, 'AHEAD');
  assert.equal(run({ golems: r }, {}, { comparisonReader: () => 'diverged' })[0].status, 'UNKNOWN');
});
test('5: cat missing file is NO-RECEIPT; corrupt JSON is MISMATCH; ssh failure is unreachable', () => {
  const missing = readRemote(['golems'], () => { throw Object.assign(Error(), { status: 1, stderr: 'cat: No such file or directory' }); });
  assert.equal(missing.golems, null);
  assert.deepEqual(readRemote(['golems'], () => '{').golems, { error: 'unreadable-receipt' });
  assert.throws(() => readRemote(['golems'], () => { throw Object.assign(Error(), { status: 255 }); }));
  assert.throws(() => readRemote(['../escape'], () => assert.fail('must not execute')), /Invalid product/);
});

test('5: ancestry lookup compares release to install using mocked GitHub only', () => {
  assert.equal(compareInstall('EtanHey/golems', sha, old, (file, args) => {
    assert.equal(file, 'gh');
    assert.deepEqual(args, ['api', `repos/EtanHey/golems/compare/${sha}...${old}`]);
    return JSON.stringify({ status: 'ahead' });
  }), 'ahead');
});

test('A2: status leaves claimed bump-commit ancestry LIVE-UNVERIFIED', () => {
  const r = receipt(); r.target.merge_sha = old; r.target.ancestry.status = 'ahead';
  assert.equal(run({ golems: r }, {})[0].status, 'LIVE-UNVERIFIED');
  for (const status of ['behind', 'diverged']) {
    r.target.ancestry.status = status;
    assert.equal(run({ golems: r }, {})[0].status, 'MISMATCH');
  }
});

test('A2 review: latest tag with a different resolved SHA is MISMATCH', () => {
  const r = receipt(); r.target.merge_sha = r.target.released_sha = old;
  r.installed.embedded_commit = r.install_source.pin_sha = r.install_source.owner_status.pin_sha = old;
  for (const comparison of ['ahead', 'behind']) {
    assert.equal(run({ golems: r }, {}, { comparisonReader: () => comparison })[0].status, 'MISMATCH');
  }
});
test('A2 review: LIVE is unverified pending B2, including failed release lookup', () => {
  const r = receipt(); r.verdict = 'LIVE';
  r.activation.processes = [{ pid: 1, path: '/fixture/bin', started_at: '2026-10-27T09:01:00Z' }];
  r.activation.self_report = { command: 'version', version: '1.0.0', commit: sha };
  assert.equal(run({ golems: r }, {})[0].status, 'LIVE-UNVERIFIED');
  r.target.merge_sha = old; r.target.ancestry.status = 'ahead';
  assert.equal(run({ golems: r }, {})[0].status, 'LIVE-UNVERIFIED');
  assert.equal(run({ golems: r }, {}, { releaseReader: () => { throw Error('offline'); } })[0].status, 'LIVE-UNVERIFIED');
});
test('A2 review: PR-A-era receipts are MISMATCH', () => {
  const r = receipt(); delete r.target.released_sha; delete r.target.ancestry;
  assert.equal(run({ golems: r }, {})[0].status, 'MISMATCH');
});

function liveReceipt(host = 'mbp') {
  const r = receipt(host); r.verdict = 'LIVE';
  r.activation.processes = [{ pid: 1, path: '/fixture/bin', started_at: '2026-10-27T09:01:00Z' }];
  r.activation.self_report = { command: 'version', version: '1.0.0', commit: sha };
  return r;
}
const verified = { peelTag: () => sha, compareAncestry: () => 'identical' };
test('5a: behind or diverged merge ancestry is MISMATCH with claimed and observed evidence', () => {
  for (const status of ['behind', 'diverged']) {
    const row = run({ golems: liveReceipt() }, {}, { resolver: { ...verified, compareAncestry: () => status } })[0];
    assert.equal(row.status, 'MISMATCH');
    assert.deepEqual(row.verification.ancestry, { claimed: 'identical', observed: status });
  }
});
test('5a: changed release tag is MISMATCH even when the latest-release lookup agrees with the claim', () => {
  const row = run({ golems: liveReceipt() }, {}, { resolver: { ...verified, peelTag: () => old } })[0];
  assert.equal(row.status, 'MISMATCH');
  assert.deepEqual(row.verification.released_sha, { claimed: sha, observed: old });
});
test('5a: failure in either independent lookup is LIVE-UNVERIFIED', () => {
  for (const lookup of ['peelTag', 'compareAncestry']) {
    let called = false;
    assert.equal(run({ golems: liveReceipt() }, {}, { resolver: { ...verified,
      [lookup]: () => { called = true; throw Error('offline'); } } })[0].status, 'LIVE-UNVERIFIED');
    assert.equal(called, true);
  }
});
test('5a: only verified LIVE receipts for the latest release become CURRENT on both hosts', () => {
  const calls = [];
  const resolver = {
    peelTag: (repo, tag) => { calls.push([repo, tag]); return sha; },
    compareAncestry: (repo, merge, released) => { calls.push([repo, merge, released]); return 'identical'; },
  };
  assert.deepEqual(run({ golems: liveReceipt() }, { golems: liveReceipt('m1') }, { resolver }).map(r => r.status), ['CURRENT', 'CURRENT']);
  assert.deepEqual(calls, [['EtanHey/golems', 'v1.0.0'], ['EtanHey/golems', sha, sha],
    ['EtanHey/golems', 'v1.0.0'], ['EtanHey/golems', sha, sha]]);
  const bumped = liveReceipt(); bumped.target.merge_sha = old; bumped.target.ancestry.status = 'ahead';
  assert.equal(run({ golems: bumped }, {}, { resolver: { ...verified, compareAncestry: () => 'ahead' } })[0].status, 'CURRENT');
  assert.equal(run({ golems: liveReceipt() }, {}, { resolver: verified, releaseReader: () => { throw Error('offline'); } })[0].status, 'LIVE-UNVERIFIED');
  assert.notEqual(run({ golems: receipt() }, {}, { resolver: verified })[0].status, 'CURRENT');
});
test('5a: tag resolver peels annotated tags and falls back only for lightweight tags', () => {
  for (const annotated of [true, false]) {
    const calls = [];
    assert.equal(peelTag('EtanHey/golems', 'v1.0.0', (file, args) => {
      calls.push([file, args]);
      return args.at(-1).endsWith('^{}') ? (annotated ? `${sha}\trefs/tags/v1.0.0^{}\n` : '') : `${sha}\trefs/tags/v1.0.0\n`;
    }), sha);
    assert.deepEqual(calls, [
      ['git', ['ls-remote', '--tags', 'https://github.com/EtanHey/golems.git', 'refs/tags/v1.0.0^{}']],
      ...(!annotated ? [['git', ['ls-remote', '--tags', 'https://github.com/EtanHey/golems.git', 'refs/tags/v1.0.0']]] : []),
    ]);
  }
  for (const output of ['', 'malformed', `${sha}\trefs/tags/wrong`]) {
    assert.throws(() => peelTag('EtanHey/golems', 'v1.0.0', () => output), /Unresolved/);
  }
  assert.throws(() => peelTag('EtanHey/golems', 'v1.0.0', () => { throw Error('offline'); }), /offline/);
});
test('5a: independently verified old LIVE release is BEHIND; contradictory ancestry is MISMATCH', () => {
  const r = liveReceipt(); r.target.tag = 'v0.9.0';
  const newer = { ...release, released_sha: old };
  assert.equal(run({ golems: r }, {}, { resolver: verified, releaseReader: () => newer })[0].status, 'BEHIND');
  r.target.merge_sha = old; r.target.ancestry.status = 'ahead';
  assert.equal(run({ golems: r }, {}, { resolver: verified })[0].status, 'MISMATCH');
  delete r.target.tag;
  assert.equal(run({ golems: r }, {}, { resolver: { ...verified, peelTag: (_repo, tag) => peelTag('EtanHey/golems', tag, () => assert.fail('missing tag must not execute')) } })[0].status, 'LIVE-UNVERIFIED');
});
test('5a: printed mismatch exposes claimed and observed tag SHAs', () => {
  const write = process.stdout.write, exitCode = process.exitCode; let output = '';
  try {
    process.stdout.write = chunk => { output += chunk; return true; };
    printStatus(['golems'], { localHostname: 'fixture-m1', localReader: () => ({ golems: liveReceipt('m1') }),
      releaseReader: () => release, resolver: { ...verified, peelTag: () => old } });
    assert.match(output, /MISMATCH/);
    assert.ok(output.includes(JSON.stringify({ claimed: sha, observed: old })));
    assert.equal(process.exitCode, 1);
  } finally { process.stdout.write = write; process.exitCode = exitCode; }
});
