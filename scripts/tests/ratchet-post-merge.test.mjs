import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('post-merge wrapper picks clean exact-head leases, prefers worker paths, and fails without one', () => {
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
    const picked = run();
    expect(picked.stderr).toBe("");
    expect(picked.status).toBe(0);
    expect(picked.stdout).toContain('https://example.invalid/comment\nfreshness PASS');
    const none = run({ NO_LEASE: '1' });
    expect(none.status).toBe(1);
    expect(none.stderr).toContain('no valid lease');
    expect(run({ EXPECT_PATH: '/ordinary' }, ['--lease-pr', '7', '--lease-repo', '/ordinary']).status).toBe(0);
    expect(run({}, ['--lease-pr', '8']).status).toBe(1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
