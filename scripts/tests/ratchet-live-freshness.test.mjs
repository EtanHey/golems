import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, copyFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parse } from 'yaml';
import { checkLiveFreshness, recoveryCommand } from '../ratchet/live-freshness.mjs';
import { evaluate } from '../ratchet/table.mjs';
mkdirSync(resolve('docs.local/l3-tests'), { recursive: true });
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const sha = 'a'.repeat(40);
const pass = { user: { login: 'EtanHey' }, body: `<!-- ratchet-table: golems-ratchet-live -->\n<!-- ratchet-verdict: ${JSON.stringify({ head: sha, ok: true, real_pass: 2, real_total: 2, bootstrap: false })} -->` };
const pulls = [{ number: 42, merged_at: '2026-10-07T00:00:00Z', merge_commit_sha: sha, base: { ref: 'master' } }];
const check = (comments, extra = {}) => checkLiveFreshness({ guardedHead: sha, pulls, comments, expectedReal: 2, ...extra });
test('latest guarded merge needs an exact-head passing lead receipt', () => {
  expect(check([pass]).ok).toBe(true);
  expect(check([]).ok).toBe(false);
  expect(check([pass], { guardedHead: 'b'.repeat(40) }).ok).toBe(false);
  expect(check([{ ...pass, user: { login: 'someone' } }]).ok).toBe(false);
  expect(check([{ ...pass, body: pass.body.replace('"ok":true', '"ok":false') }]).ok).toBe(false);
  expect(check([{ ...pass, body: pass.body.replace(sha, 'b'.repeat(40)) }]).ok).toBe(false);
  expect(check([pass], { expectedReal: 3 }).ok).toBe(false);
  expect(check([pass], { pulls: [{ ...pulls[0], base: { ref: 'other' } }] }).ok).toBe(false);
});

test('later unguarded master installation is valid, but branch/off-master or old receipts fail', () => {
  const later = 'c'.repeat(40);
  const receipt = { ...pass, body: pass.body.replace(sha, later) };
  expect(check([receipt], { allowedHeads: [later, sha] }).ok).toBe(true);
  expect(check([receipt]).ok).toBe(false);
  expect(check([pass], { guardedHead: later, pulls: [{ ...pulls[0], merge_commit_sha: later }], allowedHeads: [later] }).ok).toBe(false);
});

test('live receipts require boolean success and numeric row counts', () => {
  const receipt = fields => ({ ...pass, body: `<!-- ratchet-table: golems-ratchet-live -->\n<!-- ratchet-verdict: ${JSON.stringify({ head: sha, ok: true, real_pass: 2, real_total: 2, bootstrap: false, ...fields })} -->` });
  for (const ok of ["false", 1, null]) expect(check([receipt({ ok })]).ok).toBe(false);
  for (const count of ["false", "2", null, true, -1, 1.5]) {
    expect(check([receipt({ real_pass: count, real_total: count })], { expectedReal: count }).ok).toBe(false);
  }
  expect(check([receipt({ real_pass: 1, real_total: 1 })], { expectedReal: 1 }).ok).toBe(true);
});

test('failure supplies a runnable lead command, scoped to the merged and lease PRs', () => {
  expect(recoveryCommand(42, 77)).toBe('RATCHET_SKILL_CONFIG="$HOME/.golems/ratchet/installed-skills.json" "$HOME/Gits/golems/scripts/ratchet/live-rows.sh" --merged-pr 42 --lease-pr 77 --lease-repo "$PWD"');
});


