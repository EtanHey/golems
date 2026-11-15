import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planRelay, deliverPending } from './ratchet-inbox-relay.mjs';
const now = Date.parse('2026-11-12T00:00:00Z');
const incident = { active: true, causeKey: JSON.stringify(['a'.repeat(40), ['live-tier-freshness']]), firstRunUrl: 'https://github.com/EtanHey/golems/actions/runs/1' };
const input = { incident, now, rows: [], mergedPR: 1200, guardedHead: 'a'.repeat(40) };
test('red, hourly dedupe, daily reminder, changed cause and recovery', () => {
  const first = planRelay(input); assert.equal(first.posts.length, 1); assert.match(first.posts[0], /RED:/);
  assert.equal(planRelay({ ...input, state: first.state, now: now + 3600000 }).posts.length, 0);
  assert.match(planRelay({ ...input, state: first.state, now: now + 25 * 3600000 }).posts[0], /STILL RED since/);
  assert.equal(planRelay({ ...input, state: first.state, incident: { ...incident, causeKey: JSON.stringify(['b'.repeat(40), ['other']]) } }).posts.length, 1);
  const green = planRelay({ ...input, state: first.state, incident: { ...incident, active: false } });
  assert.match(green.posts[0], /GREEN:.*cleared/);
  assert.equal(planRelay({ ...input, state: green.state, incident: { ...incident, active: false } }).posts.length, 0);
});
test('48 hour warning boundary, dedupe and expired fresh receipt', () => {
  const row = hours => ({ id: 'parity', report_only_until: new Date(now + hours * 3600000).toISOString() });
  const first = planRelay({ ...input, rows: [row(47)] }); assert.match(first.posts[1], /WARN:/);
  assert.equal(planRelay({ ...input, rows: [row(47)], state: first.state }).posts.length, 0);
  assert.equal(planRelay({ ...input, rows: [row(49)] }).posts.length, 1);
  assert.equal(planRelay({ ...input, rows: [row(-1)], receiptFresh: true }).posts.length, 1);
  assert.equal(planRelay({ ...input, rows: [row(-1)] }).posts.length, 2);
});
test('failed ssh retains pending and appends OUTBOX; next run drains', () => {
  const state = { pending: ['hello'] }; const outbox = []; let delivered = '';
  deliverPending(state, () => { throw Error('offline'); }, text => outbox.push(text), () => {});
  assert.deepEqual(state.pending, ['hello']); assert.equal(outbox.length, 1);
  deliverPending(state, text => { delivered = text; }, () => {}, () => {});
  assert.match(delivered, /hello/); assert.deepEqual(state.pending, []);
});
test('injected gh reads marker incident and log without network', async () => {
  const { collect } = await import('./ratchet-inbox-relay.mjs');
  const calls = [];
  const head = 'a'.repeat(40);
  const data = collect({ now, git: args => args[0] === 'show'
    ? JSON.stringify({ schema: 1, rows: [{ id: 'live', bug_sha: head, fix_sha: head, kind: 'real', runner: 'live', direction: 'pass', ceiling: true, command: 'true', metric: 'test' }] }) : head,
    gh: args => {
      calls.push(args);
      if (args[0] === 'run') return 'live-tier freshness FAIL: stale receipt';
      const path = args.at(-1);
      if (path.includes('?state=all')) return JSON.stringify([[{ user: { login: 'github-actions[bot]' }, body: `<!-- golems-ratchet-schedule -->\n${JSON.stringify({ schema: 1, ...incident })}` }]]);
      if (path.endsWith('/pulls')) return JSON.stringify([[{ number: 1200, merged_at: '2026-11-01T00:00:00Z', merge_commit_sha: head, base: { ref: 'master' } }]]);
      return '[[]]';
    } });
  assert.equal(data.now, now); assert.equal(data.mergedPR, 1200);
  assert.match(data.reasons['live-tier-freshness'], /stale receipt/);
  assert.equal(calls.length, 4);
});

