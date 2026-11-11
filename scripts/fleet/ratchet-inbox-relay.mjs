#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync, renameSync, mkdirSync, openSync, closeSync, unlinkSync } from 'node:fs';
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

export function planRelay({ incident, rows, mergedPR, guardedHead, receiptFresh = false, reasons = {}, now = Date.now(), state = {} }) {
  const next = structuredClone(state); next.warned ??= []; next.pending ??= [];
  const posts = [];
  const stamp = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' }).format(now);
  const post = text => posts.push(`\n### golems-ratchet → @orc — ${stamp} IST ${text}\n`);
  if (incident) {
    const [head, ids] = JSON.parse(incident.causeKey);
    if (!/^[a-f0-9]{40}$/.test(head) || !Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw Error('invalid cause');
    const names = ids.join(', ');
    if (incident.active) {
      const changed = !next.active || next.causeKey !== incident.causeKey;
      if (changed || now - next.lastPost >= 24 * HOUR) {
        const since = changed ? new Date(now).toISOString() : next.first;
        post(`${changed ? 'RED:' : `STILL RED since ${since}:`} ${ids.map(id => `${id}: ${reasons[id] || incident.firstRunUrl}`).join('; ')}\nRefresh: ${refresh(mergedPR)}; run: ${incident.firstRunUrl}`);
        next.lastPost = now; next.first = since;
      }
    } else if (next.active) post(`GREEN: ${names} cleared\nRun: ${incident.firstRunUrl}`);
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
  next.pending.push(...posts);
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
export function main(argv) {
  if (argv.some(a => a !== '--dry-run')) throw Error('usage: ratchet-inbox-relay.mjs [--dry-run]');
  const dry = argv.includes('--dry-run');
  const path = `${homedir()}/.golems/ratchet/inbox-relay-state.json`;
  if (!dry) mkdirSync(dirname(path), { recursive: true });
  let lock;
  try {
    if (!dry) lock = openSync(`${path}.lock`, 'wx');
    let state = {};
    try { state = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    run('git', ['fetch', 'origin', 'master']);
    const result = planRelay({ ...collect(), state });
    if (dry) { console.log(result.state.pending.join('') || 'No posts due.'); return; }
    const save = value => { writeFileSync(`${path}.new`, JSON.stringify(value), { mode: 0o600 }); renameSync(`${path}.new`, path); };
    save(result.state);
    deliverPending(result.state, text => run('ssh', ['-o', 'BatchMode=yes', 'macbook-pro', 'cat >> /Users/etanheyman/Gits/orchestrator/docs.local/collab/orc-inbox.md'], text),
      text => { const outbox = `${homedir()}/Gits/orchestrator/docs.local/collab/orc-inbox.OUTBOX.md`; mkdirSync(dirname(outbox), { recursive: true }); appendFileSync(outbox, text); }, save);
  } finally { if (lock !== undefined) { closeSync(lock); unlinkSync(`${path}.lock`); } }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch { console.error('ratchet inbox relay failed; pending state retained; inspect source/state (no credentials logged)'); process.exitCode = 1; }
}
