import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const cli = resolve('scripts/docker/container-teardown.mjs');
const compose = 'com.docker.compose.project=fixture';
const supabase = 'com.supabase.cli.project=fixture';
const stub = String.raw`
const fs = require('node:fs'), path = require('node:path');
const root = process.env.FIXTURE, args = process.argv.slice(2);
const log = value => fs.appendFileSync(path.join(root, 'calls'), JSON.stringify([Date.now(), ...value]) + '\n');
const tool = path.basename(process.argv[1]);
log([tool, ...args]);
if (tool === 'docker' && args[0] === 'ps') {
  for (const file of fs.readdirSync(path.join(root, 'state'))) {
    const c = JSON.parse(fs.readFileSync(path.join(root, 'state', file)));
    if (args.includes('label=' + c.label) && (args.includes('--all') || c.running))
      console.log(args.includes('{{.Names}}') ? c.name : file);
  }
} else if (tool === 'docker' && args[0] === 'update') {
  if (process.env.FAIL_UPDATE) { console.error('protect failed'); process.exit(9); }
} else if (tool === 'supabase' || (tool === 'docker' && args[0] === 'compose')) {
  if (process.env.FAIL_STOP) { console.error('stop failed'); process.exit(8); }
  const label = (tool === 'supabase' ? 'com.supabase.cli.project=' : 'com.docker.compose.project=') + 'fixture';
  for (const file of fs.readdirSync(path.join(root, 'state'))) {
    const p = path.join(root, 'state', file), c = JSON.parse(fs.readFileSync(p));
    if (c.label === label && !process.env.SURVIVORS) fs.writeFileSync(p, JSON.stringify({...c, running: false}));
  }
} else { console.error('unexpected stub call'); process.exit(99); }
`;
const childSource = String.raw`
import fs from 'node:fs';
import path from 'node:path';
const root = process.env.FIXTURE;
const log = value => fs.appendFileSync(path.join(root, 'calls'), JSON.stringify([Date.now(), ...value]) + '\n');
log(['child', 'start']);
const mode = process.argv[2];
const create = id => {
  fs.writeFileSync(path.join(root, 'state', id), JSON.stringify({ label: process.env.SELECTOR, name: id, running: true }));
  log(['child', 'create', id]);
};
if (mode === 'hook') {
  const { createLifecycle } = await import(process.env.HELPER);
  const lifecycle = createLifecycle(process.env.SELECTOR);
  for (const id of ['created', 'recreated']) { create(id); await lifecycle.protect(); }
} else if (mode === 'create') {
  create('created');
  await new Promise(done => setTimeout(done, 1100));
} else if (mode === 'signal' || mode === 'stubborn') {
  create('created');
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { log(['child', signal]); if (mode === 'signal') process.exit(0); });
  setInterval(() => {}, 100);
  setTimeout(() => process.exit(91), 6000);
  console.log('READY');
  await new Promise(() => {});
}
log(['child', 'done']);
process.exit(Number(process.env.CHILD_EXIT || 0));
`;
async function fixture(fn, { selector = compose, ...env } = {}) {
  mkdirSync(resolve('docs.local'), { recursive: true });
  const root = mkdtempSync(resolve('docs.local/container-test-'));
  mkdirSync(join(root, 'bin')); mkdirSync(join(root, 'state'));
  writeFileSync(join(root, 'calls'), '');
  writeFileSync(join(root, 'stub.cjs'), `#!${process.execPath}\n${stub}`, { mode: 0o755 });
  for (const tool of ['docker', 'supabase']) symlinkSync('../stub.cjs', join(root, 'bin', tool));
  writeFileSync(join(root, 'child.mjs'), childSource);
  const calls = () => readFileSync(join(root, 'calls'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const seed = (id, label = selector, running = true) => writeFileSync(join(root, 'state', id), JSON.stringify({ label, name: id, running }));
  const environment = { ...process.env, CI: 'false', FAIL_UPDATE: '', FAIL_STOP: '', SURVIVORS: '', CHILD_EXIT: '',
    ...env, PATH: join(root, 'bin'), FIXTURE: root, SELECTOR: selector, HELPER: pathToFileURL(cli).href };
  const run = (action = 'run', mode = 'create', extra = {}) => new Promise((done, reject) => {
    const args = [cli, action, selector, ...(action === 'run' ? ['--', process.execPath, join(root, 'child.mjs'), mode] : [])];
    const child = spawn(process.execPath, args, { env: { ...environment, ...extra } });
    let stdout = '', stderr = '', sent = false;
    child.stdout.on('data', data => {
      stdout += data;
      if (!sent && stdout.includes('READY')) { sent = true; child.kill(extra.WRAPPER_SIGNAL || 'SIGTERM'); }
    });
    child.stderr.on('data', data => { stderr += data; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('fixture wrapper timed out')); }, 10000);
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); done({ code, stdout, stderr }); });
  });
  try { await fn({ run, calls, seed, root, environment }); }
  finally {
    for (const [, ...args] of calls()) {
      assert.doesNotMatch(args.join(' '), /down\s+-v|--volumes|--no-backup|rm\s+-v|volume\s+rm/);
    }
    rmSync(root, { recursive: true, force: true });
  }
}
const index = (calls, tool, command) => calls.findIndex(c => c[1] === tool && c[2] === command);