test('stale lock recovery, young lock skip, and consecutive failure recovery', async () => {
  const { executeRelay } = await import('./ratchet-inbox-relay.mjs');
  const { mkdtempSync, writeFileSync, utimesSync, readFileSync, existsSync, rmSync } = await import('node:fs');
  const root = mkdtempSync(join(tmpdir(), 'ratchet-relay-'));
  const path = `${root}/state.json`; const posts = [];
  const options = { path, now, collect: () => input, fetch: () => {}, config: () => ({ sshHost: 'relay.example', remoteInbox: '/srv/orc.md', localOutbox: '/srv/outbox.md' }),
    ssh: text => posts.push(text), outbox: () => {} };
  try {
    writeFileSync(`${path}.lock`, ''); utimesSync(`${path}.lock`, (now - 2 * 3600000) / 1000, (now - 2 * 3600000) / 1000);
    assert.equal(executeRelay(options), 0); assert.match(posts[1], /stale lock recovered/);
    writeFileSync(`${path}.lock`, ''); utimesSync(`${path}.lock`, (now - 600000) / 1000, (now - 600000) / 1000);
    assert.equal(executeRelay(options), 0); assert.equal(posts.length, 2);
    assert.equal(existsSync(`${path}.lock`), true); rmSync(`${path}.lock`);
    for (let i = 0; i < 3; i++) assert.equal(executeRelay({ ...options, collect: () => { throw Error('SECRET'); } }), 1);
    const state = JSON.parse(readFileSync(path)); assert.equal(state.failures.count, 3);
    assert.equal(JSON.stringify(state).includes('SECRET'), false);
    assert.equal(executeRelay(options), 0); assert.match(posts[2], /RELAY was failing for 3 runs since/);
    executeRelay(options); assert.equal(posts.length, 3);
  } finally { rmSync(root, { recursive: true }); }
});
test('missing config counts failures; SSH failures use OUTBOX and recover with exact count', async () => {
  const { executeRelay, readConfig } = await import('./ratchet-inbox-relay.mjs');
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
  const root = mkdtempSync(join(tmpdir(), 'ratchet-relay-')); const path = `${root}/state.json`;
  const posts = []; const outbox = [];
  const options = { path, now, collect: () => input, fetch: () => {}, config: () => readConfig(`${root}/absent`),
    ssh: text => posts.push(text), outbox: text => outbox.push(text) };
  try {
    assert.equal(executeRelay(options), 1); assert.equal(JSON.parse(readFileSync(path)).failures.reason, 'config missing or invalid');
    for (let i = 0; i < 3; i++) assert.equal(executeRelay({ ...options, config: () => ({ sshHost: 'relay.example', remoteInbox: '/srv/orc.md', localOutbox: '/srv/outbox.md' }), ssh: () => { throw Error('SECRET'); } }), 1);
    assert.equal(outbox.length, 3); assert.equal(JSON.stringify(outbox).includes('SECRET'), false);
    assert.equal(executeRelay({ ...options, config: () => ({ sshHost: 'relay.example', remoteInbox: '/srv/orc.md', localOutbox: '/srv/outbox.md' }) }), 0);
    assert.match(posts[1], /RELAY was failing for 4 runs since.*SSH delivery failed/);
    assert.equal((posts[1].match(/RELAY was failing for/g) ?? []).length, 1);
    assert.equal(JSON.parse(readFileSync(path)).failures, undefined);
  } finally { rmSync(root, { recursive: true }); }
});

