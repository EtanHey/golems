import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  pickScheduleProvider,
  usageFromCapabilities,
  usageFromTokenlayer,
  mergeUsage,
} from '../schedule-provider.mjs';

// AIDEV-NOTE: A scheduled task must not sit on a provider that is out of usage at fire time.
// Fixtures follow the SHAPE of TokenLayer's usage.json (src/usage/snapshot.ts + projection.ts)
// and of T3's orchestrator_capabilities; every value here is invented.
const root = new URL('../../', import.meta.url).pathname;
const NOW = '2026-11-19T10:00:00.000Z';
const FIRE = '2026-11-19T20:00:00.000Z';
const codex = { provider: 'codex-worker', model: 'gpt-6.1-sol' };
const opus = { provider: 'claudeAgent', model: 'claude-opus-5-5' };
const flash = { provider: 'antigravity', model: 'gemini-3.8-flash' };

function account(over = {}) {
  return {
    label: 'a1b2c3d4e5f60718', active: true, status: 'allowed', priority: 0, disabled: false,
    five_hour: { used_pct: 20, resets_at: '2026-11-19T12:00:00.000Z' },
    weekly: { used_pct: 40, resets_at: '2026-11-22T00:00:00.000Z' },
    burn_weekly_pct_per_hour: 0.5, projected_weekly_empty_at: null,
    ...over,
  };
}
const tokenlayer = accounts => ({ generated_at: NOW, source: 'cliproxy-hub', stale: false, accounts });

test('an exhausted provider is skipped; the next usable candidates become pick and fallback', () => {
  const usage = { 'codex-worker': { state: 'exhausted', resets_at: '2026-11-20T00:00:00.000Z' } };
  const r = pickScheduleProvider(usage, [codex, opus, flash], FIRE);
  assert.equal(r.ok, true);
  assert.deepEqual(r.pick, opus);
  assert.deepEqual(r.fallback, flash);
  assert.deepEqual(r.skipped.map(s => s.provider), ['codex-worker']);
});

test('a provider that resets before fire time is allowed', () => {
  const usage = { 'codex-worker': { state: 'exhausted', resets_at: '2026-11-19T18:00:00.000Z' } };
  const r = pickScheduleProvider(usage, [codex, opus], FIRE);
  assert.equal(r.ok, true);
  assert.deepEqual(r.pick, codex);
});

test('an exhausted provider with no known reset is never picked', () => {
  const r = pickScheduleProvider({ 'codex-worker': { state: 'exhausted', resets_at: null } }, [codex], FIRE);
  assert.equal(r.ok, false);
  assert.equal(r.retry_after, null);
});

test('none available is an explicit refusal naming the earliest reset, never a silent pick', () => {
  const usage = {
    'codex-worker': { state: 'exhausted', resets_at: '2026-11-20T02:00:00.000Z' },
    claudeAgent: { state: 'exhausted', resets_at: '2026-11-19T23:00:00.000Z' },
    antigravity: { state: 'unavailable', reason: 'Provider instance is disabled.' },
  };
  const r = pickScheduleProvider(usage, [codex, opus, flash], FIRE);
  assert.equal(r.ok, false);
  assert.equal(r.pick, undefined);
  assert.equal(r.retry_after, '2026-11-19T23:00:00.000Z');
  assert.match(r.refusal, /no candidate/);
  assert.equal(r.skipped.length, 3);
});

test('no fallback left is reported as null, so the brief must say so', () => {
  const r = pickScheduleProvider({ claudeAgent: { state: 'exhausted', resets_at: null } }, [codex, opus], FIRE);
  assert.deepEqual(r.pick, codex);
  assert.equal(r.fallback, null);
});

test('a provider with no usage signal is picked only as unverified', () => {
  const r = pickScheduleProvider({}, [codex], FIRE);
  assert.equal(r.ok, true);
  assert.equal(r.unverified, true);
  const known = pickScheduleProvider({ 'codex-worker': { state: 'ok' } }, [codex], FIRE);
  assert.equal(known.unverified, false);
});

test('a model-scoped exhaustion skips only that model on that provider', () => {
  const usage = { 'antigravity/claude-opus-5-5': { state: 'exhausted', resets_at: null } };
  const agOpus = { provider: 'antigravity', model: 'claude-opus-5-5' };
  assert.deepEqual(pickScheduleProvider(usage, [agOpus, flash], FIRE).pick, flash);
});

