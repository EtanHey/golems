#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { machineHost } from '../hooks/machine-host.mjs';
import { runRows } from './run-rows.mjs';
import { baseRowsAt, evaluate, parseRows, renderTable } from './table.mjs';

const root = process.cwd();
const quote = s => `'${s.replaceAll("'", "'\\''")}'`;
function run(cmd, args, cwd = root) {
  return spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}
function git(args) {
  const r = run('git', args);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr || r.error}`);
  return r.stdout.trim();
}
const hint = reason => console.log(`ratchet: Mac rows not run here (${reason}); on the M4 run scripts/ratchet/local-run.sh --pr <N> after opening/pushing the PR`);

function measure(cwd, head, base, pr) {
  const rowsPath = join(cwd, 'scripts/ratchet/rows.json');
  const rows = parseRows(JSON.parse(readFileSync(rowsPath, 'utf8')));
  const baseRows = baseRowsAt(rowsPath, base);
  const started = Date.now();
  // Freshness observes master, not this push. Bound its network wait; keep its measured line.
  const measured = { ...rows, rows: rows.rows.map(r => r.id === 'live-tier-freshness' ? { ...r, timeout_s: 15 } : r) };
  const previous = { RATCHET_PR_BASE: process.env.RATCHET_PR_BASE, RATCHET_PR_HEAD: process.env.RATCHET_PR_HEAD };
  let results;
  try {
    Object.assign(process.env, { RATCHET_PR_BASE: base, RATCHET_PR_HEAD: head });
    results = runRows({ rows: measured, head, cwd, runner: 'ci', log: (line, r) => {
      console.log(line); if (r.status !== 0) process.stderr.write(`${r.stdout ?? ''}${r.stderr ?? ''}`);
    } });
  } finally {
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  const evaluation = evaluate({ rows, baseRows, bootstrap: !baseRows, results, head, runner: 'ci', prBody: pr?.body ?? '' });
  console.log(renderTable(evaluation, { marker: 'golems-ratchet-prepush', title: 'Local CI rows (live-tier-freshness informational)' }));
  console.log(`ratchet: CI rows measured in ${((Date.now() - started) / 1000).toFixed(2)}s`);
  const failed = evaluation.rows.filter(r => r.id !== 'live-tier-freshness' && !['PASS', 'WARN'].includes(r.status));
  for (const row of failed) console.error(`ratchet: BLOCKED ${row.id} ${row.status}; local command: cd ${quote(cwd)} && ${row.command}`);
  if (failed.length || !evaluation.rows.length || evaluation.loosened.some(r => !r.ruled)) throw new Error('CI ratchet failed before push');
  console.log('ratchet: local CI gate PASS (live-tier-freshness informational)');
}

function mac(cwd, head, pr) {
  if (process.env.GOLEMS_PREPUSH_RATCHET === '0') {
    console.error('ratchet: WARNING GOLEMS_PREPUSH_RATCHET=0 skips Mac rows ONLY (CI rows still required)');
    // Use the existing tmp-block hook bypass ledger and its record shape; never silently skip.
    const ledger = (process.env.TMP_BLOCK_LEDGER || '~/.claude/logs/tmp-block-ledger.jsonl').replace(/^~(?=\/)/, homedir());
    mkdirSync(dirname(ledger), { recursive: true });
    appendFileSync(ledger, JSON.stringify({ ts: new Date().toISOString(), tool: 'pre-push', targets: [],
      session_id: process.env.CODEX_THREAD_ID ?? '', cwd, hatch: 'GOLEMS_PREPUSH_RATCHET=0', command: `local-run.sh --pr ${pr?.number ?? '<N>'} --head ${head}` }) + '\n');
    hint('explicit logged bypass'); return;
  }
  if (machineHost() !== 'mbp') { hint('not the M4 receipt host'); return; }
  if (!pr) { hint('no open PR or gh unavailable'); return; }
  const tools = ['gh', 'python3', 'bun', 'ssh-keygen', 'chflags'];
  const missing = tools.filter(t => run('sh', ['-c', `command -v ${t}`]).status !== 0);
  if (missing.length) { hint(`missing tools: ${missing.join(', ')}`); return; }
  const r = spawnSync('bash', [join(cwd, 'scripts/ratchet/local-run.sh'), '--pr', String(pr.number), '--head', head], { cwd, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`Mac rows failed for ${head}; run scripts/ratchet/local-run.sh --pr ${pr.number} --head ${head}`);
}

try {
  const updates = (process.env.GOLEMS_PREPUSH_UPDATES ?? '').trim().split('\n').filter(Boolean);
  for (const line of updates) {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4 || !/^[0-9a-f]{40,64}$/.test(fields[1])) throw new Error('malformed pre-push ref update');
    const [, head, remoteRef] = fields;
    if (/^0+$/.test(head)) continue;
    const base = git(['rev-parse', '--verify', 'origin/master^{commit}']);
    const guarded = run('bash', ['scripts/ratchet/guarded-paths.sh', base, head]);
    process.stdout.write(guarded.stdout ?? '');
    if (guarded.status === 1) continue;
    if (guarded.status !== 0) throw new Error(guarded.stderr || 'cannot determine guarded paths');
    const branch = remoteRef.startsWith('refs/heads/') ? remoteRef.slice(11) : null;
    let pr = null;
    const localTip = branch ? run('git', ['rev-parse', '--verify', remoteRef]) : null;
    if (localTip?.status === 0 && localTip.stdout.trim() === head) {
      const r = run('gh', ['pr', 'view', branch, '--json', 'number,headRefName,state,body']);
      if (r.status === 0) {
        const found = JSON.parse(r.stdout);
        if (found.state === 'OPEN' && found.headRefName === branch) pr = found;
      }
    }
    let scratch = null, added = false, cwd = root;
    try {
      if (git(['rev-parse', 'HEAD']) !== head || git(['status', '--porcelain'])) {
        const parent = resolve('docs.local/prepush-ratchet'); mkdirSync(parent, { recursive: true });
        scratch = mkdtempSync(join(parent, 'head-')); cwd = join(scratch, 'tree');
        git(['worktree', 'add', '--detach', cwd, head]);
        added = true;
        const installed = run('bun', ['install', '--frozen-lockfile', '--ignore-scripts'], cwd);
        if (installed.status !== 0) throw new Error(`candidate dependencies: ${installed.stderr}`);
      }
      measure(cwd, head, base, pr);
      mac(cwd, head, pr);
    } finally {
      if (scratch) {
        const removed = added ? run('git', ['worktree', 'remove', cwd]) : { status: 0 };
        if (removed.status === 0) rmSync(scratch, { recursive: true, force: true });
        else { console.error(`ratchet: cleanup failed; retained ${cwd}: ${removed.stderr}`); process.exitCode = 1; }
      }
    }
  }
} catch (error) {
  console.error(`ratchet: ${error.message}`); process.exitCode = 1;
}
