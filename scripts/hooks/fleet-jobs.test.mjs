import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fleetJobFiles, fleetJobsStatus, installFleetJobs } from './fleet-jobs.mjs';
test('jobs render pinned paths, install idempotently, detect plist drift', () => {
  const scratch = resolve('docs.local/fleet-tests'); mkdirSync(scratch, { recursive: true });
  const home = mkdtempSync(join(scratch, 'jobs-'));
  const live = resolve('.'); const loaded = new Set(); const calls = [];
  const command = args => {
    calls.push(args[0]);
    if (args[0] === 'print' && !loaded.has(args[1])) throw Error('absent');
    if (args[0] === 'bootstrap') loaded.add(args[1] + '/com.golems.' + (args[2].includes('disk-guard') ? 'disk-guard' : 'worktree-sweeper'));
  };
  try {
    assert.equal(fleetJobsStatus(live, { home }).length, 2);
    installFleetJobs(live, { home, command, uid: 1 });
    assert.equal(fleetJobsStatus(live, { home }).length, 0);
    assert.equal(calls.filter(x => x === 'bootstrap').length, 2);
    installFleetJobs(live, { home, command, uid: 1 });
    assert.equal(calls.filter(x => x === 'bootstrap').length, 2);
    const f = fleetJobFiles(live, home)[0]; assert.ok(f.text.includes(live));
    writeFileSync(f.path, 'drift'); assert.equal(fleetJobsStatus(live, { home }).length, 1);
  } finally { rmSync(home, { recursive: true }); }
});
