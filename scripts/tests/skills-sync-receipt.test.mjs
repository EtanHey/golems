import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, realpathSync, symlinkSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import * as receipts from '../lib/skills-sync-receipt.mjs';
import { buildSkillsReceipt, snapshotSkills } from '../lib/skills-sync-receipt.mjs';
import { assess, validate } from '../lib/install-receipt-core.mjs';
import { collectStatus, hostAlias, readRemote, readLocal } from '../install-receipt-status.mjs';
function fixture(fn) {
  mkdirSync('docs.local', { recursive: true });
  const home = mkdtempSync(resolve('docs.local/skills-receipt-'));
  const source = join(home, 'Gits/golems'), skill = join(source, 'skills/golem-powers/demo');
  const git = (...args) => execFileSync('git', ['-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', ...args], { encoding: 'utf8' }).trim();
  mkdirSync(skill, { recursive: true }); git('init', '-q');
  writeFileSync(join(skill, 'SKILL.md'), 'fixture'); git('add', '.'); git('commit', '-qm', 'fixture');
  const commit = git('rev-parse', 'HEAD');
  for (const root of ['.claude/skills', '.agents/skills', '.codex/skills']) {
    mkdirSync(join(home, root), { recursive: true }); symlinkSync(skill, join(home, root, 'demo'));
  }
  const owner = { pin_sha: commit, command: 'fixture --status', exit: 0, drift: false, settings_drift: false };
  const parity = { command: 'fixture parity', exit: 0, pass: true, measurement: 'live' };
  const build = () => buildSkillsReceipt({ mode: 'checkout', source, alias: 'mbp', owner, parity,
    snapshot: snapshotSkills({ home, source, mode: 'checkout' }) });
  try { fn({ home, source, skill, git, commit, owner, parity, build }); } finally { rmSync(home, { recursive: true, force: true }); }
}
test('checkout roots resolve to one commit; clean status and parity are LIVE without processes', () => fixture(({ source, commit, build }) => {
  const r = build(); validate(r);
  assert.equal(r.install_source.mode, 'checkout'); assert.equal(r.install_source.path, source);
  assert.equal(r.target.released_sha, commit); assert.equal(r.installed.embedded_commit, commit);
  assert.equal(r.install_source.roots.length, 3); assert.deepEqual(r.activation.processes, []);
  assert.equal(assess(r)[0], 'LIVE');
}));
test('checkout and release latest pointers coexist for the same host/product', () => fixture(({ home, source, build }) => {
  const checkout = build(), release = structuredClone(checkout); release.install_source.mode = 'release-channel';
  release.target.version = 'release-fixture'; release.installed.version = 'release-fixture';
  for (const r of [checkout, release]) {
    const result = spawnSync(process.execPath, [resolve('scripts/install-receipt.mjs'), 'write', '-'], {
      input: JSON.stringify(r), encoding: 'utf8', env: { ...process.env, HOME: home } });
    assert.equal(result.status, 0, result.stderr);
  }
  const dir = join(home, '.local/state/golems/install-receipts/golems');
  assert.equal(JSON.parse(readFileSync(join(dir, 'latest-skills-sync-checkout.json'))).install_source.mode, 'checkout');
  assert.equal(JSON.parse(readFileSync(join(dir, 'latest-skills-sync-release-channel.json'))).install_source.mode, 'release-channel');
  assert.equal(existsSync(join(dir, 'latest.json')), false);
  writeFileSync(join(source, '..', 'release.json'), JSON.stringify({ commit: release.installed.embedded_commit }));
  const previous = process.env.HOME;
  try {
    process.env.HOME = home;
    for (const skillsMode of ['checkout', 'release-channel']) {
      assert.equal(readLocal(['golems'], { skillsMode }).golems.install_source.mode, skillsMode);
      const remote = readRemote(['golems'], (file, args) => args.at(-1).includes('/release.json')
        ? JSON.stringify({ commit: release.installed.embedded_commit }) : readFileSync(join(dir, `latest-skills-sync-${skillsMode}.json`), 'utf8'), { skillsMode });
      assert.equal(remote.golems.install_source.mode, skillsMode);
    }
  } finally { process.env.HOME = previous; }
}));
test('tree hash resolves links, ignores excluded directories, and sorts relative file names', () => fixture(({ source, skill, home, build }) => {
  const hash = () => build().install_source.roots.find(r => r.path === join(home, '.claude/skills')).tree_sha256;
  const before = hash();
  mkdirSync(join(skill, '__pycache__')); writeFileSync(join(skill, '__pycache__/cache'), 'ignored');
  mkdirSync(join(home, '.claude/skills/.system')); writeFileSync(join(home, '.claude/skills/.system/private'), 'ignored');
  assert.equal(hash(), before);
  writeFileSync(join(skill, 'b'), 'B'); writeFileSync(join(skill, 'a'), 'A'); const ordered = hash();
  rmSync(join(skill, 'a')); rmSync(join(skill, 'b')); writeFileSync(join(skill, 'a'), 'A'); writeFileSync(join(skill, 'b'), 'B');
  assert.equal(hash(), ordered); assert.notEqual(ordered, before);
  writeFileSync(join(skill, 'SKILL.md'), 'changed target'); assert.notEqual(hash(), ordered);
}));
test('mixed checkout commits yield MISMATCH naming only the affected root', () => fixture(({ source, home, git, build }) => {
  const other = join(home, 'other/golems'); mkdirSync(join(home, 'other'));  execFileSync('git', ['clone', '-q', source, other]);
  git('commit', '--allow-empty', '-qm', 'different commit');
  rmSync(join(home, '.codex/skills/demo')); symlinkSync(join(other, 'skills/golem-powers/demo'), join(home, '.codex/skills/demo'));
  const r = build(); validate(r); assert.equal(assess(r)[0], 'MISMATCH');
  const affected = join(home, '.codex/skills');
  assert.ok(r.reasons.every(reason => reason.includes(affected)));
  assert.deepEqual(r.install_source.roots.filter(root => r.reasons.some(reason => reason.includes(root.path))).map(root => root.path), [affected]);
}));
test('checkout vendor symlinks are hashed and disclosed without unresolved commit identity', () => fixture(({ home, source, commit, build }) => {
  const before = build(), vendor = join(home, '.golems/vendor/design-skills/57c50afa/demo');
  mkdirSync(vendor, { recursive: true }); writeFileSync(join(vendor, 'SKILL.md'), 'vendor design skill');
  const links = ['.claude/skills/design', '.codex/skills/design'].map(root => join(home, root));
  for (const link of links) symlinkSync(vendor, link);
  // Keep Git from finding the surrounding test runner checkout above the fake HOME.
  const previous = process.env.GIT_CEILING_DIRECTORIES;
  let after;
  try {
    process.env.GIT_CEILING_DIRECTORIES = home;
    assert.throws(() => execFileSync('git', ['-C', vendor, 'rev-parse', 'HEAD'], { stdio: 'pipe' }));
    after = build();
  } finally {
    if (previous === undefined) delete process.env.GIT_CEILING_DIRECTORIES; else process.env.GIT_CEILING_DIRECTORIES = previous;
  }
  assert.equal(after.install_source.root_commits.some(root => root.unresolved), false);
  validate(after); assert.equal(assess(after)[0], 'LIVE');
  assert.equal(after.target.released_sha, before.target.released_sha);
  assert.notEqual(after.installed.content_sha256, before.installed.content_sha256);
  assert.deepEqual(after.install_source.excluded.filter(row => links.includes(row.path)), links.map(path => ({ path, kind: 'vendor', count: 1, resolved_target: realpathSync(vendor) })));
  writeFileSync(join(vendor, 'SKILL.md'), 'changed vendor bytes');
  assert.notEqual(build().installed.content_sha256, after.installed.content_sha256);
  const prefix = join(home, '.golems'); mkdirSync(join(prefix, 'bin'));
  writeFileSync(join(prefix, 'release.json'), JSON.stringify({ commit }));
  const release = snapshotSkills({ mode: 'release-channel', source, home, prefix });
  assert.deepEqual(release.root_commits, []);
  assert.equal(release.excluded.some(row => links.includes(row.path)), false);
}));
test('non-golems entries are disclosed but only owned links contribute commit identity', () => fixture(({ home, build }) => {
  const before = build();
  const vendor = join(home, '.claude/skills/vendor'); mkdirSync(vendor); writeFileSync(join(vendor, 'SKILL.md'), 'vendor');
  const coach = join(home, 'coach'); mkdirSync(coach); writeFileSync(join(coach, 'SKILL.md'), 'external coach');
  const coachLink = join(home, '.agents/skills/coach'); symlinkSync(coach, coachLink);
  const after = build(); validate(after); assert.equal(assess(after)[0], 'LIVE');
  assert.equal(after.target.released_sha, before.target.released_sha);
  assert.notEqual(after.installed.content_sha256, before.installed.content_sha256);
  assert.deepEqual(after.install_source.excluded.filter(x => [vendor, coachLink].includes(x.path)), [
    { path: vendor, kind: 'directory', count: 1 }, { path: coachLink, kind: 'symlink', count: 1 }]);
}));
test('hooks pin BEHIND and owned skills commit AHEAD are independent artifacts', () => fixture(({ source, home, git, commit, owner, build }) => {
  git('commit', '--allow-empty', '-qm', 'release'); const released = git('rev-parse', 'HEAD');
  git('commit', '--allow-empty', '-qm', 'skills ahead'); const skills = build();
  const hooks = receipts.buildHooksReceipt({ source: join(source, '.worktrees/hooks-live'), alias: 'mbp', owner });
  validate(hooks); assert.equal(assess(skills)[0], 'LIVE'); assert.equal(assess(hooks)[0], 'LIVE');
  assert.equal(hooks.target.released_sha, commit); assert.notEqual(skills.target.released_sha, commit);
  const rows = collectStatus({ products: { golems: 'EtanHey/golems' }, localHostname: 'fixture-mbp',
    localReader: () => ({ golems: skills, 'golems:hooks-sync': hooks }), remoteReader: () => ({}),
    releaseReader: () => ({ version: 'release', tag: 'vrelease', released_sha: released }),
    resolver: { compareAncestry: () => 'identical' }, hooksReader: () => owner,
    skillsReader: () => snapshotSkills({ mode: 'checkout', source, home }),
    comparisonReader: (repo, latest, installed) => installed === commit ? 'behind' : 'ahead' });
  assert.deepEqual(rows.filter(r => r.host === 'm4-max').map(r => [r.artifact_kind, r.status]), [['skills-sync', 'AHEAD'], ['hooks-sync', 'BEHIND']]);
}));
test('broken root links fail explicitly with the exact installed link name', () => fixture(({ source, home }) => {
  const link = join(home, '.agents/skills/broken'); symlinkSync(join(home, 'missing-target'), link);
  assert.throws(() => snapshotSkills({ mode: 'checkout', source, home }), error =>
    error.message.includes('broken symlink') && error.message.includes(link));
}));
test('receipt-only system exclusion leaves ratchet content inventory unchanged', () => fixture(({ source, skill, home, build }) => {
  const before = build().installed.content_sha256;
  mkdirSync(join(skill, '.system')); writeFileSync(join(skill, '.system/support.txt'), 'ratchet-visible');
  const code = "import runpy,json,sys; from pathlib import Path; m=runpy.run_path(sys.argv[1]); print(json.dumps(m['content_files'](Path(sys.argv[2]))))";
  const files = JSON.parse(execFileSync('python3', ['-B', '-c', code, resolve('scripts/ratchet/installed-skills.py'), skill]));
  assert.ok(files['.system/support.txt']);
  assert.equal(build().installed.content_sha256, before);
}));
test('release-channel identity comes from release.json; roots include optional Gemini and CLI wrappers', () => fixture(({ source, skill, home, commit, build }) => {
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
test('status rechecks checkout trees; no release.json or process needed; drift never CURRENT', () => fixture(({ source, skill, home, commit, build }) => {
  const r = build();
  const rows = () => collectStatus({ products: { golems: 'EtanHey/golems' }, localHostname: 'fixture-mbp',
    localReader: () => ({ golems: r }), remoteReader: () => ({}),
    releaseReader: () => ({ version: 'release', tag: 'vrelease', released_sha: commit }),
    resolver: { compareAncestry: () => 'identical' },
    skillsReader: () => snapshotSkills({ mode: 'checkout', source, home }) });
  assert.equal(rows()[0].status, 'CURRENT'); assert.equal(rows()[1].status, 'NO-RECEIPT');
  writeFileSync(join(skill, 'SKILL.md'), 'drift'); assert.equal(rows()[0].status, 'MISMATCH');
}));
test('new M1 release without its receipt is NO-RECEIPT; reads use fake SSH only', () => fixture(({ build, commit }) => {
  const old = build(); old.install_source.mode = 'release-channel'; old.host.alias = 'm1';
  const read = current => readRemote(['golems'], (file, args) => {
    assert.equal(file, 'ssh'); assert.match(args.at(-1), /^cat -- /);
    return JSON.stringify(args.at(-1).includes('release.json') ? { commit: current } : old);
  });
  assert.equal(read('f'.repeat(40)).golems, null);
  assert.equal(read(commit).golems.installed.embedded_commit, commit);
  assert.equal(hostAlias('Locals-MacBook-Pro.local'), 'm1-pro');
}));

test('receipt readers bind artifact kind and requested mode, retaining generic legacy receipts', () => fixture(({ home, source, owner, build }) => {
  const skills = build();
  const hooks = receipts.buildHooksReceipt({ source, alias: 'mbp', owner });
  const release = structuredClone(skills); release.install_source.mode = 'release-channel';
  const legacy = { ...hooks, artifact_kind: 'source-checkout' };
  const dir = join(home, '.local/state/golems/install-receipts/golems');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(source, '..', 'release.json'), JSON.stringify({ commit: release.installed.embedded_commit }));
  const previous = process.env.HOME;
  try {
    process.env.HOME = home;
    for (const skillsMode of ['checkout', 'release-channel']) {
      const matching = skillsMode === 'checkout' ? skills : release;
      const wrongMode = skillsMode === 'checkout' ? release : skills;
      for (const [value, accepted] of [[hooks, false], [wrongMode, false], [matching, true], [legacy, true]]) {
        writeFileSync(join(dir, `latest-skills-sync-${skillsMode}.json`), JSON.stringify(value));
        writeFileSync(join(dir, 'latest-hooks-sync-worktree-pin.json'), JSON.stringify(value));
        const local = readLocal(['golems'], { skillsMode });
        const remote = readRemote(['golems'], (_file, args) => JSON.stringify(
          args.at(-1).includes('/release.json') ? { commit: release.installed.embedded_commit } : value), { skillsMode });
        for (const result of [local, remote]) {
          assert.deepEqual(result.golems, accepted ? value : null, `${skillsMode}: ${value.artifact_kind}/${value.install_source.mode}`);
          assert.deepEqual(result['golems:hooks-sync'], value.artifact_kind === 'hooks-sync' ? hooks : null);
        }
      }
    }
    rmSync(join(dir, 'latest-skills-sync-checkout.json'));
    rmSync(join(dir, 'latest-skills-sync-release-channel.json'));
    writeFileSync(join(dir, 'latest.json'), JSON.stringify(legacy));
    assert.deepEqual(readLocal(['golems']).golems, legacy);
    const missing = Object.assign(Error('missing'), { status: 1, stderr: 'No such file or directory' });
    const remote = readRemote(['golems'], (_file, args) => {
      if (!args.at(-1).endsWith('/latest.json"')) throw missing;
      return JSON.stringify(legacy);
    });
    assert.deepEqual(remote.golems, legacy);
    assert.equal(remote['golems:hooks-sync'], null);
    for (const value of [hooks, release]) {
      writeFileSync(join(dir, 'latest.json'), JSON.stringify(value));
      assert.equal(readLocal(['golems'], { skillsMode: 'checkout' }).golems, null);
      assert.equal(readRemote(['golems'], (_file, args) => {
        if (!args.at(-1).endsWith('/latest.json"')) throw missing;
        return JSON.stringify(value);
      }, { skillsMode: 'checkout' }).golems, null);
    }
    const invalidHooks = structuredClone(hooks); invalidHooks.install_source.mode = 'checkout';
    writeFileSync(join(dir, 'latest-hooks-sync-worktree-pin.json'), JSON.stringify(invalidHooks));
    assert.equal(readLocal(['golems'])['golems:hooks-sync'], null);
    assert.equal(readRemote(['golems'], () => JSON.stringify(invalidHooks))['golems:hooks-sync'], null);
  } finally {
    if (previous === undefined) delete process.env.HOME; else process.env.HOME = previous;
  }
}));

test('status refuses cross-kind evidence even from injected readers or legacy-shaped maps', () => fixture(({ source, owner, build }) => {
  const skills = build(), hooks = receipts.buildHooksReceipt({ source, alias: 'mbp', owner });
  for (const local of [{ golems: hooks }, { golems: hooks, 'golems:hooks-sync': hooks },
    { golems: skills, 'golems:hooks-sync': skills }]) {
    let skillsReads = 0, hooksReads = 0;
    const rows = collectStatus({ products: { golems: 'EtanHey/golems' }, localHostname: 'fixture-mbp',
      localReader: () => local, remoteReader: () => ({}),
      releaseReader: () => ({ version: 'fixture', tag: 'vfixture', released_sha: owner.pin_sha }),
      resolver: { compareAncestry: () => 'identical' },
      hooksReader: () => { hooksReads++; return owner; },
      skillsReader: () => { skillsReads++; throw Error('unavailable fixture probe'); } });
    const row = rows.find(r => r.host === 'm4-max' && (local.golems === hooks ? r.artifact_kind !== 'hooks-sync' : r.artifact_kind === 'hooks-sync'));
    assert.equal(row.status, 'MISMATCH');
    assert.equal(local.golems === hooks ? skillsReads : hooksReads, 0);
  }
}));

test('app-managed symlinks share hash and identity exclusions; other roots and nested names remain owned', () => fixture(({ source, home, git, commit, build }) => {
  const other = join(home, 'other/golems'); mkdirSync(join(home, 'other'));
  execFileSync('git', ['clone', '-q', source, other]);
  git('commit', '--allow-empty', '-qm', 'distinct owned checkout');
  const before = build();
  for (const [root, name] of [['.claude/skills', 'synced'], ['.codex/skills', '.system']]) {
    const link = join(home, root, name);
    symlinkSync(join(other, 'skills/golem-powers/demo'), link);
    const after = build(); validate(after);
    assert.equal(after.verdict, 'LIVE');
    assert.equal(after.installed.content_sha256, before.installed.content_sha256);
    assert.equal(after.target.released_sha, git('rev-parse', 'HEAD'));
    assert.ok(after.install_source.excluded.some(row => row.path === link && row.kind === 'symlink'));
    assert.ok(after.install_source.root_commits.every(row => !row.commits.includes(commit)));
  }
  for (const [root, name] of [['.codex/skills', 'synced'], ['.agents/skills', 'synced']]) {
    const link = join(home, root, name);
    symlinkSync(join(other, 'skills/golem-powers/demo'), link);
    assert.equal(build().verdict, 'MISMATCH');
    rmSync(link);
  }
  const nested = join(source, 'skills/golem-powers/demo/nested/synced');
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, 'owned.txt'), 'owned bytes');
  assert.notEqual(build().installed.content_sha256, before.installed.content_sha256);
}));
