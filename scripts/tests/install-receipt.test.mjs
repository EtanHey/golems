import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { hostname, userInfo } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as core from '../lib/install-receipt-core.mjs';
const { assess, CLIENT_RULES } = core;

const cli = resolve('scripts/install-receipt.mjs');
const sha = 'a'.repeat(40), digest = 'b'.repeat(64);
function receipt() {
  return { schema: 'install-receipt/v1', receipt_id: randomUUID(), written_at: '2026-10-27T10:00:00.000Z',
    writer: { agent: 'test-worker', thread_or_session: 'test' }, host: { alias: 'mbp', hostname: hostname(), user: userInfo().username },
    product: 'golems', artifact_kind: 'source-checkout', target: { version: '1.0.0', merge_sha: sha, released_sha: sha,
      ancestry: { method: 'gh-compare', status: 'identical', checked_at: '2026-10-27T09:00:00Z' } },
    installed: { version: '1.0.0', path: '/fixture/hooks-live', embedded_commit: sha, install_finished_at: '2026-10-27T09:00:00Z' },
    install_source: { mode: 'worktree-pin', path: '/fixture/hooks-live', pin_sha: sha,
      owner_status: { pin_sha: sha, command: 'install-hooks.sh --host mbp --status', exit: 0, drift: false, settings_drift: false } },
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

const bridge = '/opt/homebrew/opt/brainlayer/bin/brainlayer-mcp-stdio-bridge';
const bridgePaths = ['src/brainlayer/mcp_stdio_bridge.py', 'src/brainlayer/mcp/', 'src/brainlayer/mcp_socket_config.py'];
const socat = '/opt/homebrew/bin/socat STDIO UNIX-CONNECT:/tmp/voicelayer-mcp.sock';
const relayReason = 'LIVE = daemon serves the new code; socat seats connected before a daemon restart got EOF and are dead for voicelayer until their session restarts (not visible to ps).';
const client = (started_at = '2026-10-27T09:00:00Z', command = bridge) => ({
  pid: 321, started_at, argv: command.trim().split(/\s+/), argv_source: 'ps-split', thread_id: null,
});
const clientKey = c => `pid:${c.pid}@${c.started_at}`;
function processReceipt(product = 'brainlayer') {
  const r = receipt(); r.product = product;
  r.activation.mcp_probe = { server: product, request: 'ping', ok: true, summary: 'fixture probe' };
  r.activation.seat_scan = { method: 'client-processes', checked_at: '2026-10-27T09:02:00Z',
    clients: [], excluded: [], bridge_diff: { from_tag: 'v0.9.0', to_sha: sha, paths: bridgePaths, changed: true }, active_seats: [] };
  return r;
}
for (const [name, product, clients, changed, stale] of [
  ['equal-second stale', 'brainlayer', [client()], true, true],
  ['PID reuse fresh', 'brainlayer', [client('2026-10-27T09:00:01Z')], true, false],
  ['unchanged bridge', 'brainlayer', [client()], false, false],
  ['BrainBar shares bridge clients', 'brainbar', [client()], true, true],
  ['Cellar bridge argv', 'brainlayer', [client(undefined, '/opt/homebrew/bin/python3 /opt/homebrew/Cellar/brainlayer/1.5.77/bin/brainlayer-mcp-stdio-bridge')], true, true],
  ['brew symlink bridge', 'brainlayer', [client(undefined, '/opt/homebrew/bin/brainlayer-mcp-stdio-bridge')], true, true],
]) {
  test(`I2d: ${name}`, () => isolated(run => {
    const r = processReceipt(product), scan = r.activation.seat_scan;
    scan.clients = clients; scan.bridge_diff.changed = changed;
    scan.active_seats = stale ? clients.map(clientKey) : [];
    // A reconnect claim cannot clear a stale process.
    r.activation.reconnected_seats = scan.active_seats;
    const validated = run('validate', r);
    assert.equal(validated.status, stale ? 1 : 0, validated.stderr);
    const written = output(run('write', r));
    assert.equal(written.verdict, stale ? 'INSTALLED_NOT_ACTIVE' : 'LIVE');
    if (stale) assert.ok(written.reasons.join(' ').includes(clientKey(clients[0])));
    if (!changed) assert.match(written.reasons.join(' '), /bridge_diff.changed=false/);
  }));
}
test('I2d: daemon/helper commands and lookalike paths are refused as clients', () => isolated(run => {
  for (const commandText of ['watch', 'drain', 'daemon', 'hybrid-helper', 'supervisor_guard'].map(name =>
    `/opt/homebrew/opt/brainlayer/bin/${name}`).concat(`${bridge}-helper`)) {
    const r = processReceipt();
    r.activation.seat_scan.clients = [client(undefined, commandText)];
    r.activation.seat_scan.excluded = [{ rule: 'daemon-process', reason: 'Server processes are not clients', count: 5 }];
    for (const command of ['validate', 'write']) {
      const result = run(command, r);
      assert.equal(result.status, 1); assert.match(result.stderr, /unmatched client in seat_scan.clients/);
    }
  }
}));
test('I2d R1: fractional client timestamps are refused and core floors seconds defensively', () => isolated(run => {
  const r = processReceipt(), c = client('2026-10-27T09:00:00.300Z');
  r.activation.seat_scan.clients = [c];
  for (const command of ['validate', 'write']) {
    const result = run(command, r); assert.equal(result.status, 1); assert.match(result.stderr, /started_at/);
  }
  assert.equal(assess(r)[0], 'INSTALLED_NOT_ACTIVE');
  assert.ok(assess(r)[1].includes(clientKey(c)));
}));
test('I2d R1: bridge diff must start at a distinct prior-version tag', () => isolated(run => {
  for (const [priorVersion, fromTag] of [[undefined, 'v1.0.0'], ['0.9.0', 'v0.8.0']]) {
    const r = processReceipt(); r.target.tag = 'v1.0.0';
    if (priorVersion) r.prior = { version: priorVersion };
    r.activation.seat_scan.bridge_diff.from_tag = fromTag;
    for (const command of ['validate', 'write']) {
      const result = run(command, r); assert.equal(result.status, 1); assert.match(result.stderr, /from_tag/);
    }
  }
  for (const version of ['0.9.0', 'v0.9.0']) {
    const r = processReceipt(); r.target.tag = 'v1.0.0'; r.prior = { version };
    assert.equal(output(run('validate', r)).verdict, 'LIVE');
  }
}));
test('I2d R1: unrecognised bridge paths fail closed, even with unchanged bridge code', () => isolated(run => {
  for (const path of [`/untrusted${bridge}`, 'brainlayer-mcp-stdio-bridge',
    '/opt/homebrew/Cellar/brainlayer/../bin/brainlayer-mcp-stdio-bridge',
    '/opt/homebrew/Cellar/brainlayer/./bin/brainlayer-mcp-stdio-bridge']) {
    for (const commandText of [path, `/opt/homebrew/bin/python3 ${path}`, `uv run ${path} --verbose`]) {
      for (const changed of [true, false]) {
        const r = processReceipt(); r.activation.seat_scan.clients = [client(undefined, commandText)];
        r.activation.seat_scan.bridge_diff.changed = changed;
        for (const command of ['validate', 'write']) {
          const result = run(command, r); assert.equal(result.status, 1); assert.match(result.stderr, /unrecognised bridge path/);
        }
      }
    }
  }
}));
for (const product of ['voicelayer', 'voicebar']) {
  test(`I2d: ${product} socat is excluded with the mandatory limitation`, () => isolated(run => {
    const r = processReceipt(product), scan = r.activation.seat_scan;
    scan.clients = [client(undefined, socat), { ...client(undefined, socat.replace('/opt/homebrew/bin/', '')), pid: 322 }];
    scan.excluded = [{ rule: 'socat-relay', reason: relayReason, count: 2 }];
    assert.equal(output(run('validate', r)).verdict, 'LIVE');
    assert.equal(output(run('write', r)).verdict, 'LIVE');
    const filtered = structuredClone(r); filtered.activation.seat_scan.clients = [];
    assert.equal(output(run('write', filtered)).verdict, 'LIVE');
    for (const mutate of [s => { s.excluded = []; }, s => { s.excluded[0].reason = 'version neutral'; }]) {
      const bad = structuredClone(r); mutate(bad.activation.seat_scan);
      for (const command of ['validate', 'write']) {
        const result = run(command, bad); assert.equal(result.status, 1); assert.match(result.stderr, /socat-relay/);
      }
    }
  }));
}
test('I2d: validate and write refuse forged stale lists, including PID reuse', () => isolated(run => {
  for (const [clients, seats] of [
    [[client()], []], [[], [clientKey(client())]],
    [[client('2026-10-27T09:00:01Z')], [clientKey(client())]],
    [[client()], [clientKey(client()), clientKey(client())]],
  ]) {
    const r = processReceipt(); r.activation.seat_scan.clients = clients; r.activation.seat_scan.active_seats = seats;
    r.verdict = 'INSTALLED_NOT_ACTIVE';
    for (const command of ['validate', 'write']) {
      const result = run(command, r); assert.equal(result.status, 1); assert.match(result.stderr, /active_seats.*derived/);
    }
  }
}));
test('I2d: cmuxlayer has no observed client matcher', () => isolated(run => {
  for (const command of ['validate', 'write']) {
    const result = run(command, processReceipt('cmuxlayer'));
    assert.equal(result.status, 1); assert.match(result.stderr, /no client matcher for cmuxlayer/);
  }
}));
test('I2d: closed schema refuses malformed process evidence', () => isolated(run => {
  for (const mutate of [s => { delete s.clients; }, s => { s.clients = [{ ...client(), pid: 1.5 }]; },
    s => { s.clients = [{ ...client(), pid: 0 }]; }, s => { s.clients = [{ ...client(), started_at: 'yesterday' }]; },
    s => { s.clients = [{ ...client(), argv: [''] }]; }, s => { s.clients = [{ ...client(), thread_id: 4 }]; },
    s => { s.clients = [{ pid: 1 }]; }, s => { s.clients = [{ ...client(), secret: 'forbidden' }]; },
    s => { delete s.excluded; }, s => { s.excluded = [{ rule: 'guess', reason: 'fixture', count: 1 }]; },
    s => { s.excluded = [{ rule: 'daemon-process', reason: 'fixture', count: -1 }]; },
    s => { delete s.bridge_diff; }, s => { s.bridge_diff.changed = 'false'; },
    s => { s.bridge_diff.to_sha = 'abc'; }]) {
    const r = processReceipt(); mutate(r.activation.seat_scan);
    for (const command of ['validate', 'write']) {
      const result = run(command, r); assert.equal(result.status, 1); assert.match(result.stderr, /seat_scan/);
    }
  }
}));
test('I2d: LIVE still requires a successful probe and a strictly later scan', () => isolated(run => {
  for (const mutate of [r => { r.activation.mcp_probe.ok = false; }, r => { delete r.activation.mcp_probe; },
    r => { r.activation.seat_scan.checked_at = r.installed.install_finished_at; },
    r => { r.activation.seat_scan.checked_at = '2026-10-27T08:59:59Z'; }]) {
    const r = processReceipt(); mutate(r);
    r.activation.seat_scan.clients = [client()]; r.activation.seat_scan.active_seats = [clientKey(client())];
    assert.equal(run('validate', r).status, 1);
    const written = output(run('write', r));
    assert.equal(written.verdict, 'INSTALLED_NOT_ACTIVE');
    assert.ok(written.reasons.join(' ').includes(clientKey(client())));
  }
}));
test('I2d: bridge diff identifies the release and covers the core bridge paths', () => isolated(run => {
  for (const mutate of [s => { s.bridge_diff.to_sha = 'c'.repeat(40); }, s => { s.bridge_diff.paths = []; }]) {
    const r = processReceipt(); mutate(r.activation.seat_scan);
    for (const command of ['validate', 'write']) {
      const result = run(command, r); assert.equal(result.status, 1); assert.match(result.stderr, /bridge_diff/);
    }
  }
}));
test('I2d: a writer-held bridge stays stale and empty socat scans still disclose the limitation', () => isolated(run => {
  const r = processReceipt(), c = client(); c.thread_id = r.writer.thread_or_session;
  r.activation.seat_scan.clients = [c]; r.activation.seat_scan.active_seats = [clientKey(c)];
  assert.equal(output(run('write', r)).verdict, 'INSTALLED_NOT_ACTIVE');
  const voice = processReceipt('voicebar');
  voice.activation.seat_scan.excluded = [{ rule: 'socat-relay', count: 0, reason: relayReason }];
  assert.equal(output(run('write', voice)).verdict, 'LIVE');
  voice.activation.seat_scan.excluded = [];
  assert.equal(run('validate', voice).status, 1);
}));

for (const product of ['brainlayer', 'brainbar']) {
  for (const commandText of [`${bridge} --verbose`, `uv run ${bridge} --verbose`,
    `/usr/bin/env python3 ${bridge}`, `editor ${bridge} --daemon`,
    `--bridge=${bridge}`, `--bridge:${bridge}`,
    `python3 ${bridge} --label an argument with spaces`]) {
    test(`I2f: ${product} full ps-split argv matches ${commandText}`, () => isolated(run => {
      const r = processReceipt(product), c = client(undefined, commandText);
      r.activation.seat_scan.clients = [c]; r.activation.seat_scan.active_seats = [clientKey(c)];
      assert.equal(assess(r)[0], 'INSTALLED_NOT_ACTIVE');
      const result = run('validate', r);
      assert.equal(result.status, 1); assert.match(result.stderr, /Stale MCP client processes/);
      assert.equal(output(run('write', r)).verdict, 'INSTALLED_NOT_ACTIVE');
      r.verdict = 'INSTALLED_NOT_ACTIVE';
      assert.equal(output(run('validate', r)).verdict, 'INSTALLED_NOT_ACTIVE');
    }));
  }
}
for (const product of ['brainlayer', 'brainbar']) {
  test(`I2f R1: ${product} refuses prefixed paths and the Cellar dot-dot bypass`, () => isolated(run => {
    for (const path of [`/untrusted${bridge}`, `/fixture/root${bridge}`,
      '/fixture/root/opt/homebrew/Cellar/brainlayer/1.5.77/bin/brainlayer-mcp-stdio-bridge',
      '/opt/homebrew/Cellar/brainlayer/../opt/homebrew/bin/brainlayer-mcp-stdio-bridge']) {
      for (const started_at of ['2026-10-27T09:00:00Z', '2026-10-27T09:00:01Z']) {
        const r = processReceipt(product);
        r.activation.seat_scan.clients = [client(started_at, `uv run ${path} --verbose`)];
        for (const command of ['validate', 'write']) {
          const result = run(command, r);
          assert.equal(result.status, 1); assert.match(result.stderr, /unrecognised bridge path/);
        }
      }
    }
  }));
  test(`I2f R1: ${product} refuses a prefixed bridge basename`, () => isolated(run => {
    const r = processReceipt(product);
    r.activation.seat_scan.clients = [client(undefined, '/opt/homebrew/bin/xbrainlayer-mcp-stdio-bridge')];
    for (const command of ['validate', 'write']) {
      const result = run(command, r);
      assert.equal(result.status, 1); assert.match(result.stderr, /unmatched client in seat_scan.clients/);
    }
  }));
  test(`I2f R1: ${product} extra-args bridge started after install is LIVE`, () => isolated(run => {
    const r = processReceipt(product);
    r.activation.seat_scan.clients = [client('2026-10-27T09:00:01Z', `uv run ${bridge} --verbose`)];
    for (const command of ['validate', 'write']) assert.equal(output(run(command, r)).verdict, 'LIVE');
  }));
}
test('I2f R1: exported bridge matchers consume argv arrays without regex coercion', () => {
  assert.equal('BRIDGE' in core, false);
  for (const product of ['brainlayer', 'brainbar']) {
    const matcher = CLIENT_RULES.get(product).bridge;
    assert.equal(matcher.test(['uv', 'run', bridge, '--verbose']), true);
    assert.equal(matcher.test(['uv', 'run', '--bridge=' + bridge, '--verbose']), true);
    assert.equal(matcher.test(['/untrusted' + bridge]), false);
    assert.throws(() => matcher.test(bridge), TypeError);
  }
});
for (const product of ['brainlayer', 'brainbar', 'voicelayer', 'voicebar']) {
  test(`I2f: ${product} refuses every unmatched client even with unchanged bridge code`, () => isolated((run, home) => {
    for (const changed of [true, false]) {
      const r = processReceipt(product);
      r.activation.seat_scan.clients = [client(undefined, 'unrelated --verbose')];
      r.activation.seat_scan.bridge_diff.changed = changed;
      for (const command of ['validate', 'write']) {
        const result = run(command, r);
        assert.equal(result.status, 1); assert.match(result.stderr, /unmatched client in seat_scan.clients/);
      }
    }
    assert.deepEqual(readdirSync(home), []);
  }));
}
for (const product of ['voicelayer', 'voicebar']) {
  test(`I2f: ${product} socat tokens match with extra arguments`, () => isolated(run => {
    const r = processReceipt(product), scan = r.activation.seat_scan;
    scan.clients = [client(undefined, `socat -d -d STDIO UNIX-CONNECT:/tmp/voicelayer-mcp.sock,ignored`),
      client(undefined, `/opt/homebrew/bin/socat -d STDIO UNIX-CONNECT:/tmp/voicelayer-mcp.sock --extra`)];
    scan.excluded = [{ rule: 'socat-relay', reason: relayReason, count: 2 }];
    // Socket lookalikes cannot silently count as matched relays.
    const bad = run('validate', r); assert.equal(bad.status, 1);
    assert.match(bad.stderr, /unmatched client in seat_scan.clients/);
    scan.clients[0] = client(undefined, 'socat -d -d STDIO UNIX-CONNECT:/tmp/voicelayer-mcp.sock');
    assert.equal(output(run('validate', r)).verdict, 'LIVE');
    assert.equal(output(run('write', r)).verdict, 'LIVE');
  }));
}
test('I2f: argv source and non-empty token arrays replace command', () => isolated(run => {
  for (const argv_source of ['ps-split', 'procargs2']) {
    const r = processReceipt(), c = client('2026-10-27T09:00:01Z');
    c.argv_source = argv_source;
    if (argv_source === 'procargs2') c.argv.push('--label', 'an argument with spaces');
    r.activation.seat_scan.clients = [c];
    assert.equal(output(run('validate', r)).verdict, 'LIVE');
  }
  for (const mutate of [c => { delete c.argv; }, c => { c.argv = []; },
    c => { c.argv = bridge; }, c => { c.argv = ['']; }, c => { c.argv = [123]; },
    c => { delete c.argv_source; }, c => { c.argv_source = 'guess'; },
    c => { c.command = bridge; }, c => { delete c.argv; c.command = bridge; }]) {
    const r = processReceipt(), c = client(); mutate(c); r.activation.seat_scan.clients = [c];
    for (const command of ['validate', 'write']) {
      const result = run(command, r); assert.equal(result.status, 1); assert.match(result.stderr, /seat_scan/);
    }
  }
}));

for (const product of ['brainlayer', 'voicelayer', 'cmuxlayer', 'brainbar', 'voicebar']) {
  for (const proof of ['self-report', 'missing-seats', 'empty-seats', 'failed-probe', 'complete', 'uncovered-seat', 'partial-coverage', 'old-scan', 'equal-scan', 'missing-scan']) {
    test(`I2: ${product} activation with ${proof}`, () => isolated(run => {
      const r = receipt(); r.product = product;
      if (proof !== 'self-report') r.activation.mcp_probe = {
        server: product, request: 'ping', ok: proof !== 'failed-probe', summary: 'fixture probe',
      };
      if (proof !== 'missing-scan') r.activation.seat_scan = {
        method: 't3-threads', checked_at: '2026-10-27T09:02:00Z', active_seats: [],
      };
      if (proof === 'empty-seats') r.activation.reconnected_seats = [];
      if (['failed-probe', 'complete', 'uncovered-seat', 'partial-coverage'].includes(proof)) {
        r.activation.seat_scan.active_seats = ['fixture-seat'];
      }
      if (proof === 'partial-coverage') {
        r.activation.seat_scan.active_seats.push('other-seat');
        r.activation.reconnected_seats = ['fixture-seat'];
      }
      if (proof === 'old-scan') r.activation.seat_scan.checked_at = '2026-10-27T08:59:00Z';
      if (proof === 'equal-scan') r.activation.seat_scan.checked_at = r.installed.install_finished_at;
      if (proof === 'complete') r.activation.seat_scan.method = 'list_agents';
      if (['failed-probe', 'complete', 'old-scan', 'equal-scan', 'missing-scan'].includes(proof)) {
        r.activation.reconnected_seats = ['fixture-seat'];
      }
      const live = ['missing-seats', 'empty-seats', 'complete'].includes(proof);
      const validated = run('validate', r);
      assert.equal(validated.status, live ? 0 : 1, `${proof}: ${validated.stderr}`);
      const written = output(run('write', r));
      assert.equal(written.verdict, live ? 'LIVE' : 'INSTALLED_NOT_ACTIVE', proof);
      if (!live) {
        const reason = ['self-report', 'failed-probe'].includes(proof) ? /mcp_probe/
          : proof === 'missing-scan' ? /seat_scan/
          : ['old-scan', 'equal-scan'].includes(proof) ? /checked_at.*install_finished_at/
          : /active_seats.*reconnected_seats/;
        assert.match(written.reasons.join(' '), reason);
      }
    }));
  }
}
test('I2b: seat scans validate both methods and reject malformed evidence', () => isolated(run => {
  for (const method of ['t3-threads', 'list_agents']) {
    const r = receipt(); r.activation.seat_scan = { method, checked_at: '2026-10-27T09:02:00Z', active_seats: [] };
    assert.equal(output(run('validate', r)).verdict, 'LIVE');
    for (const mutate of [scan => { scan.method = 'guess'; }, scan => { delete scan.method; },
      scan => { delete scan.checked_at; }, scan => { scan.checked_at = '2026-02-30T09:02:00Z'; },
      scan => { scan.checked_at = '2026-10-27T09:02:00+00:00'; }, scan => { delete scan.active_seats; },
      scan => { scan.active_seats = ['']; }, scan => { scan.active_seats = [123]; },
      scan => { scan.active_seats = 'fixture-seat'; }]) {
      const bad = structuredClone(r); mutate(bad.activation.seat_scan);
      for (const command of ['validate', 'write']) {
        const result = run(command, bad);
        assert.notEqual(result.status, 0); assert.match(result.stderr, /seat_scan/);
      }
    }
  }
}));
for (const product of ['golems', 'brainlayer', 'voicelayer', 'cmuxlayer', 'brainbar', 'voicebar', 'custom-product']) {
  for (const field of ['reconnected_seats', 'active_seats']) {
    test(`I2c: ${product} rejects writer in ${field}`, () => isolated((run, home) => {
      const r = receipt(); r.product = product;
      r.activation.reconnected_seats = field === 'reconnected_seats' ? ['test'] : [];
      r.activation.seat_scan = { method: 't3-threads', checked_at: '2026-10-27T09:02:00Z',
        active_seats: field === 'active_seats' ? ['test'] : [] };
      for (const command of ['validate', 'write']) {
        const result = run(command, r);
        assert.equal(result.status, 1); assert.match(result.stderr, new RegExp(field));
        assert.ok(result.stderr.includes('must not contain writer.thread_or_session'));
      }
      assert.deepEqual(readdirSync(home), []);
    }));
  }
}
for (const writer of ['different', 'Test']) {
  test(`I2c: accepts seat IDs with writer ${writer}`, () => isolated(run => {
    const r = receipt(); r.writer.thread_or_session = writer;
    r.activation.reconnected_seats = ['test'];
    r.activation.seat_scan = { method: 'list_agents', checked_at: '2026-10-27T09:02:00Z', active_seats: ['test'] };
    for (const command of ['validate', 'write']) assert.equal(output(run(command, r)).verdict, 'LIVE');
  }));
}
test('I2c: MCP malformed seat scan is rejected by validate and write', () => isolated(run => {
  const r = receipt(); r.product = 'brainlayer'; r.activation.seat_scan = { active_seats: 'test' };
  for (const command of ['validate', 'write']) {
    const result = run(command, r); assert.equal(result.status, 1); assert.match(result.stderr, /seat_scan/);
  }
}));
test('I2: non-MCP products keep version self-report activation proof', () => isolated(run => {
  assert.equal(output(run('validate', receipt())).verdict, 'LIVE');
  assert.equal(output(run('write', receipt())).verdict, 'LIVE');
}));
test('I2: reconnected seats must be an array of non-empty strings', () => isolated(run => {
  for (const seats of ['fixture-seat', [''], [123]]) {
    const r = receipt(); r.activation.reconnected_seats = seats;
    for (const command of ['validate', 'write']) assert.notEqual(run(command, r).status, 0);
  }
}));

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
    r => { r.install_source.owner_status.pin_sha = sha.toUpperCase(); },
    r => { r.prior = { embedded_commit: sha.toUpperCase() }; },
    r => { r.target.tap = { commit: sha.toUpperCase(), file: 'formula', url: 'fixture', sha256: digest }; },
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

const released = 'd'.repeat(40);
test('A2: tag on a bump commit containing the merge is LIVE', () => isolated(run => {
  const r = receipt(); r.target.released_sha = released; r.target.ancestry.status = 'ahead';
  r.installed.embedded_commit = r.install_source.pin_sha = r.activation.self_report.commit = released;
  r.install_source.owner_status.pin_sha = released;
  assert.equal(output(run('validate', r)).verdict, 'LIVE');
  assert.equal(output(run('write', r)).verdict, 'LIVE');
}));
for (const status of ['behind', 'diverged']) {
  test(`A2: ancestry ${status} is MISMATCH even with matching bytes`, () => isolated(run => {
    const r = receipt(); r.target.ancestry.status = status;
    assert.notEqual(run('validate', r).status, 0);
    assert.equal(output(run('write', r)).verdict, 'MISMATCH');
    r.verdict = 'MISMATCH'; assert.equal(output(run('validate', r)).verdict, 'MISMATCH');
    r.verdict = 'FAILED'; assert.equal(output(run('write', r)).verdict, 'FAILED');
  }));
}
test('A2: released SHA and complete ancestry evidence are required', () => isolated(run => {
  for (const mutate of [r => { delete r.target.released_sha; },
    r => { r.target.released_sha = 'abc'; }, r => { r.target.released_sha = 'g'.repeat(40); },
    r => { delete r.target.ancestry; }, r => { delete r.target.ancestry.checked_at; },
    r => { r.target.ancestry.method = 'guess'; }, r => { r.target.ancestry.status = 'unknown'; }]) {
    const r = receipt(); mutate(r);
    assert.notEqual(run('validate', r).status, 0); assert.notEqual(run('write', r).status, 0);
  }
}));
test('A2: uppercase released SHA is rejected consistently', () => isolated(run => {
  const r = receipt(); r.target.released_sha = sha.toUpperCase();
  assert.notEqual(run('validate', r).status, 0);
  assert.notEqual(run('write', r).status, 0);
}));
for (const field of ['embedded', 'pin', 'owner', 'runtime']) {
  test(`A2: ${field} matching only merge SHA is MISMATCH`, () => isolated(run => {
    const r = receipt(); r.target.released_sha = released; r.target.ancestry.status = 'ahead';
    r.installed.embedded_commit = r.install_source.pin_sha = r.activation.self_report.commit = released;
    r.install_source.owner_status.pin_sha = released;
    if (field === 'embedded') r.installed.embedded_commit = sha;
    if (field === 'pin') r.install_source.pin_sha = sha;
    if (field === 'owner') r.install_source.owner_status.pin_sha = sha;
    if (field === 'runtime') r.activation.self_report.commit = sha;
    assert.equal(output(run('write', r)).verdict, 'MISMATCH');
  }));
}
test('A2: git-merge-base ancestry and commitless asset proof remain supported', () => isolated(run => {
  const r = receipt(); r.target.ancestry.method = 'git-merge-base';
  delete r.installed.embedded_commit; r.installed.content_sha256 = digest;
  r.target.release_asset = { name: 'bundle', sha256: digest };
  assert.equal(output(run('write', r)).verdict, 'LIVE');
  r.target.ancestry.status = 'behind'; assert.equal(output(run('write', r)).verdict, 'MISMATCH');
}));

for (const status of ['identical', 'ahead']) {
  test(`A2 review: self-contradicting ${status} ancestry is MISMATCH`, () => isolated(run => {
    const r = receipt(); r.target.ancestry.status = status;
    if (status === 'identical') r.target.merge_sha = released;
    assert.notEqual(run('validate', r).status, 0);
    assert.equal(output(run('write', r)).verdict, 'MISMATCH');
  }));
}
test('A2 review: worktree pins require an owner pin', () => isolated(run => {
  const r = receipt(); delete r.install_source.owner_status.pin_sha;
  for (const command of ['validate', 'write']) assert.notEqual(run(command, r).status, 0);
}));

test('writer canonicalizes legacy aliases and refuses unknown machines', () => isolated((run) => {
  for (const [legacy, canonical] of [['mbp', 'm4-max'], ['m1', 'm1-pro']]) {
    const r = receipt(); r.host.alias = legacy;
    assert.equal(output(run('write', r)).host.alias, canonical);
  }
  const r = receipt(); r.host.alias = 'unknown-machine';
  assert.notEqual(run('write', r).status, 0);
}));
