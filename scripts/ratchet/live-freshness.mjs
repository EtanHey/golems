#!/usr/bin/env node
// CI watches the lead-run tier: latest guarded merge on master needs its live PASS receipt.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkVerdict } from './check-comment.mjs';
import { parseRows, findSticky, readVerdict } from './table.mjs';

export function checkLiveFreshness({ guardedHead, pulls, comments, expectedReal, allowedHeads = [guardedHead] }) {
  const pr = pulls.find(p => p.merged_at && p.base?.ref === 'master' && p.merge_commit_sha === guardedHead);
  if (!pr) return { ok: false, reason: 'latest guarded commit has no merged master PR' };
  if (!Number.isSafeInteger(expectedReal) || expectedReal < 1) return { ok: false, reason: 'master has no real live rows' };
  const receipt = readVerdict(findSticky(comments, 'golems-ratchet-live', ['EtanHey'])?.body ?? '', 'golems-ratchet-live');
  if (!receipt || !allowedHeads.includes(receipt.head)) return { ok: false, reason: 'missing or stale live receipt for latest guarded master merge' };
  return checkVerdict({ comments, marker: 'golems-ratchet-live', head: receipt.head,
    expectedReal, authors: ['EtanHey'], baseHasRows: true });
}

function run(binary, args) {
  const result = spawnSync(binary, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60000 });
  if (result.status !== 0) throw new Error(`${binary} ${args[0]} failed: ${result.stderr || result.error || result.signal}`);
  return result.stdout.trim();
}

export function recoveryCommand(mergedPR, leasePR) {
  const lease = /^\d+$/.test(String(leasePR ?? '')) ? leasePR : '"$(gh pr view --repo EtanHey/golems --json number -q .number)"';
  return `RATCHET_SKILL_CONFIG="$HOME/.golems/ratchet/installed-skills.json" "$HOME/Gits/golems/scripts/ratchet/live-rows.sh" --merged-pr ${mergedPR} --lease-pr ${lease} --lease-repo "$PWD"`;
}

export function main() {
  let mergedPR;
  const recovery = () => console.error(`Lead: install current master, then from an open lease-PR checkout run:\n${recoveryCommand(mergedPR ?? '$RATCHET_GUARDED_MERGED_PR', process.env.RATCHET_LEASE_PR)}`);
  try {
    if (process.env.RATCHET_PR_BASE || process.env.RATCHET_PR_HEAD) {
      if (!process.env.RATCHET_PR_BASE || !process.env.RATCHET_PR_HEAD) throw new Error('incomplete PR scope');
      const scope = spawnSync('bash', [fileURLToPath(new URL('./guarded-paths.sh', import.meta.url)), process.env.RATCHET_PR_BASE, process.env.RATCHET_PR_HEAD], { encoding: 'utf8' });
      if (scope.status === 1) { console.log('live-tier freshness PASS: non-guarded PR exempt'); return 0; }
      if (scope.status !== 0) throw new Error('cannot determine guarded PR paths');
    }
    // Same guarded directories as guarded-paths.sh. Candidate-only changes do not invalidate live.
    const guardedHead = run('git', ['log', '--first-parent', '-1', '--format=%H', 'origin/master', '--',
      'scripts/hooks/', 'skills/golem-powers/human-confirm-gate/', 'skills/golem-powers/git-guardian/',
      'skills/golem-powers/tmp-block/', 'scripts/repogolem/', 'scripts/ratchet/']);
    if (!/^[0-9a-f]{40}$/.test(guardedHead)) throw new Error('no guarded master commit');
    const rows = parseRows(JSON.parse(run('git', ['show', 'origin/master:scripts/ratchet/rows.json'])));
    const expectedReal = rows.rows.filter(r => r.runner === 'live' && r.kind === 'real').length;
    const api = path => JSON.parse(run('gh', ['api', '--paginate', '--slurp', `repos/EtanHey/golems/${path}`])).flat();
    const pulls = api(`commits/${guardedHead}/pulls`);
    const pr = pulls.find(p => p.merged_at && p.base?.ref === 'master' && p.merge_commit_sha === guardedHead);
    mergedPR = pr?.number;
    const comments = pr ? api(`issues/${pr.number}/comments`) : [];
    const allowedHeads = run('git', ['rev-list', '--first-parent', 'origin/master', `^${guardedHead}^`]).split('\n');
    const result = checkLiveFreshness({ guardedHead, pulls, comments, expectedReal, allowedHeads });
    console.log(`live-tier freshness ${guardedHead.slice(0, 8)}: ${result.ok ? 'PASS' : 'FAIL'}: ${result.reason}`);
    if (!result.ok) recovery();
    return result.ok ? 0 : 1;
  } catch (error) {
    console.error(`live-tier freshness FAIL: ${error.message}`);
    recovery();
    return 1;
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main();
