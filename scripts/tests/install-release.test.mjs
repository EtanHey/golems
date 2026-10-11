import { afterAll, beforeAll, expect, setDefaultTimeout, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { buildRelease } from '../release/build-release.mjs';

const repo = resolve(import.meta.dir, '../..'), installer = join(repo, 'scripts/release/install.sh');
setDefaultTimeout(60_000);
const root = realpathSync(mkdtempSync(join(tmpdir(), 'golems-install-test-'))), source = join(root, 'source'), minimal = join(root, 'bin');
let release, serial = 0;
const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
beforeAll(() => {
  mkdirSync(source); mkdirSync(minimal);
  // Snapshot the current payload into a scratch Git repo: P1 builds committed objects only.
  const paths = execFileSync('git', ['ls-files', '-z'], { cwd: repo, encoding: 'utf8' }).split('\0').filter(Boolean);
  paths.push('scripts/release/install.sh');
  for (const path of new Set(paths.filter(p => /^(skills\/golem-powers\/|scripts\/(pr-watch|repogolem\/|hooks\/|model-roles.mjs|ci\/check-model-role-drift.mjs)|packages\/golem-skills\/|standards\/model-roles|\.claude\/hooks\/block-dangerous-commands.py|hooks\/daemon-gate-precheck.py|\.bun-version$|LICENSE$|package.json$|release-gate.json$|scripts\/release\/install.sh$)/.test(p)))) {
    if (!existsSync(join(repo, path))) continue;
    mkdirSync(dirname(join(source, path)), { recursive: true });
    copyFileSync(join(repo, path), join(source, path));
    chmodSync(join(source, path), lstatSync(join(repo, path)).mode & 0o777);
  }
  git('init', '-b', 'master'); git('config', 'user.name', 'Installer Fixture'); git('config', 'user.email', 'fixture@example.com');
  git('add', '.'); git('commit', '-m', 'current payload');
  release = buildRelease({ repo: source, out: join(root, 'assets') });
  for (const name of ['awk', 'basename', 'cat', 'chmod', 'cmp', 'cp', 'curl', 'cut', 'date', 'dirname', 'find', 'ln', 'mkdir', 'mktemp', 'mv', 'readlink', 'rm', 'rmdir', 'sed', 'sh', 'shasum', 'sort', 'tar', 'xargs']) {
    symlinkSync(execFileSync('/usr/bin/which', [name], { encoding: 'utf8' }).trim(), join(minimal, name));
  }
}, 60_000);
afterAll(() => rmSync(root, { recursive: true, force: true }));
function home() { const dir = join(root, `home-${serial++}`); mkdirSync(dir); return dir; }
function install(dir, extra = [], tarball = release.tarball, sums = join(root, 'assets/SHA256SUMS')) {
  return spawnSync('/bin/sh', [installer, '--from-file', tarball, '--sums', sums, ...extra], { env: { ...process.env, HOME: dir, PATH: minimal }, encoding: 'utf8' });
}
const ok = result => { expect(result.stderr).toBe(''); expect(result.status).toBe(0); };
test('fresh install without git, node or bun links both clients and writes release.json', () => {
  const dir = home(), result = install(dir); ok(result);
  expect(result.stdout).toContain('PATH');
  const prefix = join(dir, '.golems');
  expect(readlinkSync(join(prefix, 'current'))).toBe(`releases/${release.version}`);
  expect(readlinkSync(join(dir, '.codex/skills'))).toBe(join(dir, '.agents/skills'));
  for (const client of ['.claude', '.agents']) expect(readlinkSync(join(dir, client, 'skills/pr-loop'))).toBe(join(prefix, 'current/skills/golem-powers/pr-loop'));
  expect(JSON.parse(readFileSync(join(prefix, 'release.json')))).toMatchObject({ version: release.version, commit: release.commit, channel: 'nightly', tarball_sha256: createHash('sha256').update(readFileSync(release.tarball)).digest('hex') });
  expect(existsSync(join(prefix, 'installed.json'))).toBe(false);
  expect(existsSync(join(prefix, 'current/scripts/release/install.sh'))).toBe(true);
  expect(JSON.parse(readFileSync(join(prefix, 'current/release-gate.json'))).repositories['EtanHey/golems'].artifact.kind).toBe('github-release');
  expect(spawnSync(join(prefix, 'bin/pr-watch'), ['--help'], { encoding: 'utf8' }).status).toBe(0);
  expect(spawnSync(join(prefix, 'bin/golems-cli'), ['--help'], { encoding: 'utf8', env: { ...process.env, HOME: dir } }).status).toBe(0);
});
test('second install is a no-op, including through the installed update wrapper', () => {
  const dir = home(); ok(install(dir));
  const metadata = readFileSync(join(dir, '.golems/release.json'));
  const result = install(dir); ok(result); expect(result.stdout).toContain('already current');
  expect(readFileSync(join(dir, '.golems/release.json'))).toEqual(metadata);
  const update = spawnSync(join(dir, '.golems/bin/golems-cli'), ['update', '--from-file', release.tarball, '--sums', join(root, 'assets/SHA256SUMS')], { env: { ...process.env, HOME: dir, PATH: minimal }, encoding: 'utf8' });
  ok(update); expect(update.stdout).toContain('already current');
});
test('tarball checksum mismatch refuses before extraction or activation', () => {
  const dir = home(), tampered = join(root, 'tampered', basename(release.tarball)); mkdirSync(dirname(tampered));
  writeFileSync(tampered, Buffer.concat([readFileSync(release.tarball), Buffer.from('tampered')]));
  const result = install(dir, [], tampered); expect(result.status).not.toBe(0); expect(result.stderr).toContain('checksum');
  expect(existsSync(join(dir, '.golems/current'))).toBe(false);
});
test('checkout links require the opt-in; real skill and Codex directories survive', () => {
  const dir = home(), skills = join(dir, '.claude/skills'); mkdirSync(skills, { recursive: true });
  const checkout = join(dir, 'Gits/golems/skills/golem-powers/pr-loop'); symlinkSync(checkout, join(skills, 'pr-loop'));
  mkdirSync(join(skills, 'orc')); mkdirSync(join(dir, '.codex/skills'), { recursive: true });
  const result = install(dir); ok(result); expect(result.stdout).toContain('--replace-checkout-links');
  expect(readlinkSync(join(skills, 'pr-loop'))).toBe(checkout); expect(lstatSync(join(skills, 'orc')).isDirectory()).toBe(true);
  expect(lstatSync(join(dir, '.codex/skills')).isDirectory()).toBe(true);
  ok(install(dir, ['--replace-checkout-links']));
  expect(readlinkSync(join(skills, 'pr-loop'))).toContain('/current/skills/');
});
function repack(change) {
  const dir = join(root, `modified-${serial++}`), extracted = join(dir, 'payload'); mkdirSync(extracted, { recursive: true });
  execFileSync('tar', ['-xzf', release.tarball, '-C', extracted]); change(extracted);
  const tarball = join(dir, basename(release.tarball));
  execFileSync('tar', ['-czf', tarball, '-C', extracted, ...readdirSync(extracted)]);
  const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
  const sums = join(dir, 'SHA256SUMS'); writeFileSync(sums, `${sha(tarball)}  ${basename(tarball)}\n${sha(join(extracted, 'MANIFEST.json'))}  MANIFEST.json\n`);
  return [tarball, sums];
}
test('per-file mismatch leaves the previous current and metadata intact', () => {
  const dir = home(); ok(install(dir)); const metadata = readFileSync(join(dir, '.golems/release.json'));
  const [tarball, sums] = repack(payload => writeFileSync(join(payload, 'scripts/pr-watch'), 'changed'));
  const result = install(dir, [], tarball, sums); expect(result.status).not.toBe(0); expect(result.stderr).toContain('checksum');
  expect(readFileSync(join(dir, '.golems/release.json'))).toEqual(metadata);
});
test('symlink archive entries and unmanifested payload files are refused', () => {
  for (const change of [payload => symlinkSync('/etc/passwd', join(payload, 'escape')), payload => writeFileSync(join(payload, 'unexpected'), 'extra')]) {
    const dir = home(), [tarball, sums] = repack(change), result = install(dir, [], tarball, sums);
    expect(result.status).not.toBe(0); expect(existsSync(join(dir, '.golems/current'))).toBe(false);
  }
});
test('custom prefix with spaces works and an in-progress install refuses cleanly', () => {
  const dir = home(), prefix = join(dir, 'custom prefix'); ok(install(dir, ['--prefix', prefix]));
  mkdirSync(join(prefix, '.install-lock'));
  const result = install(dir, ['--prefix', prefix]); expect(result.status).not.toBe(0); expect(result.stderr).toContain('another install');
  expect(existsSync(join(prefix, '.install-lock'))).toBe(true);
});
test('symlinked install and client directories refuse without touching their targets', () => {
  for (const path of ['.golems/releases', '.golems/bin', '.claude/skills', '.agents/skills', '.codex']) {
    const dir = home(), target = join(dir, 'external'); mkdirSync(target); writeFileSync(join(target, 'sentinel'), 'untouched');
    mkdirSync(dirname(join(dir, path)), { recursive: true }); symlinkSync(target, join(dir, path));
    const result = install(dir); expect(result.status).not.toBe(0); expect(result.stderr).toContain('symlink');
    expect(readdirSync(target)).toEqual(['sentinel']); expect(readFileSync(join(target, 'sentinel'), 'utf8')).toBe('untouched');
  }
});
test('nightly publication workflow marks releases as prereleases', () => {
  expect(readFileSync(join(repo, '.github/workflows/golems-release.yml'), 'utf8')).toContain('--prerelease');
});
test('nightly scans pages by publication date, ignores stable/draft releases, and supports pinned tags', () => {
  const fixture = join(root, 'network'), bin = join(fixture, 'bin'); mkdirSync(bin, { recursive: true });
  for (const file of readdirSync(join(root, 'assets'))) copyFileSync(join(root, 'assets', file), join(fixture, file));
  for (const tool of readdirSync(minimal).filter(tool => tool !== 'curl')) symlinkSync(join(minimal, tool), join(bin, tool));
  const tag = `v${release.version}`, entry = (tag_name, published_at, extra = {}) => ({ tag_name, published_at, draft: false, prerelease: true, body: 'nested "tag_name": fake\n Unicode: \\u1234', ...extra });
  writeFileSync(join(fixture, 'page1.json'), JSON.stringify(Array.from({ length: 100 }, () => entry('v2026.01.01-deadbee', '2026-01-01T00:00:00Z'))));
  writeFileSync(join(fixture, 'page2.json'), JSON.stringify([entry(tag, '2026-10-12T00:00:00Z'), entry('v2026.10.13-abcdef0', '2026-10-13T00:00:00Z', { prerelease: false }), entry('v2026.10.14-abcdef0', '2026-10-14T00:00:00Z', { draft: true })]));
  writeFileSync(join(fixture, 'release.json'), JSON.stringify(entry(tag, '2026-10-12T00:00:00Z')));
  writeFileSync(join(bin, 'curl'), `#!/bin/sh
while [ "$#" -gt 0 ]; do case "$1" in https://*) url=$1 ;; -o) shift; output=$1 ;; esac; shift; done
printf '%s\\n' "$url" >> "$FIXTURE/requests"
case "$url" in *'page=1') file=page1.json ;; *'page=2') file=page2.json ;; *'/tags/'*) file=release.json ;; *) file=$(basename "$url") ;; esac
cp "$FIXTURE/$file" "$output"
`); chmodSync(join(bin, 'curl'), 0o755);
  for (const channel of ['nightly', tag]) {
    const dir = home();
    ok(spawnSync('/bin/sh', [installer, '--channel', channel], { env: { ...process.env, HOME: dir, PATH: bin, FIXTURE: fixture }, encoding: 'utf8' }));
    expect(JSON.parse(readFileSync(join(dir, '.golems/release.json'))).channel).toBe(channel);
    expect(readlinkSync(join(dir, '.golems/current'))).toBe(`releases/${release.version}`);
  }
  expect(readFileSync(join(fixture, 'requests'), 'utf8')).toContain('page=2');
  writeFileSync(join(fixture, 'MANIFEST.json'), '{}');
  const dir = home(), refused = spawnSync('/bin/sh', [installer, '--channel', tag], { env: { ...process.env, HOME: dir, PATH: bin, FIXTURE: fixture }, encoding: 'utf8' });
  expect(refused.status).not.toBe(0); expect(refused.stderr).toContain('checksum');
  expect(existsSync(join(dir, '.golems/current'))).toBe(false);
});
test('four upgrades retain current plus two previous releases and atomically replace directory links', () => {
  const dir = home(), versions = [release.version]; ok(install(dir));
  for (let i = 0; i < 3; i++) {
    writeFileSync(join(source, 'LICENSE'), `retention fixture ${i}\n`); git('add', 'LICENSE'); git('commit', '-m', `upgrade ${i}`);
    const next = buildRelease({ repo: source, out: join(root, `upgrade-${i}`) }); versions.push(next.version);
    ok(install(dir, [], next.tarball, join(dirname(next.tarball), 'SHA256SUMS')));
  }
  expect(readdirSync(join(dir, '.golems/releases')).sort()).toEqual(versions.slice(1).sort());
  expect(readlinkSync(join(dir, '.golems/current'))).toBe(`releases/${versions[3]}`);
  expect(existsSync(join(dir, '.golems/releases', versions[1], 'current'))).toBe(false);
});
