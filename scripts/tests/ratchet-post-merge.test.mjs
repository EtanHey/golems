import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
test('post-merge wrapper requires --lease-pr and picks only that PR\'s clean exact-head worktree', () => {
  mkdirSync(resolve('docs.local/l3-tests'), { recursive: true }); // absent in a fresh CI checkout
  const dir = mkdtempSync(resolve('docs.local/l3-tests/post-merge-'));
  try {
    mkdirSync(join(dir, 'scripts/ratchet'), { recursive: true });
    mkdirSync(join(dir, 'bin'));
    copyFileSync(resolve('scripts/ratchet/post-merge-live.mjs'), join(dir, 'scripts/ratchet/post-merge-live.mjs'));
    const fake = `#!/usr/bin/env node
const a = process.argv.slice(2), e = process.env;
const name = require('path').basename(process.argv[1]);
if (name === 'bash') {
  if (a[0].endsWith('install-hooks.sh') && a.slice(1).join(' ') === '--host mbp --update --apply') process.exit(0);
  if (a[0].endsWith('install-hooks.sh') && a.includes('--status')) { console.log('codex wiring=ok trust=ok'); process.exit(0); }
  if (a[0].endsWith('live-rows.sh') && a.slice(1).join(' ') === '--merged-pr 42 --lease-pr 7 --lease-repo ' + e.EXPECT_PATH
    && e.RATCHET_SKILL_CONFIG === e.HOME + '/.golems/ratchet/installed-skills.json') process.exit(0);
  process.exit(8);
}
if (name === 'gh') {
  if (a[0] === 'pr') console.log(JSON.stringify([{number:7,headRefName:'lease',headRefOid:'abc'}]));
  else console.log(JSON.stringify([[{user:{login:'EtanHey'},body:'<!-- ratchet-table: golems-ratchet-live -->',html_url:'https://example.invalid/comment'}]]));
} else if (a[0] === 'worktree') {
  const paths = ['/ordinary',e.HOME+'/.t3/worktrees/golems/dirty',e.HOME+'/.t3/worktrees/golems/mismatch',e.HOME+'/.t3/worktrees/golems/valid'];
  process.stdout.write(paths.map(p => 'worktree '+p+'\\0HEAD '+(p.endsWith('mismatch')?'old':'abc')+'\\0branch refs/heads/lease\\0\\0').join(''));
} else if (a[2] === 'rev-parse') console.log('abc');
else if (a[2] === 'status') { if (e.NO_LEASE || a[1].endsWith('dirty')) console.log(' M dirty'); }
else process.exit(9);
`;
    for (const name of ['git', 'gh', 'bash']) writeFileSync(join(dir, 'bin', name), fake, { mode: 0o755 });
    writeFileSync(join(dir, 'scripts/ratchet/live-freshness.mjs'), "console.log('freshness PASS');");
    const run = (extra = {}, args = []) => spawnSync('node', [join(dir, 'scripts/ratchet/post-merge-live.mjs'), '--merged-pr', '42', ...args],
      { encoding: 'utf8', env: { ...process.env, PATH: join(dir, 'bin') + ':' + process.env.PATH,
        EXPECT_PATH: process.env.HOME + '/.t3/worktrees/golems/valid', ...extra } });
    // Never auto-pick (#1007; FV3 TLA+ LiveReceiptIsolated): no --lease-pr fails closed with the fix in the message.
    const unpinned = run();
    expect(unpinned.status).toBe(1);
    expect(unpinned.stderr).toContain('--lease-pr is required');
    expect(unpinned.stderr).toContain('docs/architecture/post-merge-live-lease.md');
    const valid = process.env.HOME + '/.t3/worktrees/golems/valid';
    const picked = run({}, ['--lease-pr', '7', '--lease-repo', valid]);
    expect(picked.status).toBe(0);
    expect(picked.stdout).toContain('https://example.invalid/comment\nfreshness PASS');
    // R14: retention runs here (master's code, after the receipt), and a refusal never fails the receipt.
    const lease = ['--lease-pr', '7', '--lease-repo', valid];
    const pruneLog = join(dir, 'prune-calls');
    writeFileSync(join(dir, 'scripts/ratchet/prune-runs.mjs'),
      `import { appendFileSync } from 'node:fs'; appendFileSync(${JSON.stringify(pruneLog)}, process.argv.slice(2).join(' ') + '\\n'); console.log('Apply: 0/0 entries'); process.exit(Number(process.env.PRUNE_EXIT || 0));`);
    const pruned = run({}, lease);
    expect(pruned.status).toBe(0);
    expect(readFileSync(pruneLog, 'utf8')).toBe('--apply\n');
    expect(pruned.stdout.indexOf('freshness PASS')).toBeLessThan(pruned.stdout.indexOf('Apply: 0/0 entries'));
    const refused = run({ PRUNE_EXIT: '2' }, lease);
    expect(refused.status).toBe(0);
    expect(refused.stderr).toContain('retention refused (non-fatal)');
    rmSync(join(dir, 'scripts/ratchet/prune-runs.mjs'));
    expect(run({ EXPECT_PATH: '/ordinary' }, ['--lease-pr', '7', '--lease-repo', '/ordinary']).status).toBe(0);
    for (const bad of ['dirty', 'mismatch']) {
      const r = run({}, ['--lease-pr', '7', '--lease-repo', process.env.HOME + '/.t3/worktrees/golems/' + bad]);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('no valid lease: PR #7');
    }
    const none = run({ NO_LEASE: '1' }, ['--lease-pr', '7']);
    expect(none.status).toBe(1);
    expect(none.stderr).toContain('no valid lease');
    expect(run({}, ['--lease-pr', '8']).status).toBe(1);
    expect(run({}, ['--lease-pr', 'x']).stderr).toContain('PR numbers must be positive integers');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


// One fake for gh, git and bash that logs every call. A valid lease exists (PR #7, clean worktree at its head)
// unless NO_LEASE is set; LIVE_ROWS_EXIT and STICKY steer the live-rows run and the posted receipt.
function sandbox(prefix) {
  mkdirSync(resolve('docs.local/l3-tests'), { recursive: true });
  const dir = mkdtempSync(resolve('docs.local/l3-tests/' + prefix));
  mkdirSync(join(dir, 'scripts/ratchet'), { recursive: true });
  mkdirSync(join(dir, 'bin'));
  copyFileSync(resolve('scripts/ratchet/post-merge-live.mjs'), join(dir, 'scripts/ratchet/post-merge-live.mjs'));
  const fake = `#!/usr/bin/env node
const fs = require('fs'), a = process.argv.slice(2), e = process.env;
const name = require('path').basename(process.argv[1]);
fs.appendFileSync(e.CALL_LOG, name + ' ' + a.join(' ') + '\\n');
if (name === 'bash') {
  if (a[0].endsWith('install-hooks.sh') && a.includes('--status')) {
    console.log('codex wiring=ok enabled=true registered=true source=true trust=' + (e.HOOK_TRUST || 'ok'));
    process.exit(1);
  }
  if (a[0].endsWith('install-hooks.sh')) process.exit(0);
  if (a[0].endsWith('live-rows.sh')) process.exit(Number(e.LIVE_ROWS_EXIT || 0));
  process.exit(8);
}
if (name === 'gh' && a[0] === 'pr') console.log(JSON.stringify([{number:7,headRefName:'lease',headRefOid:'abc'}]));
else if (name === 'gh' && a[0] === 'api') console.log(JSON.stringify([e.STICKY ? [JSON.parse(e.STICKY)] : []]));
else if (a[0] === 'worktree') process.stdout.write('worktree /lease\\0HEAD abc\\0branch refs/heads/lease\\0\\0');
else if (a[2] === 'rev-parse') console.log('abc');
else if (a[2] === 'status') { if (e.NO_LEASE) console.log(' M dirty'); }
else process.exit(9);
`;
  for (const name of ['bash', 'gh', 'git']) writeFileSync(join(dir, 'bin', name), fake, { mode: 0o755 });
  writeFileSync(join(dir, 'scripts/ratchet/live-freshness.mjs'),
    `import { appendFileSync } from 'node:fs'; appendFileSync(process.env.CALL_LOG, 'freshness\\n'); console.log('live-tier freshness abc12345: FAIL: receipt ok:false'); process.exit(1);`);
  writeFileSync(join(dir, 'scripts/ratchet/prune-runs.mjs'),
    `import { appendFileSync } from 'node:fs'; appendFileSync(process.env.CALL_LOG, 'prune ' + process.argv.slice(2).join(' ') + '\\n'); console.log('Apply: 0/0 entries');`);
  const log = join(dir, 'calls');
  const run = (env = {}, args = ['--lease-pr', '7']) => {
    writeFileSync(log, '');
    const r = spawnSync('node', [join(dir, 'scripts/ratchet/post-merge-live.mjs'), '--merged-pr', '42', ...args],
      { encoding: 'utf8', env: { ...process.env, PATH: join(dir, 'bin') + ':' + process.env.PATH, CALL_LOG: log, ...env } });
    return { ...r, calls: readFileSync(log, 'utf8') };
  };
  return { dir, run };
}

test('post-merge wrapper changes nothing on the machine without a valid lease', () => {
  const { dir, run } = sandbox('post-merge-nolease-');
  try {
    for (const [env, args] of [[{ NO_LEASE: '1' }, ['--lease-pr', '7']], [{}, ['--lease-pr', '8']], [{}, ['--lease-pr', '7', '--lease-repo', '/elsewhere']]]) {
      const r = run(env, args);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('no valid lease');
      expect(r.calls).toContain('gh pr list');
      expect(r.calls).not.toContain('install-hooks.sh');
      expect(r.calls).not.toContain('live-rows.sh');
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('post-merge wrapper reports a failed live-rows run: receipt URL, freshness, prune, exit non-zero', () => {
  const { dir, run } = sandbox('post-merge-rowsfail-');
  try {
    const url = 'https://example.invalid/receipt';
    const sticky = updated => JSON.stringify({ user: { login: 'EtanHey' }, body: '<!-- ratchet-table: golems-ratchet-live -->', html_url: url, updated_at: updated });
    // Rows failed after posting (#1366, 2026-11-26): the URL is printed, freshness and prune still run.
    const posted = run({ LIVE_ROWS_EXIT: '1', STICKY: sticky(new Date().toISOString()) });
    expect(posted.status).toBe(1);
    expect(posted.stdout).toContain('receipt posted: ' + url + '\nlive-tier freshness abc12345: FAIL');
    expect(posted.calls).toContain('freshness\nprune --apply\n');
    expect(posted.stderr).toContain('post-merge-live: live rows FAILED (exit 1); receipt posted: ' + url
      + '; freshness: live-tier freshness abc12345: FAIL: receipt ok:false');
    expect(posted.stderr).not.toContain('null');
    // Rows died before posting: an older sticky is not this run's receipt, and none at all says so.
    const stale = run({ LIVE_ROWS_EXIT: '2', STICKY: sticky('2020-01-01T00:00:00Z') });
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain('live rows FAILED (exit 2); no receipt posted by this run (last receipt ' + url);
    expect(stale.calls).toContain('prune --apply');
    const none = run({ LIVE_ROWS_EXIT: '2' });
    expect(none.status).toBe(1);
    expect(none.stderr).toContain('live rows FAILED (exit 2); no receipt posted; freshness:');
    expect(none.stderr).not.toContain('null');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test('post-merge wrapper blocks missing Codex trust after the lease and before receipts', () => {
  const { dir, run } = sandbox('post-merge-trust-');
  try {
    // A missing --lease-pr fails before ANY tool call: no gh, no hook update, no status probe.
    const unpinned = run({ HOOK_TRUST: 'missing' }, []);
    expect(unpinned.status).toBe(1);
    expect(unpinned.stderr).toContain('--lease-pr is required');
    expect(unpinned.calls).toBe('');
    const missing = run({ HOOK_TRUST: 'missing' });
    expect(missing.status).toBe(3);
    expect(missing.stdout).toBe([
      'post-merge-live: BLOCKED — Codex hook trust missing (new or changed hook definitions).',
      'Owner step (Etan, on this Mac): open plain `codex` (no --profile), run /hooks, approve the changed definitions.',
      'Then re-run: scripts/ratchet/post-merge-live.sh --merged-pr 42 --lease-pr 7',
      "No receipt posted, so live-freshness's grace window still applies.",
      '',
    ].join('\n'));
    const calls = missing.calls.trim().split('\n');
    // The lease is found and validated (read-only) before the hook install, the only side effect, runs.
    expect(calls[0]).toStartWith('gh pr list');
    expect(calls).toHaveLength(6);
    expect(calls[4]).toEndWith('install-hooks.sh --host mbp --update --apply');
    expect(calls[5]).toEndWith('install-hooks.sh --host mbp --status');
    expect(missing.calls).not.toContain('live-rows.sh');
    // Even a failed status probe continues when it does not report missing trust.
    // (The sandbox's freshness always FAILs, so a clean rows run still exits 1, after prune.)
    const ok = run({ HOOK_TRUST: 'ok', STICKY: JSON.stringify({ user: { login: 'EtanHey' }, body: '<!-- ratchet-table: golems-ratchet-live -->', html_url: 'https://example.invalid/r' }) });
    expect(ok.status).toBe(1);
    expect(ok.stdout).toContain('https://example.invalid/r\nlive-tier freshness abc12345: FAIL');
    expect(ok.stderr).toContain('post-merge-live: freshness failed (exit 1)');
    expect(ok.calls).toContain('prune --apply');
    expect(ok.calls).toContain('live-rows.sh --merged-pr 42 --lease-pr 7 --lease-repo /lease');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