test('invalid input throws instead of guessing', () => {
  assert.throws(() => pickScheduleProvider({}, [], FIRE), /candidates/);
  assert.throws(() => pickScheduleProvider({}, [codex], 'tomorrow'), /at/);
  assert.throws(() => pickScheduleProvider({}, [{ model: 'x' }], FIRE), /provider/);
});

test('tokenlayer: one healthy account keeps claudeAgent ok', () => {
  const u = usageFromTokenlayer(tokenlayer([account({ status: 'rejected' }), account()]), FIRE);
  assert.equal(u.claudeAgent.state, 'ok');
});

test('tokenlayer: a full weekly window is exhausted until it resets', () => {
  const full = account({ weekly: { used_pct: 100, resets_at: '2026-11-22T00:00:00.000Z' } });
  assert.deepEqual(usageFromTokenlayer(tokenlayer([full]), FIRE).claudeAgent,
    { state: 'exhausted', resets_at: '2026-11-22T00:00:00.000Z' });
  assert.equal(usageFromTokenlayer(tokenlayer([full]), '2026-11-22T01:00:00.000Z').claudeAgent.state, 'ok');
});

test('tokenlayer: a window projected to empty before fire time counts as exhausted at fire time', () => {
  const burning = account({ projected_weekly_empty_at: '2026-11-19T15:00:00.000Z' });
  assert.deepEqual(usageFromTokenlayer(tokenlayer([burning]), FIRE).claudeAgent,
    { state: 'exhausted', resets_at: '2026-11-22T00:00:00.000Z' });
  assert.equal(usageFromTokenlayer(tokenlayer([burning]), '2026-11-19T14:00:00.000Z').claudeAgent.state, 'ok');
});

test('tokenlayer: rejected and disabled accounts give the earliest reset across accounts', () => {
  const rejected = account({ status: 'rejected', five_hour: { used_pct: 100, resets_at: '2026-11-19T21:00:00.000Z' } });
  const disabled = account({ disabled: true });
  assert.deepEqual(usageFromTokenlayer(tokenlayer([rejected, disabled]), FIRE).claudeAgent,
    { state: 'exhausted', resets_at: '2026-11-22T00:00:00.000Z' });
});

test('tokenlayer: stale or empty usage is unknown, never ok', () => {
  assert.equal(usageFromTokenlayer({ ...tokenlayer([account()]), stale: true }, FIRE).claudeAgent.state, 'unknown');
  assert.equal(usageFromTokenlayer(tokenlayer([]), FIRE).claudeAgent.state, 'unknown');
});

test('capabilities: a constrained or disabled instance is unavailable, others carry no claim', () => {
  const caps = { providers: [
    { providerInstanceId: 'codex-worker', canRunChildTask: true, constraints: [] },
    { providerInstanceId: 'kiro', canRunChildTask: false, constraints: ['Provider is not authenticated.'] },
  ] };
  assert.deepEqual(usageFromCapabilities(caps), { kiro: { state: 'unavailable', reason: 'Provider is not authenticated.' } });
});

test('merge keeps the worst state for a key', () => {
  const merged = mergeUsage({ claudeAgent: { state: 'ok' } }, { claudeAgent: { state: 'exhausted', resets_at: null } });
  assert.equal(merged.claudeAgent.state, 'exhausted');
});

