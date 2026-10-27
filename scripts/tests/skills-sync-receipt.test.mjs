import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildSkillsReceipt, snapshotSkills } from '../lib/skills-sync-receipt.mjs';
import { assess, validate } from '../lib/install-receipt-core.mjs';
import { collectStatus } from '../install-receipt-status.mjs';

function fixture(fn) {
  mkdirSync('docs.local', { recursive: true });
  const home = mkdtempSync(resolve('docs.local/skills-receipt-'));
  const source = join(home, 'golems');
  const git = (...args) => execFileSync('git', ['-C', source, '-c', 'user.name=F', '-c', 'user.email=f@localhost', ...args], { encoding: 'utf8' }).trim();
  mkdirSync(source); git('init', '-q');
  writeFileSync(join(source, 'SKILL.md'), 'fixture'); git('add', '.'); git('commit', '-qm', 'fixture');
  const commit = git('rev-parse', 'HEAD');
  for (const root of ['.claude/skills', '.agents/skills', '.codex/skills']) {
    mkdirSync(join(home, root), { recursive: true }); symlinkSync(source, join(home, root, 'demo'));
  }
  const owner = { pin_sha: commit, command: 'fixture --status', exit: 0, drift: false, settings_drift: false };
  const parity = { command: 'fixture parity', exit: 0, pass: true, measurement: 'live' };
  const build = () => buildSkillsReceipt({ mode: 'checkout', source, alias: 'mbp', owner, parity,
    snapshot: snapshotSkills({ home, source, mode: 'checkout' }) });
  try { fn({ home, source, git, commit, build }); } finally { rmSync(home, { recursive: true, force: true }); }
}
test('checkout roots resolve to one commit; clean status and parity are LIVE without processes', () => fixture(({ source, commit, build }) => {
  const r = build(); validate(r);
  assert.equal(r.install_source.mode, 'checkout'); assert.equal(r.install_source.path, source);
  assert.equal(r.target.released_sha, commit); assert.equal(r.installed.embedded_commit, commit);
  assert.equal(r.install_source.roots.length, 3); assert.deepEqual(r.activation.processes, []);
  assert.equal(assess(r)[0], 'LIVE');
  for (const mutate of [x => { x.activation.skill_parity.pass = false; }, x => { x.install_source.owner_status.drift = true; },
    x => { x.install_source.owner_status.settings_drift = true; }, x => { x.install_source.owner_status.exit = 1; },
    x => { x.activation.skill_parity.measurement = 'fixture'; }]) {
    const bad = structuredClone(r); mutate(bad); assert.equal(assess(bad)[0], 'INSTALLED_NOT_ACTIVE');
  }
}));
test('tree hash resolves links, ignores excluded directories, and sorts relative file names', () => fixture(({ source, home, build }) => {
  const hash = () => build().install_source.roots.find(r => r.path === join(home, '.claude/skills')).tree_sha256;
  const before = hash();
  mkdirSync(join(source, '__pycache__')); writeFileSync(join(source, '__pycache__/cache'), 'ignored');
  mkdirSync(join(home, '.claude/skills/.system')); writeFileSync(join(home, '.claude/skills/.system/private'), 'ignored');
  assert.equal(hash(), before);
  writeFileSync(join(source, 'b'), 'B'); writeFileSync(join(source, 'a'), 'A'); const ordered = hash();
  rmSync(join(source, 'a')); rmSync(join(source, 'b')); writeFileSync(join(source, 'a'), 'A'); writeFileSync(join(source, 'b'), 'B');
  assert.equal(hash(), ordered); assert.notEqual(ordered, before);
  writeFileSync(join(source, 'SKILL.md'), 'changed target'); assert.notEqual(hash(), ordered);
}));
test('mixed checkout commits yield MISMATCH naming the affected roots', () => fixture(({ source, home, git, build }) => {
  const other = join(home, 'other'); execFileSync('git', ['clone', '-q', source, other]);
  git('commit', '--allow-empty', '-qm', 'different commit');
  rmSync(join(home, '.codex/skills/demo')); symlinkSync(other, join(home, '.codex/skills/demo'));
  const r = build(); validate(r); assert.equal(assess(r)[0], 'MISMATCH');
  assert.match(r.reasons.join(' '), /\.codex\/skills/);
}));
test('skills schema rejects relative roots and malformed digests', () => fixture(({ build }) => {
  for (const mutate of [r => { r.install_source.roots[0].path = 'relative'; },
    r => { r.install_source.roots[0].tree_sha256 = 'bad'; }, r => { r.product = 'other'; }]) {
    const r = build(); mutate(r); assert.throws(() => validate(r));
  }
}));
test('release-channel identity comes from release.json; roots include optional Gemini and CLI wrappers', () => fixture(({ source, home, commit, build }) => {
  const prefix = join(home, '.golems'); mkdirSync(join(prefix, 'bin'), { recursive: true });
  writeFileSync(join(prefix, 'release.json'), JSON.stringify({ commit, version: '2026.10.27-' + commit.slice(0, 7) }));
  writeFileSync(join(prefix, 'bin/golems-cli'), 'release wrapper');
  mkdirSync(join(home, '.gemini/config/skills'), { recursive: true });
  const base = build();
  const r = buildSkillsReceipt({ mode: 'release-channel', source, alias: 'm1', version: '2026.10.27-' + commit.slice(0, 7),
    owner: base.install_source.owner_status, parity: base.activation.skill_parity,
    snapshot: snapshotSkills({ mode: 'release-channel', source, home, prefix }) });
  validate(r); assert.equal(assess(r)[0], 'LIVE'); assert.equal(r.target.released_sha, commit);
  assert.ok(r.install_source.roots.some(r => r.path.endsWith('.gemini/config/skills')));
  assert.ok(r.install_source.roots.some(r => r.path === join(prefix, 'bin')));
}));
test('status rechecks checkout trees; no release.json or process needed; drift never CURRENT', () => fixture(({ source, home, commit, build }) => {
  const r = build();
  const rows = () => collectStatus({ products: { golems: 'EtanHey/golems' }, localHostname: 'fixture-mbp',
    localReader: () => ({ golems: r }), remoteReader: () => ({}),
    releaseReader: () => ({ version: 'release', tag: 'vrelease', released_sha: commit }),
    resolver: { compareAncestry: () => 'identical' },
    skillsReader: () => snapshotSkills({ mode: 'checkout', source, home }) });
  assert.equal(rows()[0].status, 'CURRENT'); assert.equal(rows()[1].status, 'NO-RECEIPT');
  writeFileSync(join(source, 'SKILL.md'), 'drift'); assert.equal(rows()[0].status, 'MISMATCH');
}));
