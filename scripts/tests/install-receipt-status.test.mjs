import { test, mock } from 'node:test';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { collectStatus, latestRelease, readRemote, readLocal, compareInstall, peelTag, printStatus, readTapVersion, compareBridge } from '../install-receipt-status.mjs';

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
    ['golems', 'mbp', 'INSTALLED_NOT_ACTIVE', 'INSTALLED_NOT_ACTIVE'], ['golems', 'm1', 'INSTALLED_NOT_ACTIVE', 'INSTALLED_NOT_ACTIVE']]);
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
  assert.equal(rows[0].status, 'INSTALLED_NOT_ACTIVE'); assert.equal(rows[1].status, 'UNREACHABLE');
  assert.equal(run({ golems: receipt() }, {}, { releaseReader: () => { throw Error('offline'); } })[0].status, 'UNKNOWN');
});
test('I1 review: golems newest published release wins over same-day hash order', () => {
  const calls = [];
  const rows = run({}, {}, { releaseReader: (repo, options) => latestRelease(repo, (file, args) => {
    calls.push(file);
    if (file === 'git') return `${old}\trefs/tags/v2026.10.27-fb60890\n${sha}\trefs/tags/v2026.10.27-14cf983\n`;
    if (args.includes('--paginate')) return JSON.stringify([
      [{ tag_name: 'v2026.10.27-fb60890', published_at: '2026-10-27T10:00:00Z' }],
      [{ tag_name: 'v2026.10.27-14cf983', published_at: '2026-10-27T15:00:00Z' },
        { tag_name: 'v2026.10.27-ffffff0', published_at: '2026-10-27T16:00:00Z', draft: true }]]);
    assert.deepEqual(args, ['api', 'repos/EtanHey/golems/commits/v2026.10.27-14cf983']);
    return JSON.stringify({ sha });
  }, options) });
  assert.deepEqual(rows.map(r => r.latest), ['v2026.10.27-14cf983', 'v2026.10.27-14cf983']);
  assert.deepEqual(calls, ['gh', 'gh']);
});
test('I1 review: latest includes rc tags while TAP compares the highest stable tag', () => {
  const calls = [];
  const rows = run({}, {}, { products: { cmuxlayer: 'EtanHey/cmuxlayer' }, tapReader: () => '1.0.0',
    releaseReader: (repo, options) => latestRelease(repo, (file, args) => {
      calls.push(file); assert.equal(args[1], '--tags');
      return `${old}\trefs/tags/v0.9.0\n${sha}\trefs/tags/v1.0.0\n${old}\trefs/tags/v1.1.0-rc.1\n`;
    }, options) });
  assert.deepEqual(rows.map(r => [r.latest, r.tap]), [['v1.1.0-rc.1', 'TAP-OK'], ['v1.1.0-rc.1', 'TAP-OK']]);
  assert.deepEqual(calls, ['git', 'git']);
});
test('I1: tags outrank lagging Releases; annotated and lightweight tags resolve to commits', () => {
  for (const annotated of [true, false]) {
    const result = latestRelease('EtanHey/cmuxlayer', (file, args) => {
      assert.equal(file, 'git');
      assert.deepEqual(args, ['ls-remote', '--tags', 'https://github.com/EtanHey/cmuxlayer.git']);
      return `${old}\trefs/tags/v0.4.106\n${old}\trefs/tags/archive/v99.0.0\n`
        + `${annotated ? old : sha}\trefs/tags/v0.4.109\n`
        + (annotated ? `${sha}\trefs/tags/v0.4.109^{}\n` : '');
    });
    assert.deepEqual(result, { version: '0.4.109', tag: 'v0.4.109', released_sha: sha });
  }
});
test('I1: SemVer numeric, prerelease and build precedence; invalid tags are ignored', () => {
  const tags = ['1.2.3', '1.10.0-alpha', '1.10.0-alpha.2', '1.10.0-alpha.10',
    '1.10.0-beta', '1.10.0-rc.1', '1.10.0', '1.10.0+build.1'];
  for (let end = 1; end <= tags.length; end++) {
    const result = latestRelease('EtanHey/golems', () => tags.slice(0, end)
      .concat(['archive/v99.0.0', 'v2', '01.0.0', '2.0.0-01'])
      .map(tag => `${sha}\trefs/tags/${tag}`).reverse().join('\n'));
    assert.equal(result.version.split('+')[0], tags[end - 1].split('+')[0]);
  }
  assert.throws(() => latestRelease('EtanHey/golems', () => `${sha}\trefs/tags/archive/v99.0.0`), /No version tag/);
});
test('I1: tap reads remote HEAD and parses casks, explicit formula versions and archive URLs', () => {
  for (const content of ['  version "1.0.0"',
    '  url "https://registry.npmjs.org/voicelayer-mcp/-/voicelayer-mcp-1.0.0.tgz"',
    '  url "https://files.pythonhosted.org/packages/ab/cd/brainlayer-1.0.0.tar.gz"', '  url "https://github.com/EtanHey/cmuxlayer/archive/refs/tags/v1.0.0.tar.gz"']) {
    assert.equal(readTapVersion('Formula/cmuxlayer.rb', (file, args) => {
      assert.equal(file, 'gh');
      assert.deepEqual(args, ['api', 'repos/EtanHey/homebrew-layers/contents/Formula/cmuxlayer.rb']);
      return JSON.stringify({ encoding: 'base64', content: Buffer.from(content).toString('base64') });
    }), '1.0.0');
  }
  assert.throws(() => readTapVersion('Casks/brainbar.rb', () => JSON.stringify({ content: '' })), /version/i);
});
test('I1: TAP equal, behind, ahead and unreadable fail closed independently of receipts', () => {
  for (const [version, expected] of [['1.0.0', 'TAP-OK'], ['0.9.0', 'TAP-STALE'], ['2.0.0', 'TAP-UNKNOWN'], [null, 'TAP-UNKNOWN']]) {
    let calls = 0;
    const rows = run({}, {}, { products: { cmuxlayer: 'EtanHey/cmuxlayer' }, tapReader: path => {
      calls++; assert.equal(path, 'Formula/cmuxlayer.rb');
      if (version === null) throw Error('offline'); return version;
    } });
    assert.deepEqual(rows.map(r => r.tap), [expected, expected]);
    assert.equal(calls, 1);
  }
  assert.equal(run({}, {})[0].tap, 'TAP-N/A');
  assert.equal(run({}, {}, { products: { cmuxlayer: 'EtanHey/cmuxlayer' }, tapReader: () => '1.0.0',
    releaseReader: () => { throw Error('offline'); } })[0].tap, 'TAP-UNKNOWN');
});
test('I1: a repository override is not compared with the upstream tap', () => {
  assert.equal(run({}, {}, { products: { cmuxlayer: 'owner/fork' }, tapReader: () => assert.fail('wrong tap') })[0].tap, 'TAP-UNKNOWN');
});
test('I1: TAP-STALE exits nonzero; TAP-UNKNOWN preserves otherwise CURRENT exit', () => {
  const write = process.stdout.write, exitCode = process.exitCode;
  try {
    for (const [version, expected, code] of [['0.9.0', 'TAP-STALE', 1], ['1.0.0', 'TAP-OK', 0], [null, 'TAP-UNKNOWN', 0]]) {
      let output = ''; process.exitCode = 0;
      process.stdout.write = chunk => { output += chunk; return true; };
      printStatus(['golems'], { localHostname: 'fixture-mbp', localReader: () => ({ golems: liveReceipt() }),
        remoteReader: () => ({ golems: liveReceipt('m1') }), releaseReader: () => release, resolver: verified,
        tapPaths: { golems: 'Formula/fixture.rb' }, tapReader: () => { if (!version) throw Error('offline'); return version; } });
      assert.match(output, /\tTAP\t/); assert.ok(output.includes(expected)); assert.equal(process.exitCode, code);
    }
  } finally { process.stdout.write = write; process.exitCode = exitCode; }
});
test('I1: a LIVE claim without runtime proof is not LIVE-*', () => {
  for (const ancestry of ['identical', 'ahead']) {
    const r = receipt(); r.product = 'cmuxlayer'; r.verdict = 'LIVE';
    r.activation.processes = [{ pid: 1, path: '/fixture/bin', started_at: '2026-10-27T09:01:00Z' }];
    if (ancestry === 'ahead') { r.target.merge_sha = old; r.target.ancestry.status = 'ahead'; }
    const row = run({ cmuxlayer: r }, {}, { products: { cmuxlayer: 'EtanHey/cmuxlayer' }, tapReader: () => '1.0.0' })[0];
    assert.equal(row.activation, 'INSTALLED_NOT_ACTIVE'); assert.equal(row.status, row.activation);
  }
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
  assert.equal(run({ golems: receipt('m1') }, {}, { localHostname: 'fixture-m1' })[1].status, 'INSTALLED_NOT_ACTIVE');
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

test('A2: status preserves inactive verdict for claimed bump-commit ancestry', () => {
  const r = receipt(); r.target.merge_sha = old; r.target.ancestry.status = 'ahead';
  assert.equal(run({ golems: r }, {})[0].status, 'INSTALLED_NOT_ACTIVE');
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


test('B2 review: latest-tag SHA contradiction is MISMATCH without installed identity', () => {
  const r = receipt(); delete r.installed.embedded_commit;
  r.target.merge_sha = r.target.released_sha = old;
  r.install_source.pin_sha = r.install_source.owner_status.pin_sha = old;
  assert.equal(run({ golems: r }, {})[0].status, 'MISMATCH');
});
test('B2 review: missing or unexpected compare status is LIVE-UNVERIFIED', () => {
  for (const status of [undefined, null, 'unexpected', 42]) {
    const compareAncestry = (repo, merge, released) => compareInstall(repo, merge, released,
      () => JSON.stringify({ status }));
    assert.equal(run({ golems: liveReceipt() }, {}, { resolver: { ...verified, compareAncestry } })[0].status, 'LIVE-UNVERIFIED');
    assert.throws(() => compareAncestry('EtanHey/golems', sha, sha), /Invalid compare status/);
    assert.equal(run({ golems: liveReceipt() }, {}, { resolver: { ...verified, compareAncestry: () => status } })[0].status, 'LIVE-UNVERIFIED');
  }
});
test('B2 review: default git and gh calls disable credential prompts and preserve the environment', () => {
  const calls = [];
  const stub = mock.method(childProcess, 'execFileSync', (file, args, options) => {
    calls.push(file);
    assert.equal(options.env.GIT_TERMINAL_PROMPT, '0');
    assert.equal(options.env.GH_PROMPT_DISABLED, '1');
    assert.equal(options.env.PATH, process.env.PATH);
    if (args.includes('--slurp')) return JSON.stringify([{ status: 'ahead', files: [] }]);
    return file === 'git' ? `${sha}\trefs/tags/v1.0.0^{}\n` : JSON.stringify({ status: 'identical' });
  });
  syncBuiltinESMExports();
  try {
    assert.equal(peelTag('EtanHey/golems', 'v1.0.0'), sha);
    assert.equal(compareInstall('EtanHey/golems', sha, sha), 'identical');
    assert.deepEqual(compareBridge('EtanHey/brainlayer', old, sha), { status: 'ahead', files: [] });
    assert.deepEqual(calls, ['git', 'gh', 'gh']);
  } finally { stub.mock.restore(); syncBuiltinESMExports(); }
});

const bridgePaths = ['src/brainlayer/mcp_stdio_bridge.py', 'src/brainlayer/mcp/', 'src/brainlayer/mcp_socket_config.py'];
function processReceipt(product = 'brainlayer', changed = false) {
  const r = liveReceipt(); r.product = product;
  r.activation.mcp_probe = { server: product, request: 'ping', ok: true, summary: 'fixture' };
  r.activation.seat_scan = { method: 'client-processes', checked_at: '2026-10-27T09:02:00Z',
    clients: [], excluded: [], active_seats: [],
    bridge_diff: { from_tag: 'v0.9.0', to_sha: sha, paths: bridgePaths, changed } };
  return r;
}
function processStatus(r, compareFiles, peelFrom = () => old) {
  const compareBridge = compareFiles && ((...args) => {
    const result = compareFiles(...args);
    return Array.isArray(result) ? { status: 'ahead', files: result } : result;
  });
  return run({ [r.product]: r }, {}, { products: { [r.product]: `EtanHey/${r.product}` },
    tapReader: () => '1.0.0', resolver: { ...verified, peelTag: (repo, tag) => tag === r.target.tag ? sha : peelFrom(repo, tag), compareBridge } })[0];
}
for (const product of ['brainlayer', 'brainbar']) {
  test(`I2e: ${product} false unchanged claim exposes observed bridge paths`, () => {
    const row = processStatus(processReceipt(product), () => ['src/brainlayer/mcp_stdio_bridge.py']);
    assert.equal(row.status, 'MISMATCH');
    assert.deepEqual(row.verification.bridge_diff, {
      claimed: { changed: false, paths: bridgePaths },
      ancestry: { claimed: 'ahead', observed: 'ahead' },
      observed: { changed: true, paths: ['src/brainlayer/mcp_stdio_bridge.py'] },
    });
  });
}
test('I2e: directory prefix matches children, not similarly named siblings', () => {
  assert.equal(processStatus(processReceipt(), () => ['src/brainlayer/mcp/server.py']).status, 'MISMATCH');
  assert.equal(processStatus(processReceipt(), () => ['src/brainlayer/mcp-other/server.py']).status, 'CURRENT');
});
test('I2e: unchanged bridge preserves CURRENT and uses recorded compare endpoints', () => {
  const row = processStatus(processReceipt(), (repo, from, to) => {
    assert.deepEqual([repo, from, to], ['EtanHey/brainlayer', old, sha]);
    return ['README.md'];
  });
  assert.equal(row.status, 'CURRENT');
  assert.deepEqual(row.verification.bridge_diff.observed, { changed: false, paths: [] });
});
test('I2e: conservative changed claim is noted without downgrade', () => {
  const row = processStatus(processReceipt('brainlayer', true), () => []);
  assert.equal(row.status, 'CURRENT');
  assert.match(row.verification.bridge_diff.note, /stricter/i);
});
test('I2e: unavailable or malformed bridge comparison never becomes CURRENT', () => {
  for (const compareBridge of [() => { throw Error('unreachable'); }, () => null, undefined]) {
    assert.equal(processStatus(processReceipt(), compareBridge).status, 'LIVE-UNVERIFIED');
  }
});
test('I2e: GitHub bridge resolver paginates, detects truncation and tracks renames', () => {
  const page = { status: 'ahead', files: [{ filename: 'new.py', previous_filename: bridgePaths[0] }] };
  assert.deepEqual(compareBridge('EtanHey/brainlayer', old, sha, (file, args) => {
    assert.equal(file, 'gh');
    assert.deepEqual(args, ['api', `repos/EtanHey/brainlayer/compare/${old}...${sha}?per_page=100`, '--paginate', '--slurp']);
    return JSON.stringify([page, { status: 'ahead' }]);
  }), { status: 'ahead', files: ['new.py', bridgePaths[0]] });
  for (const response of [[{ status: 'ahead', files: Array.from({ length: 300 }, (_, i) => ({ filename: `file${i}` })) }],
    [{ status: 'ahead' }], [{ status: 'ahead', files: [{}] }], [], [{ status: 'invalid', files: [] }]]) {
    assert.throws(() => compareBridge('EtanHey/brainlayer', old, sha, () => JSON.stringify(response)));
    assert.equal(processStatus(processReceipt(), (repo, from, to) =>
      compareBridge(repo, from, to, () => JSON.stringify(response))).status, 'LIVE-UNVERIFIED');
  }
});

test('I2e: relay products still require reachable compare evidence', () => {
  for (const product of ['voicelayer', 'voicebar']) {
    const r = processReceipt(product);
    r.activation.seat_scan.excluded = [{ rule: 'socat-relay', count: 0,
      reason: 'LIVE = daemon serves the new code; socat seats connected before a daemon restart got EOF and are dead for voicelayer until their session restarts (not visible to ps).' }];
    assert.equal(processStatus(r, () => bridgePaths).status, 'CURRENT');
    assert.equal(processStatus(r, () => { throw Error('offline'); }).status, 'LIVE-UNVERIFIED');
  }
});
test('I2e: inactive receipts do not request bridge comparison', () => {
  const r = processReceipt(); r.verdict = 'INSTALLED_NOT_ACTIVE';
  assert.equal(processStatus(r, () => assert.fail('inactive compare')).status, 'INSTALLED_NOT_ACTIVE');
});

for (const status of ['behind', 'diverged', 'identical']) {
  test(`I2e R1: ${status} prior-tag comparison is MISMATCH even with no files`, () => {
    const row = processStatus(processReceipt(), (repo, from, to) =>
      compareBridge(repo, from, to, () => JSON.stringify([{ status, files: [] }])));
    assert.equal(row.status, 'MISMATCH');
    assert.deepEqual(row.verification.bridge_diff.ancestry, { claimed: 'ahead', observed: status });
  });
}
for (const fromTag of ['master', old]) {
  test(`I2e R1: non-tag ${fromTag} cannot become CURRENT`, () => {
    const r = processReceipt(); r.activation.seat_scan.bridge_diff.from_tag = fromTag;
    const row = processStatus(r, () => ({ status: 'ahead', files: [] }), (repo, tag) =>
      peelTag(repo, tag, (file, args) => {
        assert.ok(args.at(-1).startsWith(`refs/tags/${fromTag}`));
        return `${old}\t${fromTag === 'master' ? 'refs/heads/master' : fromTag}\n`;
      }));
    assert.equal(row.status, 'LIVE-UNVERIFIED');
  });
}
test('I2e R1: prior tag peel failure prevents the file comparison', () => {
  assert.equal(processStatus(processReceipt(), () => assert.fail('unresolved compare'),
    () => { throw Error('tag unreachable'); }).status, 'LIVE-UNVERIFIED');
});
