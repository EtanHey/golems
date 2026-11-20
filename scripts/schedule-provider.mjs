#!/usr/bin/env node
// AIDEV-NOTE: Pick a provider for a T3 schedule_task so the task never sits on a provider that is
// out of usage at fire time. Pure helpers plus a small CLI; /agent-routing § T3-native dispatch #11
// is the rule that calls it. Signals:
//   - TokenLayer usage.json, Claude hub accounts: accounts[].{status, disabled,
//     five_hour.{used_pct,resets_at}, weekly.{used_pct,resets_at}, projected_weekly_empty_at}, stale.
//   - TokenLayer usage.json `vendors.<driver>` (codex, cursor, antigravity, kiro):
//     {pct, window, resets_at, observed_at, source, stale, windows[].{id, window, pct, resets_at}}.
//     Shape from TokenLayer drafts #173/#174/#183. A missing `vendors` key, a missing or null
//     driver, `pct: null` or `stale: true` is UNKNOWN, never "has room".
//   - T3 orchestrator_capabilities: providers[].{providerInstanceId, canRunChildTask, constraints}.
//   - --out <provider[/model]>@<reset ISO>: manual override only, for an exhaustion the lead knows
//     that usage.json does not show yet.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const RANK = { ok: 0, unknown: 1, exhausted: 2, unavailable: 3 };

function ms(value, name) {
  const t = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(t)) throw new Error(`${name} must be an ISO time, got ${JSON.stringify(value)}`);
  return t;
}
const iso = t => new Date(t).toISOString();

/** Later of two block-until times; null means blocked with no known end. */
function latest(a, b) {
  if (a === undefined) return b;
  if (a === null || b === null) return null;
  return Math.max(a, b);
}

/** When this account can serve again (ms), -Infinity if it can now, null if unknown. */
function accountFreeAt(account, atMs) {
  if (account.disabled === true) return null;
  const windows = [account.five_hour, account.weekly].filter(w => w && typeof w === 'object');
  const resets = windows.map(w => (w.resets_at ? Date.parse(w.resets_at) : null));
  let blocked; // undefined = not blocked
  if (account.status === 'rejected') {
    // The hub does not say which window rejected it: wait for the last known reset.
    blocked = resets.some(r => r === null || !Number.isFinite(r)) || !resets.length ? null : Math.max(...resets);
  }
  windows.forEach((w, i) => {
    if (typeof w.used_pct === 'number' && w.used_pct >= 100) blocked = latest(blocked, Number.isFinite(resets[i]) ? resets[i] : null);
  });
  const empty = account.projected_weekly_empty_at ? Date.parse(account.projected_weekly_empty_at) : NaN;
  const weeklyReset = account.weekly?.resets_at ? Date.parse(account.weekly.resets_at) : null;
  if (Number.isFinite(empty) && empty <= atMs) blocked = latest(blocked, Number.isFinite(weeklyReset) ? weeklyReset : null);
  return blocked === undefined ? -Infinity : blocked;
}

/** usage.json `vendors` driver -> the T3 provider instance ids its account serves. */
export const VENDOR_INSTANCES = {
  codex: ['codex', 'codex-worker'],
  antigravity: ['antigravity'],
  cursor: ['cursor'],
  kiro: ['kiro'],
};

/** One `vendors.<driver>` reading -> {state, resets_at?, reason?}. Fire-time checks happen in assess. */
function vendorEntry(driver, v) {
  if (!v || typeof v !== 'object') return { state: 'unknown', reason: `usage.json has no vendors.${driver}` };
  if (v.stale !== false) return { state: 'unknown', reason: `vendors.${driver} is stale` };
  const windows = (Array.isArray(v.windows) ? v.windows : []).filter(w => w && typeof w.pct === 'number');
  if (!windows.length && typeof v.pct === 'number') windows.push({ pct: v.pct, resets_at: v.resets_at });
  if (!windows.length) return { state: 'unknown', reason: `vendors.${driver} has no usage numbers` };
  const full = windows.filter(w => w.pct >= 100);
  if (!full.length) return { state: 'ok' };
  // Blocked until every full window has reset; a full window with no reset time blocks with no known end.
  const resets = full.map(w => (w.resets_at ? Date.parse(w.resets_at) : NaN));
  return { state: 'exhausted', resets_at: resets.every(Number.isFinite) ? iso(Math.max(...resets)) : null };
}

/** usage.json `vendors` -> { <instance id>: entry } for every known driver; absent drivers are unknown. */
export function usageFromVendors(usage) {
  const vendors = usage && typeof usage.vendors === 'object' ? usage.vendors : null;
  const out = {};
  for (const [driver, instances] of Object.entries(VENDOR_INSTANCES)) {
    const entry = vendors ? vendorEntry(driver, vendors[driver]) : { state: 'unknown', reason: 'usage.json has no vendors block' };
    for (const id of instances) out[id] = entry;
  }
  return out;
}

/** Claude hub accounts -> { claudeAgent: {state, resets_at?} } as of fire time `at`. */
function claudeFromAccounts(usage, atMs, provider) {
  if (!usage || usage.stale !== false || !Array.isArray(usage.accounts) || !usage.accounts.length) {
    return { [provider]: { state: 'unknown', reason: 'usage.json accounts are stale or empty' } };
  }
  const free = usage.accounts.map(a => accountFreeAt(a, atMs));
  if (free.some(t => t !== null && t <= atMs)) return { [provider]: { state: 'ok' } };
  const known = free.filter(t => t !== null);
  return { [provider]: { state: 'exhausted', resets_at: known.length ? iso(Math.min(...known)) : null } };
}