test('preflight protects all stale containers and stops before starting the child', () => fixture(async ({ run, seed, calls }) => {
  seed('stale'); seed('stopped', compose, false); seed('unrelated', 'com.docker.compose.project=other');
  const result = await run('run', 'hook'); assert.equal(result.code, 0, result.stderr);
  const c = calls(), update = index(c, 'docker', 'update'), stop = index(c, 'docker', 'compose');
  assert.deepEqual(c[update].slice(2), ['update', '--restart=no', 'stale', 'stopped']);
  assert.ok(update < stop && stop < index(c, 'child', 'start'));
  assert.equal(c.some(c => c[1] === 'docker' && c[2] === 'update' && c.includes('unrelated')), false);
  for (const id of ['created', 'recreated']) {
    const created = c.findIndex(c => c[1] === 'child' && c[2] === 'create' && c[3] === id);
    const protectedAt = c.findIndex((c, i) => i > created && c[1] === 'docker' && c[2] === 'update' && c.includes(id));
    assert.ok(protectedAt > created && protectedAt < index(c, 'child', 'done'));
  }
}));
test('poll protects a running child; teardown protects all, stops, then checks survivors', () => fixture(async ({ run, calls }) => {
  const result = await run(); assert.equal(result.code, 0, result.stderr);
  const c = calls(), done = index(c, 'child', 'done');
  assert.ok(c.some((c, i) => i < done && c[1] === 'docker' && c[2] === 'update' && c.includes('created')));
  assert.deepEqual(c.slice(done + 1).map(c => c.slice(1)), [
    ['docker', 'ps', '--all', '--filter', `label=${compose}`, '--format', '{{.ID}}'],
    ['docker', 'update', '--restart=no', 'created'],
    ['docker', 'compose', '--project-name', 'fixture', 'stop'],
    ['docker', 'ps', '--filter', `label=${compose}`, '--format', '{{.Names}}'],
  ]);
}));
test('teardown reports every survivor and aggregates protect and stop failures', () => fixture(async ({ run, seed }) => {
  seed('survivor-a'); seed('survivor-b');
  const r = await run('teardown'); assert.equal(r.code, 1);
  for (const message of ['protect failed', 'stop failed', 'survivor-a', 'survivor-b']) assert.ok(r.stderr.includes(message), r.stderr);
}, { FAIL_UPDATE: '1', FAIL_STOP: '1' }));
test('child exit code stays primary when teardown fails', () => fixture(async ({ run }) => {
  const r = await run('run', 'hook'); assert.equal(r.code, 23);
  assert.match(r.stderr, /23/); assert.match(r.stderr, /stop failed/); assert.match(r.stderr, /created/);
}, { CHILD_EXIT: '23', FAIL_STOP: '1' }));
test('Supabase preflight uses project stop without deleting backups', () => fixture(async ({ run, seed, calls }) => {
  seed('stale'); const r = await run('preflight'); assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(calls().filter(c => c[1] === 'supabase').map(c => c.slice(2)), [['stop', '--project-id', 'fixture']]);
}, { selector: supabase }));
for (const [mode, signal, exit] of [['signal', 'SIGTERM', 143], ['stubborn', 'SIGTERM', 143], ['signal', 'SIGINT', 130]])
test(`${signal} reaches ${mode} child; teardown follows the bounded wait`, () => fixture(async ({ run, calls }) => {
  const r = await run('run', mode, { WRAPPER_SIGNAL: signal }); assert.equal(r.code, exit, r.stderr);
  const c = calls(), term = index(c, 'child', signal), stop = index(c, 'docker', 'compose');
  assert.ok(term >= 0 && stop > term);
  assert.ok(c[stop][0] - c[term][0] < 2000, 'child wait exceeded 1.5s plus command overhead');
}));
test('CI passes through child exits and skips every lifecycle Docker call', () => fixture(async ({ run, calls }) => {
  assert.equal((await run('run', 'hook')).code, 23);
  for (const action of ['preflight', 'protect', 'teardown']) assert.equal((await run(action)).code, 0);
  assert.equal(calls().some(c => ['docker', 'supabase'].includes(c[1])), false);
}, { CI: 'true', CHILD_EXIT: '23' }));
for (const selector of ['name=fixture*', 'com.docker.compose.project=', 'com.supabase.cli.project=fixture*', 'com.docker.compose.project=a,b'])
test(`invalid selector ${selector} fails before invoking Docker`, () => fixture(async ({ run, calls }) => {
  const r = await run('teardown'); assert.equal(r.code, 1); assert.match(r.stderr, /selector/i); assert.deepEqual(calls(), []);
}, { selector }));
test('failed preflight refuses to start work', () => fixture(async ({ run, seed, calls }) => {
  seed('stale'); const r = await run('run', 'hook'); assert.equal(r.code, 1);
  assert.match(r.stderr, /stale/); assert.equal(index(calls(), 'child', 'start'), -1);
}, { FAIL_STOP: '1' }));
test('failed polling aborts the child and still tears down', () => fixture(async ({ run, calls }) => {
  const r = await run(); assert.equal(r.code, 1); assert.match(r.stderr, /protect failed/);
  assert.ok(index(calls(), 'docker', 'compose') > index(calls(), 'child', 'start'));
}, { FAIL_UPDATE: '1' }));
test('survivors after a successful child make the wrapper fail', () => fixture(async ({ run }) => {
  const r = await run('run', 'hook'); assert.equal(r.code, 1); assert.match(r.stderr, /created.*recreated/);
}, { SURVIVORS: '1' }));
test('module run preserves the primary failure and cleanup error as AggregateError causes', () => fixture(async ({ root, environment }) => {
  const { createLifecycle } = await import(pathToFileURL(cli));
  const lifecycle = createLifecycle(compose, { env: environment, cwd: root });
  await assert.rejects(lifecycle.run([process.execPath, join(root, 'child.mjs'), 'hook']), error => {
    assert.ok(error instanceof AggregateError); assert.equal(error.exitCode, 23);
    assert.equal(error.cause, error.errors[0]); assert.match(error.errors[0].message, /23/);
    assert.match(error.errors[1].message, /stop failed/); return true;
  });
}, { CHILD_EXIT: '23', FAIL_STOP: '1' }));
