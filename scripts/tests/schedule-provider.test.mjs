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