/** TokenLayer usage.json -> usage map: Claude from accounts[], other providers from vendors. */
export function usageFromTokenlayer(usage, at, provider = 'claudeAgent') {
  const atMs = ms(at, 'at');
  return { ...usageFromVendors(usage), ...claudeFromAccounts(usage, atMs, provider) };
}

/** orchestrator_capabilities -> unavailable instances. It carries no usage numbers, so others get no entry. */
export function usageFromCapabilities(caps) {
  const out = {};
  for (const p of caps?.providers ?? []) {
    const constraints = Array.isArray(p.constraints) ? p.constraints : [];
    if (p.canRunChildTask === false || constraints.length) {
      out[p.providerInstanceId] = { state: 'unavailable', reason: constraints.join(' ') || 'cannot run child tasks' };
    }
  }
  return out;
}

/** Merge usage maps; the worst state for a key wins. */
export function mergeUsage(...maps) {
  const out = {};
  for (const map of maps) {
    for (const [key, entry] of Object.entries(map ?? {})) {
      const prev = out[key];
      if (!prev || RANK[entry.state] > RANK[prev.state]) out[key] = entry;
    }
  }
  return out;
}

/** Usable at `at`? Returns { usable, entry, verified }. A model-scoped key ("provider/model") counts too. */
function assess(usage, candidate, atMs) {
  const entries = [usage[candidate.provider], usage[`${candidate.provider}/${candidate.model}`]].filter(Boolean);
  if (!entries.length) return { usable: true, verified: false };
  const worst = entries.reduce((a, b) => (RANK[b.state] > RANK[a.state] ? b : a));
  if (worst.state === 'ok') return { usable: true, verified: true };
  if (worst.state === 'unknown') return { usable: true, verified: false, entry: worst };
  if (worst.state === 'exhausted' && worst.resets_at && ms(worst.resets_at, 'resets_at') <= atMs) {
    return { usable: true, verified: true, entry: worst };
  }
  return { usable: false, entry: worst };
}

/**
 * Pick the first candidate (in preference order) with known usage at fire time `at`, plus the next
 * usable one as the fallback the scheduled brief must name. Candidates with unknown usage come after
 * every known-usable one; picking one sets `unverified: true` and a `reason` the caller must show.
 * None usable -> { ok: false, refusal, retry_after }.
 */
export function pickScheduleProvider(usage, candidates, at) {
  const atMs = ms(at, 'at');
  if (!Array.isArray(candidates) || !candidates.length) throw new Error('candidates must be a non-empty list');
  for (const c of candidates) {
    if (!c || typeof c.provider !== 'string' || !c.provider) throw new Error('every candidate needs a provider');
  }
  const usable = [];
  const skipped = [];
  for (const c of candidates) {
    const a = assess(usage ?? {}, c, atMs);
    if (a.usable) usable.push({ c, verified: a.verified, why: a.entry?.state === 'unknown' ? a.entry.reason ?? 'usage unknown' : 'no usage signal' });
    else skipped.push({ ...c, state: a.entry.state, resets_at: a.entry.resets_at ?? null, reason: a.entry.reason });
  }
  if (!usable.length) {
    const resets = skipped.map(s => s.resets_at).filter(Boolean).map(r => ms(r, 'resets_at'));
    return {
      ok: false,
      refusal: `no candidate has usage at ${iso(atMs)}: schedule after retry_after, or add a provider that has usage`,
      retry_after: resets.length ? iso(Math.min(...resets)) : null,
      skipped,
    };
  }
  const ordered = [...usable.filter(u => u.verified), ...usable.filter(u => !u.verified)];
  const [first, second] = ordered;
  const result = { ok: true, pick: first.c, unverified: !first.verified, fallback: second ? second.c : null, skipped };
  if (!first.verified) result.reason = `unknown: ${first.why}; no candidate has known usage at ${iso(atMs)}`;
  return result;
}

function parseArgs(argv) {
  const opts = { candidates: [], out: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (['--at', '--usage', '--capabilities', '--out'].includes(arg)) {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      if (arg === '--out') opts.out.push(value);
      else opts[arg.slice(2)] = value;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown flag ${arg}`);
    } else {
      const [provider, ...model] = arg.split(':');
      opts.candidates.push({ provider, model: model.join(':') || undefined });
    }
  }
  if (!opts.at) throw new Error('--at <ISO fire time> is required');
  return opts;
}

function main(argv) {
  const opts = parseArgs(argv);
  const maps = [];
  if (opts.usage) maps.push(usageFromTokenlayer(JSON.parse(readFileSync(opts.usage, 'utf8')), opts.at));
  if (opts.capabilities) maps.push(usageFromCapabilities(JSON.parse(readFileSync(opts.capabilities, 'utf8'))));
  for (const spec of opts.out) {
    const at = spec.lastIndexOf('@');
    if (at <= 0) throw new Error(`--out wants <provider[/model]>@<reset ISO>, got ${spec}`);
    maps.push({ [spec.slice(0, at)]: { state: 'exhausted', resets_at: iso(ms(spec.slice(at + 1), '--out reset')) } });
  }
  const result = pickScheduleProvider(mergeUsage(...maps), opts.candidates, opts.at);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? 0 : 3;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`schedule-provider: ${err.message}\n`);
    process.exitCode = 2;
  }
}
