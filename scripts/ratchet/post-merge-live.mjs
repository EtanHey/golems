import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
function run(binary, args, options = {}) {
  const r = spawnSync(binary, args, { encoding: 'utf8', cwd: root, ...options });
  if (r.status !== 0) throw new Error(`${binary} failed: ${r.stderr || r.error || r.signal}`);
  return (r.stdout ?? '').trim();
}
try {
  const options = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    if (!['--merged-pr', '--lease-pr', '--lease-repo'].includes(args[i]) || !args[i + 1]) throw new Error('expected --merged-pr N --lease-pr N [--lease-repo path]');
    options[args[i]] = args[i + 1];
  }
  // AIDEV-NOTE: never auto-pick a lease. A borrowed branch that moves mid-receipt denies the token (#1007,
  // FV3 TLA+ LiveReceiptIsolated). Fail closed before any side effect; see docs/architecture/post-merge-live-lease.md.
  if (!options['--lease-pr']) throw new Error('--lease-pr is required: pass an open PR you own and will not push during the receipt '
    + '(usage: post-merge-live.sh --merged-pr N --lease-pr <your PR> [--lease-repo <its clean worktree>]; '
    + 'see docs/architecture/post-merge-live-lease.md)');
  if (!/^[1-9]\d*$/.test(options['--merged-pr'] ?? '') || !/^[1-9]\d*$/.test(options['--lease-pr'] ?? '')) throw new Error('PR numbers must be positive integers');
  run('bash', [root + 'scripts/hooks/install-hooks.sh', '--host', 'mbp', '--update', '--apply'], { stdio: 'inherit' });
  const hookStatus = spawnSync('bash', [root + 'scripts/hooks/install-hooks.sh', '--host', 'mbp', '--status'],
    { encoding: 'utf8', cwd: root });
  if ((hookStatus.stdout ?? '').split('\n').some(line => line.includes('codex wiring=') && /\btrust=missing\b/.test(line))) {
    console.log('post-merge-live: BLOCKED — Codex hook trust missing (new or changed hook definitions).');
    console.log('Owner step (Etan, on this Mac): open plain `codex` (no --profile), run /hooks, approve the changed definitions.');
    console.log(`Then re-run: scripts/ratchet/post-merge-live.sh --merged-pr ${options['--merged-pr']} --lease-pr ${options['--lease-pr']}`);
    console.log("No receipt posted, so live-freshness's grace window still applies.");
    process.exit(3);
  }
  const pulls = JSON.parse(run('gh', ['pr', 'list', '--repo', 'EtanHey/golems', '--state', 'open', '--limit', '1000', '--json', 'number,headRefName,headRefOid']));
  const trees = run('git', ['worktree', 'list', '--porcelain', '-z']).split('\0\0').map(block => {
    const fields = Object.fromEntries(block.split('\0').filter(Boolean).map(line => { const i = line.indexOf(' '); return [line.slice(0, i), line.slice(i + 1)]; }));
    return fields;
  });
  let lease;
  for (const tree of trees) {
    if (!tree.worktree || (options['--lease-repo'] && tree.worktree !== options['--lease-repo'])) continue;
    const pr = pulls.find(p => tree.branch === 'refs/heads/' + p.headRefName && tree.HEAD === p.headRefOid && String(p.number) === options['--lease-pr']);
    if (pr && run('git', ['-C', tree.worktree, 'rev-parse', 'HEAD']) === pr.headRefOid
      && run('git', ['-C', tree.worktree, 'status', '--porcelain']) === '') { lease = { pr, tree }; break; }
  }
  if (!lease) throw new Error(`no valid lease: PR #${options['--lease-pr']} must be OPEN with a clean local worktree on its branch at its exact head`);
  run('bash', [root + 'scripts/ratchet/live-rows.sh', '--merged-pr', options['--merged-pr'], '--lease-pr', String(lease.pr.number), '--lease-repo', lease.tree.worktree],
    { stdio: 'inherit', env: { ...process.env, RATCHET_SKILL_CONFIG: process.env.HOME + '/.golems/ratchet/installed-skills.json' } });
  const comments = JSON.parse(run('gh', ['api', '--paginate', '--slurp', `repos/EtanHey/golems/issues/${options['--merged-pr']}/comments`])).flat();
  const sticky = comments.find(c => c.user?.login === 'EtanHey' && c.body?.split('\n')[0] === '<!-- ratchet-table: golems-ratchet-live -->');
  if (!sticky?.html_url) throw new Error('posted live comment URL missing');
  console.log(sticky.html_url);
  const freshness = spawnSync('node', [root + 'scripts/ratchet/live-freshness.mjs'], { cwd: root, encoding: 'utf8' });
  console.log(freshness.stdout.trim().split('\n').at(-1));
  if (freshness.status !== 0) throw new Error(freshness.stderr || 'freshness failed');
} catch (error) { console.error(`post-merge-live: ${error.message}`); process.exitCode = 1; }
