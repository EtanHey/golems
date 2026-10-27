#!/usr/bin/env node
// Read-only macOS client discovery. JSON goes to stdout; holder mapping notes to stderr.
// T3_MCP_STATE_DB can select a fixture or an alternate T3 state database.
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

import { CLIENT_RULES, SOCAT_REASON, staleClients, validate } from './lib/install-receipt-core.mjs';

const DAEMON = /(?:\bbrainlayer (?:watch|drain|daemon|ingest-t3)\b|\bbrainlayer\.(?:supervisor_guard|brainbar_hybrid_helper|brainbar_auto_activation)\b|\/brainlayer\/launchd\/hotlane_brainbar_daemon\.py\b)/;
function run(command, args) {
  const r = spawnSync(command, args, { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' }, maxBuffer: 16 * 1024 * 1024, timeout: 10000 });
  if (r.error || r.status !== 0) throw new Error(`${command} probe failed (${r.status ?? r.error?.code})`);
  return r.stdout.trim();
}
function processSnapshot() {
  const raw = run('ps', ['-axo', 'pid=,ppid=,lstart=,command=']);
  const checked_at = new Date().toISOString(), processes = new Map();
  for (const line of raw.split('\n').filter(Boolean)) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+\d\d:\d\d:\d\d\s+\d{4})\s+(.+)$/);
    if (!match) throw new Error('unreadable ps snapshot record');
    const date = new Date(match[3] + ' UTC');
    if (!Number.isFinite(date.getTime())) throw new Error('invalid ps snapshot start time');
    const pid = Number(match[1]);
    processes.set(pid, { pid, parent: Number(match[2]),
      started_at: date.toISOString().replace('.000Z', 'Z'), command: match[4] });
  }
  return { checked_at, processes };
}
function threadIndex() {
  try {
    // -readonly uses SQLite mode=ro, retaining WAL visibility without creating a database.
    const rows = JSON.parse(run('sqlite3', ['-init', '/dev/null', '-batch', '-readonly', '-json', process.env.T3_MCP_STATE_DB ?? join(homedir(), '.t3/userdata/statev2.sqlite'),
      "SELECT thread_id, json_extract(payload_json,'$.nativeThreadRef.nativeId') AS native_id FROM orchestration_v2_projection_provider_threads WHERE driver='claudeAgent' AND json_extract(payload_json,'$.nativeThreadRef.strength')='strong';"]) || '[]');
    const index = new Map();
    for (const row of rows) {
      if (!row.native_id || !row.thread_id) continue;
      const key = row.native_id.toLowerCase();
      if (!index.has(key)) index.set(key, new Set());
      index.get(key).add(row.thread_id);
    }
    return index;
  } catch {
    console.error('T3 state unavailable; all native session joins remain unmapped');
    return new Map();
  }
}
async function main() {
  const server = process.argv[2];
  const draftPath = process.argv[3] === '--receipt-draft' && process.argv.length === 5 ? process.argv[4] : null;
  if ((!draftPath && process.argv.length !== 3) || !['brainlayer', 'brainbar', 'voicelayer', 'voicebar'].includes(server)) {
    throw new Error('usage: t3-mcp-holders.mjs <brainlayer|brainbar|voicelayer|voicebar>; cmuxlayer refuses client-processes');
  }
  const rule = CLIENT_RULES.get(server), clients = [], excluded = [];
  const { checked_at, processes } = processSnapshot();
  const index = threadIndex();
  let daemonCount = 0, relayCount = 0;
  for (const child of [...processes.values()].sort((a,b) => a.pid-b.pid)) {
    const { pid, command } = child;
    if (rule.relay?.test(command)) { relayCount++; continue; }
    if (rule.relay) continue;
    const bridgeShaped = command.trim().split(/\s+/).slice(0, 2)
      .some(arg => arg.split('/').at(-1) === 'brainlayer-mcp-stdio-bridge');
    if (!rule.bridge.test(command) && !bridgeShaped) {
      if (DAEMON.test(command)) daemonCount++;
      continue;
    }
    const provider = processes.get(child.parent), providerCommand = provider?.command ?? '';
    const claude = /(?:^|\/)claude\s/.test(providerCommand) && providerCommand.includes('--output-format stream-json');
    const flags = [...providerCommand.matchAll(/(?:^|\s)--(?:session-id|resume)(?==|\s|$)/g)];
    const ambiguous = claude && (flags.length > 1 || /(?:^|\s)--fork-session(?==|\s|$)/.test(providerCommand));
    const native = claude && !ambiguous ? providerCommand.match(/(?:^|\s)--(?:session-id|resume)(?:=|\s+)([0-9a-f-]{36})(?=\s|$)/i)?.[1] : undefined;
    const matches = native ? index.get(native.toLowerCase()) : undefined;
    const thread = matches?.size === 1 ? [...matches][0] : null;
    let cwd = null;
    try { if (provider) cwd = run('lsof', ['-a', '-p', String(child.parent), '-d', 'cwd', '-Fn']).split('\n').find(s => s.startsWith('n'))?.slice(1) ?? null; } catch { /* cwd is corroboration only. */ }
    const reason = /(?:^|\/)codex\s.*\bapp-server\b/.test(providerCommand) ? 'shared Codex app-server; child cannot be attributed per thread'
      : !provider ? 'provider gone' : ambiguous ? 'ambiguous session flags' : !native ? 'no Claude native session id' : matches?.size > 1 ? 'ambiguous native session join' : 'native session absent from T3 state';
    console.error(JSON.stringify({ pid, holder: thread ?? `unmapped:${child.parent}:${native ?? 'unknown'}`, provider_pid: child.parent,
      provider_started_at: provider?.started_at ?? null, native_session_id: native ?? null, cwd, ...(thread ? {} : { reason }) }));
    clients.push({ pid, started_at: child.started_at, command: child.command, thread_id: thread });
  }
  if (rule.relay) excluded.push({ rule: 'socat-relay', reason: SOCAT_REASON, count: relayCount });
  if (daemonCount) excluded.push({ rule: 'daemon-process', reason: 'Product watch, drain, ingestion, daemon, hybrid helper and supervisor processes are not per-seat clients.', count: daemonCount });
  const scan = { checked_at, clients, excluded };
  if (!draftPath) { console.log(JSON.stringify(scan, null, 2)); return; }
  const draft = JSON.parse(readFileSync(draftPath === '-' ? 0 : draftPath, 'utf8'));
  if (draft.product !== server) throw new Error('receipt draft product must match server');
  if (!draft.activation?.seat_scan?.bridge_diff) {
    throw new Error('draft must carry activation.seat_scan.bridge_diff from a real compare probe');
  }
  draft.activation.seat_scan = { ...scan, method: 'client-processes',
    bridge_diff: draft.activation.seat_scan.bridge_diff };
  draft.activation.seat_scan.active_seats = staleClients(draft);
  validate(draft);
  console.log(JSON.stringify(draft, null, 2));
}
try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
