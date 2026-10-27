import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildSkillsReceipt, buildHooksReceipt } from '../lib/skills-sync-receipt.mjs';
import { validate, assess } from '../lib/install-receipt-core.mjs';

const skill = 'a'.repeat(40), pin = 'b'.repeat(40);
const owner = { pin_sha: pin, command: 'fixture --status', exit: 0, drift: false, settings_drift: false };
function skills(mode = 'checkout') {
  return buildSkillsReceipt({ source: '/fixture/golems', mode, alias: 'mbp', owner,
    parity: { command: 'fixture parity', pass: true, exit: 0, measurement: 'live' },
    snapshot: { commit: skill, roots: [{ path: '/fixture/skills', tree_sha256: 'c'.repeat(64) }],
      root_commits: [{ path: '/fixture/skills', commits: [skill], unresolved: false }], excluded: [] } });
}
test('separate golems artifacts validate without coupling the skills commit to the hook pin', () => {
  const s = skills(), h = buildHooksReceipt({ source: '/fixture/.worktrees/hooks-live', alias: 'mbp', owner });
  for (const r of [s, h]) { validate(r); assert.equal(assess(r)[0], 'LIVE'); assert.equal(r.target.ancestry, undefined); }
  assert.equal(s.target.released_sha, skill); assert.equal(h.target.released_sha, pin);
  assert.equal(s.install_source.owner_status.pin_sha, undefined);
  h.install_source.owner_status = { ...owner, drift: true }; assert.equal(assess(h)[0], 'INSTALLED_NOT_ACTIVE');
});
test('all golems artifact/mode latest pointers coexist without overwriting each other', () => {
  mkdirSync('docs.local', { recursive: true }); const home = mkdtempSync(resolve('docs.local/golems-core-'));
  try {
    const receipts = [skills(), skills('release-channel'), buildHooksReceipt({ source: '/fixture/.worktrees/hooks-live', alias: 'mbp', owner })];
    for (const r of receipts) {
      const result = spawnSync(process.execPath, [resolve('scripts/install-receipt.mjs'), 'write', '-'], {
        input: JSON.stringify(r), encoding: 'utf8', env: { ...process.env, HOME: home } });
      assert.equal(result.status, 0, result.stderr);
    }
    for (const r of receipts) {
      const file = join(home, '.local/state/golems/install-receipts/golems', `latest-${r.artifact_kind}-${r.install_source.mode}.json`);
      const saved = JSON.parse(readFileSync(file)); assert.equal(saved.installed.embedded_commit, r.installed.embedded_commit);
    }
  } finally { rmSync(home, { recursive: true, force: true }); }
});
