import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validate, bridgePaths } from '../lib/install-receipt-core.mjs';

const bridge = '/opt/homebrew/opt/brainlayer/bin/brainlayer-mcp-stdio-bridge';
const script = resolve('scripts/t3-mcp-holders.mjs');
const session = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const sqlite = spawnSync('which', ['sqlite3'], {encoding:'utf8'}).stdout.trim();
function scan(server, commands, { missingState = false, ambiguous = false, snapshotFailure = false,
  sessionFlag = '--resume=', extraSessionFlags = '', threadId = 'mcp:mapped', timeZone = 'UTC',
  receiptDraft, vanished = false, missingProvider = false, callerProvider = false,
  date = 'Tue Oct 27 16:00:00 2026' } = {}) {
  const dir = mkdtempSync(resolve('docs.local/c3-fixture-'));
  try {
    const bin = join(dir, 'bin'); mkdirSync(bin);
    const processes = commands.map((command, i) => ({ pid: 100 + i,
      parent: callerProvider ? process.pid : 200 + i, command }));
    const fixture = { processes, session, snapshotFailure, sessionFlag, extraSessionFlags,
      vanished, missingProvider, date, sqlite };
    writeFileSync(join(dir, 'fixture.json'), JSON.stringify(fixture));
    const fake = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const data = JSON.parse(fs.readFileSync(process.env.C3_FIXTURE));
const name = process.argv[1].split('/').pop(), args = process.argv.slice(2);
fs.appendFileSync(process.env.C3_CALLS, JSON.stringify({name,args,tz:process.env.TZ}) + '\n');
if (name === 'sqlite3') {
  if (!args.includes('-batch') || args[args.indexOf('-init')+1] !== '/dev/null') process.exit(2);
  const r = require('node:child_process').spawnSync(data.sqlite,args,{encoding:'utf8'});
  process.stdout.write(r.stdout); process.exit(r.status);
}
if (name === 'pgrep') { console.log([...data.processes.map(p=>p.pid), ...(data.vanished?[999]:[])].join('\n')); process.exit(data.processes.length ? 0 : 1); }
if (name === 'lsof') { console.log('p200\nfcwd\nn/work/project'); process.exit(0); }
const provider = pid => pid === 202 ? '/bin/codex app-server' : '/bin/claude --output-format stream-json ' + data.sessionFlag + data.session + ' ' + data.extraSessionFlags;
if (args[0] === '-axo') {
  if(data.snapshotFailure) process.exit(2);
  for(const p of data.processes) console.log(p.pid + ' ' + p.parent + ' ' + data.date + ' ' + p.command);
  if(!data.missingProvider) for(const pid of new Set(data.processes.map(p=>p.parent))) console.log(pid + ' 1 ' + data.date + ' ' + provider(pid));
} else {
  const pid = Number(args.at(-1));
  if(data.vanished || data.snapshotFailure) process.exit(1);
  const child = data.processes.find(p=>p.pid===pid);
  if(child) console.log(child.parent + ' ' + data.date + ' ' + child.command);
  else console.log('1 ' + data.date + ' ' + provider(pid));
}
`;
    for (const command of ['pgrep', 'ps', 'lsof', 'sqlite3']) writeFileSync(join(bin, command), fake, { mode: 0o755 });
    const db = join(dir, 'state.sqlite');
    if (!missingState) {
      const payload = JSON.stringify({ nativeThreadRef: { nativeId: session, strength: 'strong' } });
      const sql = `CREATE TABLE orchestration_v2_projection_provider_threads (thread_id TEXT, driver TEXT, payload_json TEXT);
INSERT INTO orchestration_v2_projection_provider_threads VALUES ('${threadId}','claudeAgent','${payload}');
${ambiguous ? `INSERT INTO orchestration_v2_projection_provider_threads VALUES ('mcp:other','claudeAgent','${payload}');` : ''}`;
      assert.equal(spawnSync(sqlite, ['-init','/dev/null',db, sql]).status, 0);
    }
    writeFileSync(join(dir,'calls.jsonl'),'');
    const result = spawnSync(process.execPath, [script, server, ...(receiptDraft ? ['--receipt-draft', '-'] : [])], { input: receiptDraft ? JSON.stringify(receiptDraft) : undefined, encoding: 'utf8', env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, TZ: timeZone, C3_FIXTURE: join(dir, 'fixture.json'),
      C3_CALLS: join(dir,'calls.jsonl'), T3_MCP_STATE_DB: db,
    } });
    result.calls = readFileSync(join(dir,'calls.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    return result;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
mkdirSync('docs.local', { recursive: true });
test('mapped Claude, dispatching client retained, shared Codex unmapped, daemon excluded', () => {
  const r = scan('brainlayer', [bridge, `/bin/python ${bridge}`, bridge, '/bin/python -m brainlayer daemon']);
  assert.equal(r.status, 0, r.stderr);
  const data = JSON.parse(r.stdout);
  assert.equal(data.clients.length, 3);
  assert.equal(data.clients[0].thread_id, 'mcp:mapped');
  assert.equal(data.clients[0].started_at, '2026-10-27T16:00:00Z');
  assert.equal(data.clients[2].thread_id, null);
  assert.match(r.stderr, /unmapped:202:.*shared Codex/);
  assert.deepEqual(data.excluded.map(e=>[e.rule,e.count]), [['daemon-process',1]]);
  assert.deepEqual(Object.keys(data).sort(), ['checked_at','clients','excluded']);
});
test('unavailable state and ambiguous native joins preserve unmapped clients', () => {
  for (const options of [{missingState:true}, {ambiguous:true}]) {
    const r = scan('brainlayer', [bridge], options);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).clients[0].thread_id, null);
    assert.match(r.stderr, /unmapped:200:/);
  }
});
test('all bridge install paths and brainbar alias match, near matches do not', () => {
  const commands = [bridge, '/opt/homebrew/Cellar/brainlayer/1.5.78/bin/brainlayer-mcp-stdio-bridge',
    '/opt/homebrew/bin/brainlayer-mcp-stdio-bridge', `${bridge}-fake`, `echo ${bridge}`, `/opt/homebrew/bin/uv ${bridge}`, `/usr/bin/env ${bridge}`, `/opt/homebrew/bin/python3.13t ${bridge}`];
  const r = scan('brainbar', commands);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).clients.length, 7);
});
test('both socat forms are excluded with the mandatory limitation, including empty scan', () => {
  for (const server of ['voicelayer', 'voicebar']) {
    for (const commands of [[], ['socat STDIO UNIX-CONNECT:/tmp/voicelayer-mcp.sock', '/opt/homebrew/bin/socat STDIO UNIX-CONNECT:/tmp/voicelayer-mcp.sock']]) {
      const r = scan(server, commands); assert.equal(r.status, 0, r.stderr);
      const data = JSON.parse(r.stdout); assert.deepEqual(data.clients, []);
      assert.equal(data.excluded[0].count, commands.length);
      assert.match(data.excluded[0].reason, /LIVE = daemon serves the new code; socat seats connected before a daemon restart got EOF and are dead for voicelayer until their session restarts \(not visible to ps\)\./);
    }
  }
});
test('empty scan succeeds; unsupported products and discovery failure cannot look empty-green', () => {
  const r = scan('brainlayer', []); assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).clients, []);
  assert.notEqual(scan('cmuxlayer', []).status, 0);
  assert.notEqual(scan('brainlayer', [], {snapshotFailure:true}).status, 0);
});

test('imported id joins and both native session flags work; local start converts to UTC', () => {
  const threadId = `import:claudeAgent:${session}`;
  for (const sessionFlag of ['--session-id=', '--session-id ', '--resume ']) {
    const r = scan('brainlayer', [bridge], { sessionFlag, threadId, timeZone: 'Asia/Jerusalem' });
    assert.equal(r.status, 0, r.stderr);
    const client = JSON.parse(r.stdout).clients[0];
    assert.equal(client.thread_id, threadId);
    assert.equal(client.started_at, '2026-10-27T16:00:00Z');
  }
});

function draft() {
  const sha = 'a'.repeat(40);
  return { schema:'install-receipt/v1', receipt_id:session, written_at:'2026-10-27T17:00:00Z',
    writer:{agent:'fixture',thread_or_session:'fixture'}, host:{alias:'mbp',hostname:'fixture',user:'fixture'},
    product:'brainlayer', artifact_kind:'brew-formula', target:{version:'1.0.0',merge_sha:sha,released_sha:sha,
      ancestry:{method:'gh-compare',status:'identical',checked_at:'2026-10-27T16:00:00Z'}},
    installed:{version:'1.0.0',path:'/fixture/bin',embedded_commit:sha,install_finished_at:'2026-10-27T16:00:00Z'},
    activation:{method:'new-session',processes:[],seat_scan:{bridge_diff:{from_tag:'v0.9.0',to_sha:sha,
      paths:bridgePaths('brainlayer'),changed:true}}},
    verdict:'INSTALLED_NOT_ACTIVE',reasons:[] };
}
test('receipt-draft mode derives the core-accepted stale list without copying its rule', () => {
  for (const changed of [true, false]) {
    const receiptDraft = draft(); receiptDraft.activation.seat_scan.bridge_diff.changed = changed;
    const r = scan('brainlayer', [bridge], {receiptDraft}); assert.equal(r.status, 0, r.stderr);
    const receipt = JSON.parse(r.stdout); assert.doesNotThrow(() => validate(receipt));
    assert.deepEqual(receipt.activation.seat_scan.active_seats, changed ? ['pid:100@2026-10-27T16:00:00Z'] : []);
  }
});
test('writer cross-check rejects a mismatching script-derived stale list', () => {
  const r = scan('brainlayer', [bridge], {receiptDraft:draft()}); assert.equal(r.status, 0, r.stderr);
  const receipt = JSON.parse(r.stdout); receipt.activation.seat_scan.active_seats = [];
  assert.throws(() => validate(receipt), /must equal the derived stale/);
});

test('single UTC snapshot tolerates a transient process vanishing before per-PID probing', () => {
  const r = scan('brainlayer', [bridge], {vanished:true}); assert.equal(r.status,0,r.stderr);
  assert.equal(JSON.parse(r.stdout).clients.length,1);
  assert.deepEqual(r.calls.filter(c=>['ps','pgrep'].includes(c.name)),
    [{name:'ps',args:['-axo','pid=,ppid=,lstart=,command='],tz:'UTC'}]);
});
test('missing provider remains an unmapped client with its PID in mapping notes', () => {
  const r = scan('brainlayer',[bridge],{missingProvider:true}); assert.equal(r.status,0,r.stderr);
  assert.equal(JSON.parse(r.stdout).clients[0].thread_id,null);
  const note = JSON.parse(r.stderr.trim()); assert.equal(note.pid,100); assert.equal(note.reason,'provider gone');
});
test('noncanonical bridge paths are retained so writer refuses them', () => {
  for(const command of ['/work/bin/brainlayer-mcp-stdio-bridge', '/usr/bin/env /work/bin/brainlayer-mcp-stdio-bridge']) {
    const r=scan('brainlayer',[command]);assert.equal(r.status,0,r.stderr);
    assert.equal(JSON.parse(r.stdout).clients[0].command,command);
    const rejected=scan('brainlayer',[command],{receiptDraft:draft()});
    assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/unrecognised bridge path/);
  }
});
test('multiple session flags and forks never select a guessed native session', () => {
  for(const extraSessionFlags of [`--session-id=${session}`, '--fork-session']) {
    const r=scan('brainlayer',[bridge],{extraSessionFlags});assert.equal(r.status,0,r.stderr);
    assert.equal(JSON.parse(r.stdout).clients[0].thread_id,null);assert.match(r.stderr,/ambiguous session flags/);
  }
});
test('fall-back hour is unambiguous UTC regardless of caller timezone', () => {
  for(const timeZone of ['UTC','America/New_York']) {
    const r=scan('brainlayer',[bridge],{timeZone,date:'Sun Nov 1 01:30:00 2026'});assert.equal(r.status,0,r.stderr);
    assert.equal(JSON.parse(r.stdout).clients[0].started_at,'2026-11-01T01:30:00Z');
  }
});
test('missing draft seat scan gets a clean prerequisite error', () => {
  const receiptDraft=draft();delete receiptDraft.activation.seat_scan;
  const r=scan('brainlayer',[bridge],{receiptDraft});assert.notEqual(r.status,0);
  assert.match(r.stderr,/draft must carry activation\.seat_scan\.bridge_diff from a real compare probe/);
});
test('dispatcher ancestor and own clients remain included and notes identify each PID', () => {
  const r=scan('brainlayer',[bridge,bridge],{callerProvider:true,threadId:'mcp:dispatcher'});assert.equal(r.status,0,r.stderr);
  const notes=r.stderr.trim().split('\n').filter(Boolean).map(JSON.parse);
  assert.deepEqual(notes.map(n=>n.pid),[100,101]);assert.equal(notes[0].provider_pid,process.pid);
  assert.deepEqual(JSON.parse(r.stdout).clients.map(c=>c.pid),[100,101]);
});