const owner = { name: 'skillcreator-lead', inbox: '/srv/owner.md', host: 'local' };
test('owner transitions and overdue escalation are separate, daily, and recover together', () => {
  const first = planRelay({ ...input, owner });
  assert.match(first.posts[0], /→ @skillcreator-lead/);
  const boundary = planRelay({ ...input, owner, state: first.state, now: now + 24 * 3600000 });
  assert.equal(boundary.posts.some(p => p.includes('→ @orc')), false);
  const escalated = planRelay({ ...input, owner, state: boundary.state, now: now + 25 * 3600000 });
  assert.match(escalated.posts.at(-1), /→ @orc.*RED for 25 h/);
  assert.equal(planRelay({ ...input, owner, state: escalated.state, now: now + 26 * 3600000 }).posts.length, 0);
  assert.match(planRelay({ ...input, owner, state: escalated.state, now: now + 49 * 3600000 }).posts.at(-1), /→ @orc/);
  const green = planRelay({ ...input, owner, state: escalated.state, incident: { ...incident, active: false } });
  assert.equal(green.posts.length, 2);
  assert.match(green.posts[0], /→ @skillcreator-lead.*GREEN/);
  assert.match(green.posts[1], /→ @orc.*GREEN/);
});
test('config accepts owner local and escalation remote, rejects unsafe routing', async () => {
  const { readConfig } = await import('./ratchet-inbox-relay.mjs');
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const root = mkdtempSync(join(tmpdir(), 'ratchet-config-'));
  try {
    const path = join(root, 'config.json');
    const config = { sshHost: 'relay.example', remoteInbox: '/srv/orc.md', owner, escalate: { name: 'orc', host: 'relay.example', inbox: '/srv/orc.md' }, localOutbox: '/srv/outbox.md' };
    writeFileSync(path, JSON.stringify(config)); assert.deepEqual(readConfig(path), config);
    writeFileSync(path, JSON.stringify({ ...config, owner: { ...owner, name: 'bad\nheading' } }));
    assert.throws(() => readConfig(path), /invalid config/);
  } finally { rmSync(root, { recursive: true }); }
});
test('local owner append and remote escalation use independent pending delivery', async () => {
  const { executeRelay } = await import('./ratchet-inbox-relay.mjs');
  const { mkdtempSync, readFileSync, rmSync, writeFileSync } = await import('node:fs');
  const root = mkdtempSync(join(tmpdir(), 'ratchet-owner-'));
  const path = join(root, 'state.json'); const inbox = join(root, 'inbox.md');
  const settings = { owner: { ...owner, inbox }, escalate: { name: 'orc', host: 'relay.example', inbox: '/srv/orc.md' }, localOutbox: join(root, 'outbox.md') };
  const options = { path, now, config: () => settings, collect: () => input, fetch: () => {}, ssh: () => {} };
  try {
    assert.equal(executeRelay(options), 0);
    assert.match(readFileSync(inbox, 'utf8'), /→ @skillcreator-lead.*RED/);
    const before = readFileSync(inbox, 'utf8');
    assert.equal(executeRelay({ ...options, now: now + 25 * 3600000, ssh: () => { throw Error('TOKEN_secret'); } }), 1);
    const after = readFileSync(inbox, 'utf8'); assert.ok(after.length > before.length);
    const pending = JSON.parse(readFileSync(path)).pending;
    assert.equal(pending.length, 1); assert.equal(pending[0].target, 'escalate');
    let remote = '';
    assert.equal(executeRelay({ ...options, now: now + 26 * 3600000, ssh: text => { remote += text; } }), 0);
    assert.equal(readFileSync(inbox, 'utf8'), after); assert.match(remote, /→ @orc.*RED for 25 h/);
    assert.equal(remote.includes('TOKEN_secret'), false);
    writeFileSync(path, JSON.stringify({ pending: ['legacy queued post'] }));
    assert.equal(executeRelay({ ...options, collect: () => ({ ...input, incident: null }), ssh: text => { remote += text; } }), 0);
    assert.match(remote, /legacy queued post/);
  } finally { rmSync(root, { recursive: true }); }
});
test('owner WARN and health never expose injected log secrets; legacy config is accepted', async () => {
  const planned = planRelay({ ...input, owner, reasons: { 'live-tier-freshness': 'TOKEN_secret bearer SECRET' },
    rows: [{ id: 'parity', report_only_until: new Date(now + 3600000).toISOString() }] });
  assert.ok(planned.posts.every(p => p.includes('→ @skillcreator-lead')));
  assert.match(planned.posts[1], /WARN:/);
  assert.doesNotMatch(planned.posts.join(''), /TOKEN_secret|SECRET|bearer/);
  const { executeRelay, readConfig } = await import('./ratchet-inbox-relay.mjs');
  const { mkdtempSync, readFileSync, writeFileSync, rmSync } = await import('node:fs');
  const root = mkdtempSync(join(tmpdir(), 'ratchet-health-')); const path = join(root, 'state.json');
  const legacy = { sshHost: 'relay.example', remoteInbox: '/srv/orc.md', localOutbox: join(root, 'outbox.md') };
  try {
    const configPath = join(root, 'config.json'); writeFileSync(configPath, JSON.stringify(legacy));
    assert.deepEqual(readConfig(configPath), legacy);
    const settings = { owner: { ...owner, host: 'owner.example' }, escalate: { name: 'orc', host: 'relay.example', inbox: '/srv/orc.md' }, localOutbox: legacy.localOutbox };
    writeFileSync(path, JSON.stringify({ pending: [], failures: { count: 3, since: new Date(now).toISOString(), reason: 'git fetch failed' } }));
    const posts = [];
    assert.equal(executeRelay({ path, now, config: () => settings, fetch: () => {}, collect: () => input,
      ssh: (text, config) => posts.push({ text, config }) }), 0);
    assert.equal(posts.length, 2); assert.equal(posts[0].config.sshHost, 'relay.example');
    assert.match(posts[0].text, /ROUTING:/); assert.equal(posts[1].config.sshHost, 'owner.example');
    assert.match(posts[1].text, /→ @skillcreator-lead.*RELAY was failing/);
    assert.equal(JSON.parse(readFileSync(path)).pending.length, 0);
  } finally { rmSync(root, { recursive: true }); }
});
test('receipt expiry uses the real validator deadline, warns once per receipt, never invents TTL', async () => {
  const { liveReceiptExpiry } = await import('./ratchet-inbox-relay.mjs');
  const { PARITY_UNTIL } = await import('../ratchet/table.mjs');
  const deadline = Date.parse(PARITY_UNTIL); const before = deadline - 24 * 3600000;
  const head = 'a'.repeat(40);
  const receipt = report_only => ({ user: { login: 'EtanHey' }, body: `<!-- ratchet-table: golems-ratchet-live -->\n<!-- ratchet-verdict: ${JSON.stringify({ head, ok: true, real_pass: 1, real_total: 1, bootstrap: false, report_only })} -->` });
  const rows = { rows: [{ id: 'installed-skill-parity', kind: 'real', runner: 'live', report_only: 'until-i5-run2', report_only_until: PARITY_UNTIL }] };
  const options = { guardedHead: head, pulls: [{ number: 1200, merged_at: '2026-11-01T00:00:00Z', merge_commit_sha: head, base: { ref: 'master' } }],
    comments: [receipt([{ id: 'installed-skill-parity', until: PARITY_UNTIL }])], rows, now: before };
  const expiry = liveReceiptExpiry(options); assert.equal(Date.parse(expiry.at), deadline);
  const args = { ...input, incident: null, owner, now: before, receiptExpiry: expiry };
  const first = planRelay(args); assert.equal(first.posts.length, 1);
  assert.match(first.posts[0], /→ @skillcreator-lead.*WARN: live receipt for #1200 goes stale at/);
  assert.equal(planRelay({ ...args, state: first.state }).posts.length, 0);
  assert.equal(planRelay({ ...args, now: before - 1 }).posts.length, 0);
  assert.equal(planRelay({ ...args, now: deadline }).posts.length, 0);
  assert.equal(liveReceiptExpiry({ ...options, now: deadline }), undefined);
  assert.equal(liveReceiptExpiry({ ...options, comments: [receipt([])], rows: { rows: [{ kind: 'real', runner: 'live' }] } }), undefined);
});

test('legacy ssh host named local remains SSH rather than a local append', async () => {
  const { executeRelay } = await import('./ratchet-inbox-relay.mjs');
  const { mkdtempSync, existsSync, rmSync } = await import('node:fs');
  const root = mkdtempSync(join(tmpdir(), 'ratchet-legacy-local-')); const inbox = join(root, 'inbox.md');
  let delivered = '';
  try {
    assert.equal(executeRelay({ path: join(root, 'state.json'), now, fetch: () => {}, collect: () => input,
      config: () => ({ sshHost: 'local', remoteInbox: inbox, localOutbox: join(root, 'outbox.md') }),
      ssh: text => { delivered += text; } }), 0);
    assert.match(delivered, /owner is not configured/);
    assert.match(delivered, /→ @orc.*RED/);
    assert.equal(existsSync(inbox), false);
  } finally { rmSync(root, { recursive: true }); }
});

test('config prefers its own path, falls back only when absent, and requires orc escalation', async () => {
  const { readConfig } = await import('./ratchet-inbox-relay.mjs');
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const root = mkdtempSync(join(tmpdir(), 'relay-config-path-'));
  const fresh = join(root, '.golems/ratchet/relay.json'); const old = join(root, '.config/golems/ratchet-relay.json');
  const config = { sshHost: 'relay.example', remoteInbox: '/srv/orc.md', localOutbox: '/srv/outbox.md', owner,
    escalate: { name: 'orc', host: 'relay.example', inbox: '/srv/orc.md' } };
  try {
    mkdirSync(join(root, '.config/golems'), { recursive: true }); mkdirSync(join(root, '.golems/ratchet'), { recursive: true });
    writeFileSync(old, JSON.stringify(config));
    assert.equal(readConfig(undefined, root).configPath, old);
    writeFileSync(fresh, JSON.stringify({ ...config, owner: { ...owner, name: 'new-owner' } }));
    assert.equal(readConfig(undefined, root).owner.name, 'new-owner');
    assert.equal(readConfig(undefined, root).configPath, fresh);
    writeFileSync(fresh, '{'); assert.throws(() => readConfig(undefined, root));
    writeFileSync(fresh, JSON.stringify({ ...config, escalate: undefined })); assert.throws(() => readConfig(undefined, root), /invalid config/);
    writeFileSync(fresh, JSON.stringify({ ...config, owner: undefined, escalate: { ...config.escalate, name: 'other' } }));
    assert.throws(() => readConfig(undefined, root), /invalid config/);
  } finally { rmSync(root, { recursive: true }); }
});

test('routing notices precede all posts, dedupe, retry only undelivered routes, and pin prior targets', async () => {
  const { executeRelay } = await import('./ratchet-inbox-relay.mjs');
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
  const root = mkdtempSync(join(tmpdir(), 'relay-routing-')); const path = join(root, 'state.json');
  let settings = { owner: { ...owner, host: 'owner.example' }, escalate: { name: 'orc', host: 'old.example', inbox: '/srv/old.md' },
    sshHost: 'legacy.example', remoteInbox: '/srv/legacy.md', localOutbox: join(root, 'outbox.md'), configPath: '/routing/relay.json', secret: 'TOKEN_secret' };
  const calls = []; let failHost;
  const options = { path, now, config: () => settings, fetch: () => {}, collect: () => input, outbox: () => {},
    ssh: (text, cfg) => { if (cfg.sshHost === failHost) throw Error('TOKEN_secret'); calls.push({ text, host: cfg.sshHost }); } };
  const state = () => JSON.parse(readFileSync(path));
  try {
    assert.equal(executeRelay(options), 0);
    assert.match(calls[0].text, /→ @orc.*ROUTING: warnings now go to @skillcreator-lead/);
    assert.equal(calls[0].host, 'old.example'); assert.match(calls[1].text, /RED:/);
    assert.doesNotMatch(JSON.stringify(calls), /TOKEN_secret/);
    const initial = state().routing.fingerprint;
    calls.length = 0; assert.equal(executeRelay(options), 0); assert.equal(calls.length, 0);
    settings = { ...settings, owner: { ...settings.owner, name: 'new-owner' }, escalate: { name: 'orc', host: 'new.example', inbox: '/srv/new.md' } };
    failHost = 'new.example'; assert.equal(executeRelay(options), 1);
    assert.equal(state().routing.fingerprint, initial); assert.equal(calls.length, 1); assert.equal(calls[0].host, 'old.example');
    const beforeDry = readFileSync(path, 'utf8'); const printed = []; const log = console.log;
    try {
      console.log = text => printed.push(text);
      assert.equal(executeRelay({ ...options, dry: true }), 0);
      assert.equal((printed.join('').match(/ROUTING:/g) ?? []).length, 1);
      assert.equal(readFileSync(path, 'utf8'), beforeDry); assert.equal(calls.length, 1);
    } finally { console.log = log; }
    failHost = undefined; assert.equal(executeRelay(options), 0);
    assert.equal(calls.length, 2); assert.equal(calls[1].host, 'new.example'); assert.notEqual(state().routing.fingerprint, initial);
    calls.length = 0; settings = { ...settings, configPath: '/routing/other.json' };
    assert.equal(executeRelay(options), 0); assert.equal(calls.length, 1); assert.match(calls[0].text, /config \/routing\/other.json/);
    calls.length = 0; settings = { ...settings, owner: { ...settings.owner, inbox: '/srv/new-owner.md' } };
    failHost = 'new.example'; assert.equal(executeRelay(options), 1); assert.equal(calls.length, 0);
    settings = { ...settings, escalate: { name: 'orc', host: 'third.example', inbox: '/srv/third.md' } };
    failHost = undefined; assert.equal(executeRelay(options), 0);
    assert.deepEqual(calls.map(c => c.host), ['new.example', 'new.example', 'third.example']);
  } finally { rmSync(root, { recursive: true }); }
});

test('routing announcement appends locally and dry run leaves state and inbox unchanged', async () => {
  const { executeRelay } = await import('./ratchet-inbox-relay.mjs');
  const { mkdtempSync, readFileSync, existsSync, rmSync } = await import('node:fs');
  const root = mkdtempSync(join(tmpdir(), 'relay-local-routing-')); const path = join(root, 'state.json');
  const inbox = join(root, 'orc.md'); const settings = { owner, sshHost: 'legacy.example', remoteInbox: '/srv/legacy.md',
    escalate: { name: 'orc', host: 'local', inbox }, localOutbox: join(root, 'outbox.md') };
  const options = { path, now, config: () => settings, fetch: () => {}, collect: () => ({ ...input, incident: null }) };
  const original = console.log; const printed = [];
  try {
    console.log = text => printed.push(text);
    assert.equal(executeRelay({ ...options, dry: true }), 0);
    assert.match(printed[0], /ROUTING:/); assert.equal(existsSync(inbox), false); assert.equal(existsSync(path), false);
    assert.equal(executeRelay(options), 0);
    assert.equal((readFileSync(inbox, 'utf8').match(/ROUTING:/g) ?? []).length, 1);
    const before = readFileSync(path, 'utf8');
    settings.owner = { ...owner, name: 'new-owner' };
    assert.equal(executeRelay({ ...options, dry: true }), 0);
    assert.equal(readFileSync(path, 'utf8'), before);
    assert.equal((readFileSync(inbox, 'utf8').match(/ROUTING:/g) ?? []).length, 1);
  } finally { console.log = original; rmSync(root, { recursive: true }); }
});

test('real CLI uses the selected config and persists notices before an unchanged rerun', async () => {
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const root = mkdtempSync(join(tmpdir(), 'relay-cli-')); const bin = join(root, 'bin');
  const oldInbox = join(root, 'old-orc.md'); const newInbox = join(root, 'new-orc.md');
  const config = { owner: { ...owner, inbox: join(root, 'owner.md') }, escalate: { name: 'orc', host: 'local', inbox: oldInbox },
    sshHost: 'unused.example', remoteInbox: '/srv/legacy.md', localOutbox: join(root, 'outbox.md') };
  try {
    mkdirSync(bin); mkdirSync(join(root, '.config/golems'), { recursive: true }); mkdirSync(join(root, '.golems/ratchet'), { recursive: true });
    writeFileSync(join(root, '.config/golems/ratchet-relay.json'), JSON.stringify(config));
    const head = 'a'.repeat(40);
    const rows = { schema: 1, rows: [{ id: 'live', bug_sha: head, fix_sha: head, kind: 'real', runner: 'live', direction: 'pass', ceiling: true, command: 'true', metric: 'test' }] };
    writeFileSync(join(bin, 'git'), `#!${process.execPath}\nconst a=process.argv.slice(2); if(a[0] !== 'fetch') console.log(a[0] === 'show' ? ${JSON.stringify(JSON.stringify(rows))} : ${JSON.stringify(head)});\n`, { mode: 0o700 });
    const issue = { user: { login: 'github-actions[bot]' }, body: `<!-- golems-ratchet-schedule -->\n${JSON.stringify({ schema: 1, ...incident, active: false })}` };
    const pull = { number: 1200, merged_at: '2026-11-01T00:00:00Z', merge_commit_sha: head, base: { ref: 'master' } };
    writeFileSync(join(bin, 'gh'), `#!${process.execPath}\nconst p=process.argv.at(-1); console.log(JSON.stringify([p.includes('?state=all') ? [${JSON.stringify(issue)}] : p.endsWith('/pulls') ? [${JSON.stringify(pull)}] : []]));\n`, { mode: 0o700 });
    const run = () => {
      const result = spawnSync(process.execPath, [new URL('./ratchet-inbox-relay.mjs', import.meta.url).pathname],
        { env: { ...process.env, HOME: root, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    };
    run(); assert.match(readFileSync(oldInbox, 'utf8'), /config .*\.config\/golems\/ratchet-relay.json/);
    writeFileSync(join(root, '.golems/ratchet/relay.json'), JSON.stringify({ ...config, escalate: { ...config.escalate, inbox: newInbox } }));
    run(); assert.equal((readFileSync(oldInbox, 'utf8').match(/ROUTING:/g) ?? []).length, 2);
    assert.equal((readFileSync(newInbox, 'utf8').match(/ROUTING:/g) ?? []).length, 1);
    run(); assert.equal((readFileSync(newInbox, 'utf8').match(/ROUTING:/g) ?? []).length, 1);
    const state = JSON.parse(readFileSync(join(root, '.golems/ratchet/inbox-relay-state.json')));
    assert.equal(state.routing.configPath, join(root, '.golems/ratchet/relay.json')); assert.equal(state.routingChange, undefined);
  } finally { rmSync(root, { recursive: true }); }
});

test('legacy SSH alias local and explicit local append are distinct notice destinations', async () => {
  const { executeRelay } = await import('./ratchet-inbox-relay.mjs');
  const { mkdtempSync, readFileSync, existsSync, rmSync } = await import('node:fs');
  const root = mkdtempSync(join(tmpdir(), 'relay-local-mode-')); const inbox = join(root, 'orc.md');
  let settings = { sshHost: 'local', remoteInbox: inbox, localOutbox: join(root, 'outbox.md') };
  const remote = [];
  const options = { path: join(root, 'state.json'), now, config: () => settings, fetch: () => {},
    collect: () => ({ ...input, incident: null }), ssh: text => remote.push(text) };
  try {
    assert.equal(executeRelay(options), 0); assert.equal(existsSync(inbox), false);
    remote.length = 0;
    settings = { ...settings, owner: { name: 'orc', host: 'local', inbox }, escalate: { name: 'orc', host: 'local', inbox } };
    assert.equal(executeRelay(options), 0);
    assert.equal(remote.length, 1); assert.match(remote[0], /ROUTING:/);
    assert.equal((readFileSync(inbox, 'utf8').match(/ROUTING:/g) ?? []).length, 1);
    assert.equal(executeRelay(options), 0); assert.equal(remote.length, 1);
  } finally { rmSync(root, { recursive: true }); }
});
