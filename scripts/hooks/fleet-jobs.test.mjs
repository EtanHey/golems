import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { userInfo } from 'node:os';
import { fleetJobFiles, fleetJobsStatus, installFleetJobs, installContextFleetJobs, reportFleetJobsStatus } from './fleet-jobs.mjs';
test('jobs render pinned paths, install idempotently, detect plist drift', () => {
  const scratch = resolve('docs.local/fleet-tests'); mkdirSync(scratch, { recursive: true });
  const home = mkdtempSync(join(scratch, 'jobs-'));
  const live = resolve('.'); const loaded = new Set(); const calls = [];
  const command = args => {
    calls.push(args[0]);
    if (args[0] === 'print' && !loaded.has(args[1])) throw Object.assign(Error('absent'), { code: 'LAUNCHD_NOT_LOADED' });
    if (args[0] === 'bootstrap') loaded.add(args[1] + '/com.golems.' + (args[2].includes('disk-guard') ? 'disk-guard' : 'worktree-sweeper'));
  };
  try {
    assert.equal(fleetJobsStatus(live, { home }).length, 2);
    installFleetJobs(live, { home, accountHome: home, command, uid: 1 });
    assert.equal(fleetJobsStatus(live, { home }).length, 0);
    assert.equal(calls.filter(x => x === 'bootstrap').length, 2);
    installFleetJobs(live, { home, accountHome: home, command, uid: 1 });
    assert.equal(calls.filter(x => x === 'bootstrap').length, 2);
    const f = fleetJobFiles(live, home)[0]; assert.ok(f.text.includes(live));
    writeFileSync(f.path, 'drift'); assert.equal(fleetJobsStatus(live, { home }).length, 1);
  } finally { rmSync(home, { recursive: true }); }
});

test('empty fleet_hosts skips install and status even with the real account HOME', () => {
  const manifest = JSON.parse(readFileSync(resolve('scripts/hooks/manifest.json'), 'utf8'));
  assert.deepEqual(manifest.fleet_hosts, []);
  const calls = []; const home = userInfo().homedir;
  const ctx = { fleetJobs: manifest.fleet_hosts.includes('mbp'), live: resolve('.') };
  const options = { home, accountHome: home, command: args => calls.push(args) };
  installContextFleetJobs(ctx, options);
  assert.equal(reportFleetJobsStatus(ctx, true, options), false);
  assert.deepEqual(calls, []);
});

test('context install and status share the vetted stable Node path', () => {
  const scratch = resolve('docs.local/fleet-tests'); mkdirSync(scratch, { recursive: true });
  const home = mkdtempSync(join(scratch, 'stable-node-'));
  const ctx = { fleetJobs: true, live: resolve('.'), hookNode: { path: '/opt/stable-node/bin/node' } };
  try {
    installContextFleetJobs(ctx, { home, accountHome: scratch });
    for (const f of fleetJobFiles(ctx.live, home, ctx.hookNode.path)) {
      assert.equal(readFileSync(f.path, 'utf8'), f.text);
      assert.ok(f.text.includes(`<string>${ctx.hookNode.path}</string>`));
    }
    assert.equal(reportFleetJobsStatus(ctx, true, { home }), false);
  } finally { rmSync(home, { recursive: true }); }
});

test('scratch homes and an unavailable account home never contact launchd', () => {
  const scratch = resolve('docs.local/fleet-tests'); mkdirSync(scratch, { recursive: true });
  const home = mkdtempSync(join(scratch, 'isolated-'));
  try {
    for (const accountHome of [scratch, join(home, 'missing-account')]) {
      const calls = [];
      installFleetJobs(resolve('.'), { home, accountHome, command: args => calls.push(args) });
      assert.deepEqual(calls, []);
      assert.deepEqual(fleetJobsStatus(resolve('.'), { home }), []);
    }
  } finally { rmSync(home, { recursive: true }); }
});

test('a launchctl print failure other than service absence refuses without replacing or bootstrapping plists', () => {
  const scratch = resolve('docs.local/fleet-tests'); mkdirSync(scratch, { recursive: true });
  const home = mkdtempSync(join(scratch, 'print-failure-')); const calls = [];
  try {
    const command = args => { calls.push(args[0]); if (args[0] === 'print') throw Error('Operation not permitted'); };
    assert.throws(() => installFleetJobs(resolve('.'), { home, accountHome: home, command }), /Operation not permitted/);
    assert.deepEqual(calls, ['print']);
    assert.equal(fleetJobsStatus(resolve('.'), { home }).length, 2);
  } finally { rmSync(home, { recursive: true }); }
});

test('real command adapter accepts only launchd service absence, refusing other print errors', () => {
  const scratch = resolve('docs.local/fleet-tests'); mkdirSync(scratch, { recursive: true });
  const home = mkdtempSync(join(scratch, 'command-')); const previousPath = process.env.PATH;
  const bin = join(home, 'bin'); mkdirSync(bin); const log = join(home, 'launchctl.log');
  try {
    process.env.PATH = bin;
    const stub = diagnostic => writeFileSync(join(bin, 'launchctl'), `#!/bin/sh\nprintf '%s\\n' "$1" >> '${log}'\nif [ "$1" = print ]; then printf '%s\\n' '${diagnostic}' >&2; exit 113; fi\n`, { mode: 0o755 });
    stub('Operation not permitted');
    assert.throws(() => installFleetJobs(resolve('.'), { home, accountHome: home }), /refusing.*Operation not permitted/);
    assert.equal(readFileSync(log, 'utf8'), 'print\n');
    stub('Could not find domain for user');
    assert.throws(() => installFleetJobs(resolve('.'), { home, accountHome: home }), /refusing.*Could not find domain/);
    assert.equal(readFileSync(log, 'utf8'), 'print\nprint\n');
    stub('Could not find service "com.golems.worktree-sweeper" in domain for user gui: 501');
    installFleetJobs(resolve('.'), { home, accountHome: home });
    assert.equal(readFileSync(log, 'utf8'), 'print\nprint\nprint\nbootstrap\nprint\nbootstrap\n');
    assert.deepEqual(fleetJobsStatus(resolve('.'), { home }), []);
  } finally {
    process.env.PATH = previousPath;
    rmSync(home, { recursive: true });
  }
});
