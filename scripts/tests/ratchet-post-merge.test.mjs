import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
test('post-merge wrapper requires --lease-pr and picks only that PR\'s clean exact-head worktree', () => {
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


test('post-merge wrapper blocks missing Codex trust before lease selection or receipts', () => {
  const dir = mkdtempSync(resolve('docs.local/l3-tests/post-merge-trust-'));
  try {
    mkdirSync(join(dir, 'scripts/ratchet'), { recursive: true });
    mkdirSync(join(dir, 'bin'));
    copyFileSync(resolve('scripts/ratchet/post-merge-live.mjs'), join(dir, 'scripts/ratchet/post-merge-live.mjs'));
    const fake = `#!/usr/bin/env node
const fs = require('fs'), a = process.argv.slice(2), e = process.env;
const name = require('path').basename(process.argv[1]);
fs.appendFileSync(e.CALL_LOG, name + ' ' + a.join(' ') + '\\n');
if (name === 'bash' && a[0].endsWith('install-hooks.sh')) {
  if (a.includes('--status')) {
    console.log('codex wiring=ok enabled=true registered=true source=true trust=' + e.HOOK_TRUST);
    process.exit(1);
  }
  process.exit(0);
}
process.exit(9);
`;
    for (const name of ['bash', 'gh', 'git']) writeFileSync(join(dir, 'bin', name), fake, { mode: 0o755 });
    const log = join(dir, 'calls');
    const run = (trust, args = ['--lease-pr', '7']) => spawnSync('node', [join(dir, 'scripts/ratchet/post-merge-live.mjs'), '--merged-pr', '42', ...args],
      { encoding: 'utf8', env: { ...process.env, PATH: join(dir, 'bin') + ':' + process.env.PATH, CALL_LOG: log, HOOK_TRUST: trust } });
    // A missing --lease-pr fails before ANY side effect: no hook update, no status probe, no gh.
    writeFileSync(log, '');
    const unpinned = run('missing', []);
    expect(unpinned.status).toBe(1);
    expect(unpinned.stderr).toContain('--lease-pr is required');
    expect(readFileSync(log, 'utf8')).toBe('');
    const missing = run('missing');
    expect(missing.status).toBe(3);
    expect(missing.stdout).toBe([
      'post-merge-live: BLOCKED — Codex hook trust missing (new or changed hook definitions).',
      'Owner step (Etan, on this Mac): open plain `codex` (no --profile), run /hooks, approve the changed definitions.',
      'Then re-run: scripts/ratchet/post-merge-live.sh --merged-pr 42 --lease-pr 7',
      "No receipt posted, so live-freshness's grace window still applies.",
      '',
    ].join('\n'));
    const calls = readFileSync(log, 'utf8').trim().split('\n');
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEndWith('--host mbp --update --apply');
    expect(calls[1]).toEndWith('--host mbp --status');
    // Even a failed status probe continues when it does not report missing trust.
    writeFileSync(log, '');
    expect(run('ok').status).toBe(1);
    expect(readFileSync(log, 'utf8')).toContain('gh pr list');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
