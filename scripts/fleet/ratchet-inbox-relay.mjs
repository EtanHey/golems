#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync, renameSync, mkdirSync, openSync, closeSync, unlinkSync, statSync, fstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { guardedPrefixes, manifestsAt } from '../ratchet/guarded-set.mjs';
import { parseRows, expectedReporting } from '../ratchet/table.mjs';
import { checkLiveFreshness } from '../ratchet/live-freshness.mjs';
const HOUR = 3600000;
const repo = 'EtanHey/golems';
const marker = '<!-- golems-ratchet-schedule -->';
const refresh = pr => `scripts/ratchet/post-merge-live.sh --merged-pr ${pr} --lease-pr <open PR>`;

export function planRelay({ incident, rows, mergedPR, guardedHead, receiptFresh = false, reasons = {}, now = Date.now(), state = {}, owner }) {
  const next = structuredClone(state); next.warned ??= []; next.pending ??= [];
  const posts = [];
  const stamp = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' }).format(now);
  const queued = [];
  const post = (text, target = 'owner') => {
    const name = target === 'escalate' ? 'orc' : (owner?.name ?? 'orc');
    const body = `\n### golems-ratchet → @${name} — ${stamp} IST ${text}\n`;
    posts.push(body); queued.push(owner ? { target, text: body } : body);
  };
  if (incident) {
    const [head, ids] = JSON.parse(incident.causeKey);
    if (!/^[a-f0-9]{40}$/.test(head) || !Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_.:-]+$/.test(id))) throw Error('invalid cause');
    const names = ids.join(', ');
    if (incident.active) {
      const changed = !next.active || next.causeKey !== incident.causeKey;
      if (changed) delete next.lastEscalation;
      if (changed || now - next.lastPost >= 24 * HOUR) {
        const since = changed ? new Date(now).toISOString() : next.first;
        post(`${changed ? 'RED:' : `STILL RED since ${since}:`} ${ids.map(id => `${id}: ${reasons[id] ? 'scheduled row FAIL (see run)' : incident.firstRunUrl}`).join('; ')}\nRefresh: ${refresh(mergedPR)}; run: ${incident.firstRunUrl}`);
        next.lastPost = now; next.first = since;
      }
      if (owner && now - Date.parse(next.first) > 24 * HOUR
        && (next.lastEscalation === undefined || now - next.lastEscalation >= 24 * HOUR)) {
        post(`RED for ${Math.floor((now - Date.parse(next.first)) / HOUR)} h: ${names}\nRefresh: ${refresh(mergedPR)}; run: ${incident.firstRunUrl}`, 'escalate');
        next.lastEscalation = now; next.escalated = true;
      }
    } else if (next.active) {
      post(`GREEN: ${names} cleared\nRun: ${incident.firstRunUrl}`);
      if (owner && next.escalated) post(`GREEN: ${names} cleared\nRun: ${incident.firstRunUrl}`, 'escalate');
      next.escalated = false; delete next.lastEscalation;
    }
    next.active = incident.active; next.causeKey = incident.causeKey;
  }
  for (const row of rows) {
    if (!row.report_only_until) continue;
    const deadline = Date.parse(row.report_only_until);
    if (!Number.isFinite(deadline)) throw Error(`invalid expiry: ${row.id}`);
    const key = JSON.stringify([row.id, row.report_only_until, guardedHead]);
    if (deadline - now <= 48 * HOUR && !(deadline <= now && receiptFresh) && !next.warned.includes(key)) {
      post(`WARN: ${row.id} stops being report-only at ${row.report_only_until}; refresh the live receipt for guarded merge #${mergedPR} (${guardedHead.slice(0, 8)}) with: ${refresh(mergedPR)}`);
      next.warned.push(key);
    }
  }
  next.pending.push(...queued);
  return { posts, state: next };
}

