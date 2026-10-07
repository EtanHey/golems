import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { checkLiveFreshness, recoveryCommand } from '../ratchet/live-freshness.mjs';
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