test('real CLI exempts unguarded PR before API access and fails closed on a guarded PR', () => {
  const cwd = mkdtempSync(resolve('docs.local/l3-tests/scope-'));
  const git = (...args) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...cleanEnv, GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@localhost', GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@localhost' } }); expect(r.status).toBe(0); return r.stdout.trim(); };
  try {
    git('init', '-q'); writeFileSync(join(cwd, 'README.md'), 'base'); git('add', '.'); git('commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD');
    writeFileSync(join(cwd, 'README.md'), 'unguarded'); git('add', '.'); git('commit', '-qm', 'docs');
    const script = resolve(import.meta.dir, '../ratchet/live-freshness.mjs');
    const run = head => spawnSync('node', [script], { cwd, encoding: 'utf8', env: { ...cleanEnv, RATCHET_PR_BASE: base, RATCHET_PR_HEAD: head } });
    const exempt = run(git('rev-parse', 'HEAD'));
    expect(exempt.status).toBe(0); expect(exempt.stdout).toContain('non-guarded PR exempt');
    mkdirSync(join(cwd, 'scripts/hooks'), { recursive: true }); writeFileSync(join(cwd, 'scripts/hooks/test.py'), 'pass'); git('add', '.'); git('commit', '-qm', 'guarded');
    expect(run(git('rev-parse', 'HEAD')).status).toBe(1);
    expect(run('unknown').status).toBe(1);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('BASE workflow authenticates its consumer, preserves BASE identity and PR scope, and fails on absent/stale receipts', () => {
  const workflow = parse(readFileSync(resolve(import.meta.dir, '../../.github/workflows/ratchet.yml'), 'utf8'));
  const step = workflow.jobs.ratchet.steps.find(s => s.name === 'Measure the base');
  const cwd = mkdtempSync(resolve('docs.local/l3-tests/base-env-'));
  const baselineDir = join(cwd, 'base');
  const bin = join(cwd, 'bin');
  const base = 'b'.repeat(40), head = 'c'.repeat(40), guarded = 'd'.repeat(40);
  const rows = { schema: 1, rows: [
    { id: 'base-environment', metric: 'base cwd and event scope', kind: 'unit', runner: 'ci', direction: 'pass', ceiling: true,
      command: 'test -n "$GH_TOKEN" && test "$PWD" = "$RUNNER_TEMP/base" && test "$BASE_SHA" = "$FIXTURE_BASE" && test "$RATCHET_PR_BASE" = "$FIXTURE_BASE" && test "$RATCHET_PR_HEAD" = "$FIXTURE_HEAD" && test "$RATCHET_LEASE_PR" = 77' },
    JSON.parse(readFileSync(resolve(import.meta.dir, '../ratchet/rows.json'), 'utf8')).rows.find(r => r.id === 'live-tier-freshness'),
  ] };
  try {
    mkdirSync(bin); mkdirSync(join(baselineDir, 'scripts/ratchet'), { recursive: true });
    for (const file of ['run-rows.mjs', 'live-freshness.mjs', 'table.mjs', 'check-comment.mjs', 'guarded-paths.sh']) {
      copyFileSync(resolve(import.meta.dir, '../ratchet', file), join(baselineDir, 'scripts/ratchet', file));
    }
    writeFileSync(join(cwd, 'fixture-rows.json'), JSON.stringify(rows));
    // Only external setup/GitHub data are stubbed; execute the workflow shell, producer,
    // guarded-path consumer and freshness CLI. Unknown or HEAD-targeted Git calls fail.
    writeFileSync(join(bin, 'git'), `#!/usr/bin/env node
const a = process.argv.slice(2), e = process.env;
const fail = () => process.exit(2);
if (a[0] === 'cat-file' && a[2] === e.FIXTURE_BASE + ':scripts/ratchet/rows.json') process.exit(0);
if (a[0] === 'show' && a[1] === e.FIXTURE_BASE + ':scripts/ratchet/rows.json') {
  process.stdout.write(require('fs').readFileSync(e.RUNNER_TEMP + '/fixture-rows.json')); process.exit(0);
}
if (a[0] === 'worktree' && a[1] === 'add' && a[2] === '--detach' && a[3] === e.RUNNER_TEMP + '/base' && a[4] === e.FIXTURE_BASE) process.exit(0);
if (a[0] === 'diff' && a[1] === '--name-only' && a[2] === e.FIXTURE_BASE + '...' + e.FIXTURE_HEAD) {
  console.log(e.FIXTURE_UNGUARDED ? 'README.md' : 'scripts/hooks/guard.py'); process.exit(0);
}
if (a[0] === 'log' && a.includes('origin/master')) { console.log(e.FIXTURE_GUARDED); process.exit(0); }
if (a[0] === 'show' && a[1] === 'origin/master:scripts/ratchet/rows.json') {
  console.log(JSON.stringify({schema: 1, rows: [{id:'live', metric:'live', kind:'real', runner:'live', direction:'pass', ceiling:true, bug_sha:e.FIXTURE_BASE, fix_sha:e.FIXTURE_GUARDED, command:'false'}]})); process.exit(0);
}
if (a[0] === 'rev-list' && a[2] === 'origin/master' && a[3] === '^' + e.FIXTURE_GUARDED + '^') { console.log(e.FIXTURE_GUARDED); process.exit(0); }
fail();
`, { mode: 0o755 });
    writeFileSync(join(bin, 'bun'), '#!/bin/sh\n[ "$1" = install ] && [ "$PWD" = "$RUNNER_TEMP/base" ]\n', { mode: 0o755 });
    writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node
const a = process.argv.slice(2), e = process.env;
if (!e.GH_TOKEN || e.FIXTURE_UNGUARDED || a[0] !== 'api' || a[1] !== '--paginate' || a[2] !== '--slurp') process.exit(1);
if (a[3] === 'repos/EtanHey/golems/commits/' + e.FIXTURE_GUARDED + '/pulls') {
  console.log(JSON.stringify([[{number:42, merged_at:'2026-10-07T00:00:00Z', base:{ref:'master'}, merge_commit_sha:e.FIXTURE_GUARDED}]]));
} else if (a[3] === 'repos/EtanHey/golems/issues/42/comments') {
  const head = e.FIXTURE_RECEIPT === 'stale' ? e.FIXTURE_BASE : e.FIXTURE_GUARDED;
  const body = '<!-- ratchet-table: golems-ratchet-live -->\\n<!-- ratchet-verdict: ' + JSON.stringify({head, ok:true, real_pass:1, real_total:1, bootstrap:false}) + ' -->';
  console.log(JSON.stringify([e.FIXTURE_RECEIPT === 'missing' ? [] : [{user:{login:'EtanHey'}, body}]]));
} else process.exit(2);
`, { mode: 0o755 });
    const values = { '${{ github.token }}': 'fixture-presence-only', '${{ github.event.pull_request.base.sha }}': base,
      '${{ github.event.pull_request.head.sha }}': head, '${{ github.event.pull_request.number }}': '77' };
    const stepEnv = Object.fromEntries(Object.entries(step.env).map(([key, expression]) => {
      expect(Object.hasOwn(values, expression)).toBe(true);
      return [key, values[expression]];
    }));
    // Exclude inherited real credentials/scope: this test never invokes gh auth or live APIs.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(GIT_|GITHUB_|GH_|RATCHET_|FIXTURE_)/.test(key)));
    const run = (receipt, extra = {}) => {
      rmSync(join(cwd, 'baseline.json'), { force: true });
      const shell = spawnSync('bash', ['-c', step.run], { cwd, encoding: 'utf8', timeout: 20000, env: { ...env, ...stepEnv,
        PATH: `${bin}:${env.PATH}`, RUNNER_TEMP: cwd, FIXTURE_BASE: base, FIXTURE_HEAD: head,
        FIXTURE_GUARDED: guarded, FIXTURE_RECEIPT: receipt, ...extra } });
      expect(shell.status).toBe(0);
      const results = JSON.parse(readFileSync(join(cwd, 'baseline.json'), 'utf8'));
      expect(results.head_sha).toBe(base); expect(results.runner).toBe('ci');
      expect(results.results['base-environment'].value).toBe(extra.GH_TOKEN === '' ? false : true);
      return { results, output: shell.stdout + shell.stderr };
    };
    expect(run('fresh').results.results['live-tier-freshness'].value).toBe(true);
    expect(run('fresh', { GH_TOKEN: '' }).results.results['live-tier-freshness'].value).toBe(false);
    for (const receipt of ['missing', 'stale']) {
      const { results, output } = run(receipt);
      expect(results.results['live-tier-freshness'].value).toBe(false);
      expect(output).toContain('missing or stale live receipt');
      expect(evaluate({ rows, baseRows: rows, results, head: base, runner: 'ci' }).ok).toBe(false);
    }
    const unguarded = run('missing', { FIXTURE_UNGUARDED: '1' });
    expect(unguarded.results.results['live-tier-freshness'].value).toBe(true);
    expect(unguarded.output).toContain('non-guarded PR exempt');
    // Token stays in this step, using the existing permissions and event.
    expect(step.if).toBe("github.event_name == 'pull_request'");
    expect(step.env.GH_TOKEN).toBe('${{ github.token }}');
    expect(workflow.env?.GH_TOKEN).toBeUndefined();
    expect(workflow.jobs.ratchet.env?.GH_TOKEN).toBeUndefined();
    expect(workflow.permissions).toEqual({ contents: 'read', 'pull-requests': 'write' });
    expect(workflow.on.pull_request_target).toBeUndefined();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}, 30_000);