// Persist before delivery. Ambiguous SSH failures can duplicate an append, never lose it.
export function deliverPending(state, ssh, outbox, save) {
  if (!state.pending.length) return;
  try { ssh(state.pending.join('')); }
  catch { outbox(state.pending.join('')); save(state); return; }
  state.pending = []; save(state);
}
function run(binary, args, input) {
  const result = spawnSync(binary, args, { input, encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw Error(`${binary} ${args[0]} failed`); // never echo ambient auth or stderr
  return result.stdout.trim();
}
export function collect({ gh = args => run('gh', args), git = args => run('git', args), now = Date.now() } = {}) {
  const api = path => JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repo}/${path}`])).flat();
  const issues = api('issues?state=all&labels=ratchet-red&per_page=100').filter(i => !i.pull_request && i.user?.login === 'github-actions[bot]' && i.body?.split('\n')[0] === marker);
  if (issues.length !== 1) throw Error('expected exactly one scheduled incident');
  const incident = JSON.parse(issues[0].body.split('\n')[1]);
  if (incident.schema !== 1 || typeof incident.active !== 'boolean' || !/^https:\/\/github.com\/EtanHey\/golems\/actions\/runs\/\d+$/.test(incident.firstRunUrl)) throw Error('invalid incident');
  const guardedHead = git(['log', '--first-parent', '-1', '--format=%H', 'origin/master', '--', ...guardedPrefixes(manifestsAt(['origin/master']))]);
  const rows = parseRows(JSON.parse(git(['show', 'origin/master:scripts/ratchet/rows.json'])), { base: true });
  const pulls = api(`commits/${guardedHead}/pulls`);
  const pr = pulls.find(p => p.merged_at && p.base?.ref === 'master' && p.merge_commit_sha === guardedHead);
  if (!pr) throw Error('guarded merge PR not found');
  const comments = api(`issues/${pr.number}/comments`);
  const receiptFresh = checkLiveFreshness({ guardedHead, pulls, comments, now,
    allowedHeads: git(['rev-list', '--first-parent', 'origin/master', `^${guardedHead}^`]).split('\n'),
    expectedReal: rows.rows.filter(r => r.runner === 'live' && r.kind === 'real').length,
    expectedReportOnly: expectedReporting(rows, 'live', now) }).ok;
  const reasons = {};
  if (incident.active) {
    try {
      const log = gh(['run', 'view', incident.firstRunUrl.split('/').at(-1), '--repo', repo, '--log']);
      for (const id of JSON.parse(incident.causeKey)[1]) {
        const lines = log.split('\n');
        const line = (id === 'live-tier-freshness' && lines.find(line => /live-tier freshness.*(?:FAIL|invalid|stale)/.test(line)))
          || lines.find(line => line.includes(id) && /FAIL|MISSING/.test(line));
        if (line) reasons[id] = line.slice(-1500);
      }
    } catch { /* run URL remains an explicit fallback */ }
  }
  return { incident, rows: rows.rows, guardedHead, mergedPR: pr.number, receiptFresh, reasons, now };
}
const validPath = p => typeof p === 'string' && p.startsWith('/') && !/[\x00-\x1f\x7f]/.test(p);
const validHost = host => typeof host === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$/.test(host);
const validRoute = route => route && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(route.name ?? '') && validPath(route.inbox) && validHost(route.host);
export function readConfig(path = `${homedir()}/.config/golems/ratchet-relay.json`) {
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (!value || !validPath(value.localOutbox) || (value.owner
    ? !validRoute(value.owner) || !validRoute(value.escalate) || value.escalate.name !== 'orc'
    : !validHost(value.sshHost) || !validPath(value.remoteInbox))) throw Error('invalid config');
  return value;
}
const healthPost = (now, text, owner) => `\n### golems-ratchet → @${owner?.name ?? 'orc'} — ${new Date(now).toISOString()} ${text}\n`;
const pendingText = pending => pending.map(p => typeof p === 'string' ? p : p.text).join('');

export function executeRelay({ path, now = Date.now(), config = readConfig, fetch = () => run('git', ['fetch', 'origin', 'master']),
  collect: gather = collect, ssh, outbox, dry = false }) {
  mkdirSync(dirname(path), { recursive: true });
  let lock; let recovered = false; let state = {}; let stage = 'state read failed';
  const save = value => { writeFileSync(`${path}.new`, JSON.stringify(value), { mode: 0o600 }); renameSync(`${path}.new`, path); };
  try {
    if (!dry) {
      try { lock = openSync(`${path}.lock`, 'wx'); }
      catch (e) {
        if (e.code !== 'EEXIST') throw e;
        if (now - statSync(`${path}.lock`).mtimeMs <= 90 * 60000) return 0;
        unlinkSync(`${path}.lock`); lock = openSync(`${path}.lock`, 'wx'); recovered = true;
      }
    }
    try { state = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    state.pending ??= [];
    stage = 'config missing or invalid'; const settings = config();
    const queueHealth = text => {
      const body = healthPost(now, text, settings.owner);
      state.pending.push(settings.owner ? { target: 'owner', text: body } : body);
    };
    if (recovered) queueHealth('RELAY stale lock recovered (older than 90 minutes)');
    if (!settings.owner && !state.ownerUnconfiguredNoted) {
      queueHealth('RELAY owner is not configured; using legacy orc inbox'); state.ownerUnconfiguredNoted = true;
    }
    stage = 'git fetch failed'; fetch();
    stage = 'incident collection or planning failed'; state = planRelay({ ...gather(), now, state, owner: settings.owner }).state;
    if (state.failures?.count >= 3) queueHealth(`RELAY was failing for ${state.failures.count} runs since ${state.failures.since}: ${state.failures.reason}`);
    const text = pendingText(state.pending);
    if (dry) { console.log(text || 'No posts due.'); return 0; }
    stage = 'state write failed'; save(state);
    while (state.pending.length) {
      const item = state.pending[0];
      // Old queued strings retain their original legacy destination across config migration.
      const route = typeof item === 'string'
        ? { host: settings.sshHost ?? settings.escalate?.host, inbox: settings.remoteInbox ?? settings.escalate?.inbox }
        : settings[item.target];
      const target = typeof item === 'string' ? 'legacy' : item.target;
      let count = 1;
      while (count < state.pending.length && (typeof state.pending[count] === 'string' ? 'legacy' : state.pending[count].target) === target) count++;
      const body = pendingText(state.pending.slice(0, count));
      stage = 'SSH delivery failed';
      try {
        if (!route?.host || !route?.inbox) throw Error('missing delivery route');
        if (route.host === 'local') {
          mkdirSync(dirname(route.inbox), { recursive: true });
          appendFileSync(route.inbox, body, { mode: 0o600 });
        } else if (ssh) ssh(body, { ...settings, sshHost: route.host, remoteInbox: route.inbox });
        else run('ssh', ['-o', 'BatchMode=yes', route.host, `cat >> '${route.inbox.replaceAll("'", "'\\''")}'`], body);
      } catch {
        if (outbox) outbox(body, settings);
        else { mkdirSync(dirname(settings.localOutbox), { recursive: true }); appendFileSync(settings.localOutbox, body); }
        throw Error('delivery failed');
      }
      state.pending.splice(0, count); stage = 'state write failed'; save(state);
    }
    delete state.failures; state.pending = []; stage = 'state write failed'; save(state); return 0;
  } catch {
    if (!dry) {
      state.failures = { count: (state.failures?.count ?? 0) + 1, since: state.failures?.since ?? new Date(now).toISOString(), reason: stage };
      save(state);
    }
    console.error(`ratchet inbox relay: ${stage}; configure ~/.config/golems/ratchet-relay.json; pending state retained`);
    return 1;
  } finally {
    if (lock !== undefined) {
      const held = fstatSync(lock); closeSync(lock);
      // Do not remove a replacement lock after this run was considered stale.
      if (statSync(`${path}.lock`).ino === held.ino) unlinkSync(`${path}.lock`);
    }
  }
}
export function main(argv) {
  if (argv.some(a => a !== '--dry-run')) throw Error('usage: ratchet-inbox-relay.mjs [--dry-run]');
  return executeRelay({ path: `${homedir()}/.golems/ratchet/inbox-relay-state.json`, dry: argv.includes('--dry-run') });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); } catch { console.error('ratchet inbox relay failed; pending state retained; inspect source/state (no credentials logged)'); process.exitCode = 1; }
}