test('CLI prints a pick or exits 3 with a refusal', () => {
  mkdirSync(join(root, 'docs.local/w255'), { recursive: true });
  const dir = mkdtempSync(join(root, 'docs.local/w255/cli-'));
  try {
    const usagePath = join(dir, 'usage.json');
    writeFileSync(usagePath, JSON.stringify(tokenlayer([account({ weekly: { used_pct: 100, resets_at: '2026-11-22T00:00:00.000Z' } })])));
    const cli = join(root, 'scripts/schedule-provider.mjs');
    const ok = spawnSync('node', [cli, '--at', FIRE, '--usage', usagePath, '--out', 'codex-worker@2026-11-20T02:00:00Z',
      'codex-worker:gpt-6.1-sol', 'claudeAgent:claude-opus-5-5', 'antigravity:gemini-3.8-flash'], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.deepEqual(JSON.parse(ok.stdout).pick, flash);
    const none = spawnSync('node', [cli, '--at', FIRE, '--usage', usagePath, '--out', 'codex-worker@2026-11-20T02:00:00Z',
      'codex-worker:gpt-6.1-sol', 'claudeAgent:claude-opus-5-5'], { encoding: 'utf8' });
    assert.equal(none.status, 3);
    assert.equal(JSON.parse(none.stdout).retry_after, '2026-11-20T02:00:00.000Z');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// AIDEV-NOTE: `vendors` shape follows TokenLayer drafts #173/#174/#183 (src/usage/vendors.ts); values invented.
function vendor(over = {}) {
  return {
    pct: 40, window: '7d', resets_at: '2026-11-22T00:00:00.000Z', observed_at: NOW,
    source: 't3-cache:codex', stale: false,
    windows: [
      { id: 'primary', window: '7d', pct: 40, resets_at: '2026-11-22T00:00:00.000Z' },
      { id: 'secondary', window: '5h', pct: 10, resets_at: '2026-11-19T13:00:00.000Z' },
    ],
    ...over,
  };
}
const fullCodex = resetsAt => vendor({ pct: 100, resets_at: resetsAt, windows: [
  { id: 'primary', window: '7d', pct: 100, resets_at: resetsAt },
  { id: 'secondary', window: '5h', pct: 10, resets_at: '2026-11-19T13:00:00.000Z' },
] });
const withVendors = vendors => ({ ...tokenlayer([account()]), vendors });
const pickFrom = (usage, candidates, at = FIRE) => pickScheduleProvider(usageFromTokenlayer(usage, at), candidates, at);

test('vendors: codex at 100 with a reset after fire time is skipped for both codex instances', () => {
  const usage = withVendors({ codex: fullCodex('2026-11-20T00:02:00.000Z'), antigravity: vendor({ source: 't3-cache:antigravity' }) });
  const r = pickFrom(usage, [codex, { provider: 'codex', model: 'gpt-6.1-sol' }, flash]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.pick, flash);
  assert.equal(r.unverified, false);
  assert.deepEqual(r.skipped.map(s => [s.provider, s.state, s.resets_at]), [
    ['codex-worker', 'exhausted', '2026-11-20T00:02:00.000Z'],
    ['codex', 'exhausted', '2026-11-20T00:02:00.000Z'],
  ]);
});

test('vendors: codex at 100 that resets before fire time is allowed and verified', () => {
  const r = pickFrom(withVendors({ codex: fullCodex('2026-11-19T18:00:00.000Z') }), [codex, opus]);
  assert.deepEqual(r.pick, codex);
  assert.equal(r.unverified, false);
});

test('vendors: a full secondary window blocks too, until its own reset', () => {
  const usage = withVendors({ codex: vendor({ windows: [
    { id: 'primary', window: '7d', pct: 30, resets_at: '2026-11-22T00:00:00.000Z' },
    { id: 'secondary', window: '5h', pct: 100, resets_at: '2026-11-19T21:00:00.000Z' },
  ] }) });
  assert.equal(pickFrom(usage, [codex]).ok, false);
  assert.deepEqual(pickFrom(usage, [codex], '2026-11-19T22:00:00.000Z').pick, codex);
});

test('vendors: stale is unknown, never usable ahead of a known provider', () => {
  const usage = withVendors({ codex: vendor({ stale: true }) });
  const r = pickFrom(usage, [codex, opus]);
  assert.deepEqual(r.pick, opus);
  assert.equal(r.unverified, false);
  assert.deepEqual(r.fallback, codex);
  const only = pickFrom(usage, [codex]);
  assert.equal(only.ok, true);
  assert.equal(only.unverified, true);
  assert.match(only.reason, /^unknown: vendors\.codex is stale/);
});

test('vendors: no vendors key is unknown, with an explicit reason the caller must show', () => {
  const u = usageFromTokenlayer(tokenlayer([account()]), FIRE);
  assert.equal(u['codex-worker'].state, 'unknown');
  assert.equal(u.antigravity.state, 'unknown');
  const r = pickFrom(tokenlayer([account()]), [codex, flash]);
  assert.equal(r.unverified, true);
  assert.match(r.reason, /^unknown: usage\.json has no vendors block/);
  assert.deepEqual(pickFrom(tokenlayer([account()]), [codex, opus]).pick, opus);
});

test('vendors: a missing or null driver is unknown', () => {
  const r = pickFrom(withVendors({ codex: vendor(), kiro: null }), [flash, codex]);
  assert.deepEqual(r.pick, codex);
  assert.deepEqual(r.fallback, flash);
  assert.equal(usageFromTokenlayer(withVendors({ kiro: null }), FIRE).kiro.state, 'unknown');
});

test('vendors: all exhausted is an explicit refusal with the earliest reset', () => {
  const full = account({ weekly: { used_pct: 100, resets_at: '2026-11-22T00:00:00.000Z' } });
  const usage = { ...tokenlayer([full]), vendors: {
    codex: fullCodex('2026-11-20T00:02:00.000Z'),
    antigravity: vendor({ pct: 100, windows: [{ id: 'flash', window: '7d', pct: 100, resets_at: '2026-11-21T00:00:00.000Z' }] }),
  } };
  const r = pickFrom(usage, [codex, opus, flash]);
  assert.equal(r.ok, false);
  assert.equal(r.pick, undefined);
  assert.equal(r.retry_after, '2026-11-20T00:02:00.000Z');
  assert.equal(r.skipped.length, 3);
});

// AIDEV-NOTE: schedule_task has no provider field; a scheduled run uses the CALLER's provider
// (t3code OrchestratorMcpService.ts `parent?.thread.modelSelection ?? projectDefaultModelSelection`).
// The schedule-time check therefore looks at the caller only. Namespace import so these tests fail,
// not the whole file, where checkScheduleCaller does not exist.
import * as sp from '../schedule-provider.mjs';

const claudeCaller = { provider: 'claudeAgent', model: 'claude-opus-5-5' };
const fullClaude = account({ five_hour: { used_pct: 100, resets_at: '2026-11-19T22:00:00.000Z' } });

test('schedule time: Claude caller exhausted at fire time, codex fine -> schedule after Claude resets', () => {
  const usage = { ...tokenlayer([fullClaude]), vendors: { codex: vendor() } };
  // The fire-time pick happily says codex; that is not the provider the scheduled run uses.
  assert.equal(pickFrom(usage, [codex]).ok, true);
  const r = sp.checkScheduleCaller(usage, claudeCaller, FIRE);
  assert.equal(r.decision, 'schedule-after-reset');
  assert.equal(r.run_at, '2026-11-19T22:00:00.000Z');
});

test('schedule time: Claude caller fine -> schedule now, whatever codex reads', () => {
  for (const codexReading of [fullCodex('2026-11-20T00:02:00.000Z'), vendor({ stale: true }), undefined]) {
    const usage = { ...tokenlayer([account()]), vendors: codexReading ? { codex: codexReading } : {} };
    assert.equal(sp.checkScheduleCaller(usage, claudeCaller, FIRE).decision, 'schedule-now');
  }
});

test('schedule time: unknown caller usage, or exhausted with no reset, is refused', () => {
  const stale = sp.checkScheduleCaller({ ...tokenlayer([account()]), stale: true }, claudeCaller, FIRE);
  assert.equal(stale.decision, 'refuse');
  assert.match(stale.reason, /^unknown: /);
  const dead = sp.checkScheduleCaller(tokenlayer([account({ disabled: true })]), claudeCaller, FIRE);
  assert.equal(dead.decision, 'refuse');
  assert.equal(dead.run_at, undefined);
});

test('schedule time: a reset that runs into a later projected empty waits for the weekly reset', () => {
  const burning = account({
    five_hour: { used_pct: 100, resets_at: '2026-11-19T22:00:00.000Z' },
    projected_weekly_empty_at: '2026-11-19T21:00:00.000Z',
  });
  const r = sp.checkScheduleCaller(tokenlayer([burning]), claudeCaller, FIRE);
  assert.equal(r.decision, 'schedule-after-reset');
  assert.equal(r.run_at, '2026-11-22T00:00:00.000Z');
});

test('schedule time CLI: --caller prints the decision; refuse exits 3', () => {
  mkdirSync(join(root, 'docs.local/w263'), { recursive: true });
  const dir = mkdtempSync(join(root, 'docs.local/w263/cli-'));
  try {
    const cli = join(root, 'scripts/schedule-provider.mjs');
    const usagePath = join(dir, 'usage.json');
    writeFileSync(usagePath, JSON.stringify({ ...tokenlayer([fullClaude]), vendors: { codex: vendor() } }));
    const later = spawnSync('node', [cli, '--at', FIRE, '--usage', usagePath, '--caller', 'claudeAgent:claude-opus-5-5'], { encoding: 'utf8' });
    assert.equal(later.status, 0, later.stderr);
    assert.equal(JSON.parse(later.stdout).decision, 'schedule-after-reset');
    writeFileSync(usagePath, JSON.stringify({ ...tokenlayer([account()]), stale: true }));
    const refused = spawnSync('node', [cli, '--at', FIRE, '--usage', usagePath, '--caller', 'claudeAgent'], { encoding: 'utf8' });
    assert.equal(refused.status, 3, refused.stderr);
    assert.equal(JSON.parse(refused.stdout).decision, 'refuse');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
