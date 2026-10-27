#!/usr/bin/env node
// Read-only macOS client discovery. JSON goes to stdout; holder mapping notes to stderr.
// T3_MCP_STATE_DB can select a fixture or an alternate T3 state database.
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const BRIDGE = /^(?:\S*\b(?:python(?:\d+(?:\.\d+)*)?|Python)\s+)?\/opt\/homebrew\/(?:bin|(?:opt\/brainlayer|Cellar\/brainlayer\/(?!\.{1,2}\/)[^/\s]+)\/bin)\/brainlayer-mcp-stdio-bridge$/;
const SOCAT = /^(?:\/opt\/homebrew\/bin\/)?socat STDIO UNIX-CONNECT:\/tmp\/voicelayer-mcp\.sock$/;
const SOCAT_REASON = 'LIVE = daemon serves the new code; socat seats connected before a daemon restart got EOF and are dead for voicelayer until their session restarts (not visible to ps).';
const DAEMON = /(?:\bbrainlayer (?:watch|drain|daemon|ingest-t3)\b|\bbrainlayer\.(?:supervisor_guard|brainbar_hybrid_helper|brainbar_auto_activation)\b|\/brainlayer\/launchd\/hotlane_brainbar_daemon\.py\b)/;
function run(command, args, allowEmpty = false) {
  const r = spawnSync(command, args, { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, maxBuffer: 16 * 1024 * 1024, timeout: 10000 });
  if (r.error || (r.status !== 0 && !(allowEmpty && r.status === 1))) throw new Error(`${command} probe failed (${r.status ?? r.error?.code})`);
  return r.stdout.trim();
}
function processInfo(pid) {
  const line = run('ps', ['-o', 'ppid=,lstart=,command=', '-p', String(pid)]);
  const match = line.match(/^(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+\d\d:\d\d:\d\d\s+\d{4})\s+(.+)$/);
  if (!match) throw new Error(`unreadable ps record for ${pid}; rerun discovery`);
  const date = new Date(match[2]); // ps lstart is local time; Date applies the host time zone.
  if (!Number.isFinite(date.getTime())) throw new Error(`invalid ps start time for ${pid}`);
  return { parent: Number(match[1]), started_at: date.toISOString().replace('.000Z', 'Z'), command: match[3] };
}
function threadIndex() {
  try {
    // -readonly uses SQLite mode=ro, retaining WAL visibility without creating a database.
    const rows = JSON.parse(run('sqlite3', ['-readonly', '-json', process.env.T3_MCP_STATE_DB ?? join(homedir(), '.t3/userdata/statev2.sqlite'),
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
  const relay = ['voicelayer', 'voicebar'].includes(server), clients = [], excluded = [];
  const pattern = relay ? 'socat.*voicelayer-mcp.sock' : 'brainlayer';
  const raw = run('pgrep', ['-f', pattern], true);
  const pids = raw ? [...new Set(raw.split(/\s+/).map(Number))] : [];
  if (pids.some(pid => !Number.isInteger(pid) || pid < 1)) throw new Error('invalid pgrep output');
  const index = threadIndex();
  let daemonCount = 0, relayCount = 0;
  for (const pid of pids.sort((a,b) => a-b)) {
    const child = processInfo(pid);
    if (relay && SOCAT.test(child.command)) { relayCount++; continue; }
    if (!relay && DAEMON.test(child.command)) { daemonCount++; continue; }
    if (relay || !BRIDGE.test(child.command)) continue;
    const provider = processInfo(child.parent);
    const claude = /(?:^|\/)claude\s/.test(provider.command) && provider.command.includes('--output-format stream-json');
    const native = claude ? provider.command.match(/(?:^|\s)--(?:session-id|resume)(?:=|\s+)([0-9a-f-]{36})(?=\s|$)/i)?.[1] : undefined;
    const matches = native ? index.get(native.toLowerCase()) : undefined;
    const thread = matches?.size === 1 ? [...matches][0] : null;
    let cwd = null;
    try { cwd = run('lsof', ['-a', '-p', String(child.parent), '-d', 'cwd', '-Fn']).split('\n').find(s => s.startsWith('n'))?.slice(1) ?? null; } catch { /* cwd is corroboration only. */ }
    const reason = /(?:^|\/)codex\s.*\bapp-server\b/.test(provider.command) ? 'shared Codex app-server; child cannot be attributed per thread'
      : !native ? 'no Claude native session id' : matches?.size > 1 ? 'ambiguous native session join' : 'native session absent from T3 state';
    console.error(JSON.stringify({ holder: thread ?? `unmapped:${child.parent}:${native ?? 'unknown'}`, provider_pid: child.parent,
      provider_started_at: provider.started_at, native_session_id: native ?? null, cwd, ...(thread ? {} : { reason }) }));
    clients.push({ pid, started_at: child.started_at, command: child.command, thread_id: thread });
  }
  if (relay) excluded.push({ rule: 'socat-relay', reason: SOCAT_REASON, count: relayCount });
  if (daemonCount) excluded.push({ rule: 'daemon-process', reason: 'Product watch, drain, ingestion, daemon, hybrid helper and supervisor processes are not per-seat clients.', count: daemonCount });
  const scan = { checked_at: new Date().toISOString(), clients, excluded };
  if (!draftPath) { console.log(JSON.stringify(scan, null, 2)); return; }
  const draft = JSON.parse(readFileSync(draftPath === '-' ? 0 : draftPath, 'utf8'));
  if (draft.product !== server) throw new Error('receipt draft product must match server');
  const { staleClients, validate } = await import('./lib/install-receipt-core.mjs');
  draft.activation.seat_scan = { ...scan, method: 'client-processes',
    bridge_diff: draft.activation.seat_scan.bridge_diff };
  draft.activation.seat_scan.active_seats = staleClients(draft);
  validate(draft);
  console.log(JSON.stringify(draft, null, 2));
}
try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
