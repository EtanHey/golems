import { afterAll, beforeAll, expect, setDefaultTimeout, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { buildRelease } from '../release/build-release.mjs';

const repo = resolve(import.meta.dir, '../..'), installer = join(repo, 'scripts/release/install.sh');
setDefaultTimeout(60_000);
const root = realpathSync(mkdtempSync(join(repo, '.golems-install-test-'))), source = join(root, 'source'), minimal = join(root, 'bin');
let release, serial = 0;
const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
beforeAll(() => {
  mkdirSync(source); mkdirSync(minimal);
  // Snapshot the current payload into a scratch Git repo: P1 builds committed objects only.
  const paths = execFileSync('git', ['ls-files', '-z'], { cwd: repo, encoding: 'utf8' }).split('\0').filter(Boolean);
  paths.push('scripts/release/install.sh', 'skills/catalog.json');
  paths.push('scripts/hooks/client-install-transaction.mjs');
  for (const path of new Set(paths.filter(p => /^(skills\/(golem-powers\/|catalog.json$)|scripts\/(pr-watch|repogolem\/|hooks\/|model-roles.mjs|ci\/check-model-role-drift.mjs)|packages\/golem-skills\/|standards\/model-roles|\.claude\/hooks\/block-dangerous-commands.py|hooks\/daemon-gate-precheck.py|\.bun-version$|LICENSE$|package.json$|release-gate.json$|scripts\/release\/install.sh$)/.test(p)))) {
    if (!existsSync(join(repo, path))) continue;
    mkdirSync(dirname(join(source, path)), { recursive: true });
    copyFileSync(join(repo, path), join(source, path));
    chmodSync(join(source, path), lstatSync(join(repo, path)).mode & 0o777);
  }
  git('init', '-b', 'master'); git('config', 'user.name', 'Installer Fixture'); git('config', 'user.email', 'fixture@example.com');
  git('add', '.'); git('commit', '-m', 'current payload');
  release = buildRelease({ repo: source, out: join(root, 'assets') });
  for (const name of ['awk', 'basename', 'cat', 'chmod', 'cmp', 'cp', 'curl', 'cut', 'date', 'dirname', 'find', 'gzip', 'ln', 'mkdir', 'mktemp', 'mv', 'readlink', 'rm', 'rmdir', 'sed', 'sh', 'shasum', 'sort', 'tar', 'xargs']) {
    symlinkSync(execFileSync('/usr/bin/which', [name], { encoding: 'utf8' }).trim(), join(minimal, name));
  }
}, 60_000);
afterAll(() => rmSync(root, { recursive: true, force: true }));
function home() { const dir = join(root, `home-${serial++}`); mkdirSync(dir); return dir; }
function install(dir, extra = [], tarball = release.tarball, sums = join(root, 'assets/SHA256SUMS')) {
  return spawnSync('/bin/sh', [installer, '--from-file', tarball, '--sums', sums, ...extra], { env: { ...process.env, HOME: dir, PATH: minimal }, encoding: 'utf8' });
}
const ok = result => { expect(result.stderr).toBe(''); expect(result.status).toBe(0); };
const catalog = () => JSON.parse(readFileSync(join(repo, 'skills/catalog.json'))).roots;
test('fresh install links exactly the per-client catalog, never support directories', () => {
  const dir = home(); ok(install(dir));
  for (const [client, names] of Object.entries(catalog())) {
    expect(readdirSync(join(dir, `.${client}/skills`)).sort()).toEqual([...names].sort());
    for (const name of names) expect(existsSync(join(dir, `.${client}/skills`, name, 'SKILL.md'))).toBe(true);
  }
  const manifest = JSON.parse(readFileSync(join(dir, '.golems/current/MANIFEST.json')));
  expect(manifest.files.some(file => file.path === 'skills/catalog.json')).toBe(true);
});
test('mixed links preserve other repos, redirects and real directories with replacement enabled', () => {
  const dir = home(), checkout = join(dir, 'Gits/golems/skills/golem-powers');
  mkdirSync(join(checkout, 'pr-loop'), { recursive: true });
  const foreign = join(dir, 'Gits/brainlayer/skills/agada-bench'); mkdirSync(foreign, { recursive: true });
  const creator = join(dir, 'Gits/skill-creator/skills/skill-creator'); mkdirSync(creator, { recursive: true });
  const worktree = join(dir, 'Gits/golems/.worktrees/demo/skills/golem-powers/coach'); mkdirSync(worktree, { recursive: true });
  symlinkSync(foreign, join(checkout, 'agada-bench'));
  symlinkSync(foreign, join(checkout, 'foreign-alias'));
  for (const client of ['.claude', '.agents']) {
    const skills = join(dir, client, 'skills'); mkdirSync(skills, { recursive: true });
    symlinkSync('../../Gits/golems/skills/golem-powers/pr-loop', join(skills, 'pr-loop'));
    symlinkSync(join(checkout, 'agada-bench'), join(skills, 'agada-bench'));
    symlinkSync(creator, join(skills, 'skill-creator'));
    symlinkSync(worktree, join(skills, 'coach'));
    symlinkSync(join(checkout, 'foreign-alias/missing/skill'), join(skills, 'fleet-wrap'));
    mkdirSync(join(skills, 'orc')); writeFileSync(join(skills, 'orc/SKILL.md'), 'custom skill');
  }
  const result = install(dir, ['--replace-checkout-links']); ok(result);
  expect(result.stdout).toContain('Keeping existing link'); expect(result.stdout).toContain('Keeping existing path');
  for (const [client, names] of Object.entries(catalog())) {
    const skills = join(dir, `.${client}/skills`);
    expect(readdirSync(skills).sort()).toEqual([...names].sort());
    expect(readlinkSync(join(skills, 'pr-loop'))).toContain('/current/skills/');
    expect(readlinkSync(join(skills, 'coach'))).toContain('/current/skills/');
    expect(realpathSync(join(skills, 'agada-bench'))).toBe(foreign);
    expect(readlinkSync(join(skills, 'fleet-wrap'))).toBe(join(checkout, 'foreign-alias/missing/skill'));
    expect(readlinkSync(join(skills, 'skill-creator'))).toBe(creator);
    expect(readFileSync(join(skills, 'orc/SKILL.md'), 'utf8')).toBe('custom skill');
  }
});
test('catalog errors fail before client or activation writes, including missing SKILL.md', () => {
  for (const change of [
    value => { value.roots.claude.push('../escape'); },
    value => { value.roots.agents.push('collab-guard'); },
    value => { value.roots.claude.push(value.roots.claude[0]); },
    value => { value.roots.agents = 'pr-loop'; },
  ]) {
    const dir = home(), [tarball, sums] = repack(payload => {
      const at = join(payload, 'skills/catalog.json'), value = JSON.parse(readFileSync(at)); change(value);
      writeFileSync(at, JSON.stringify(value));
      const manifestAt = join(payload, 'MANIFEST.json'), manifest = JSON.parse(readFileSync(manifestAt));
      manifest.files.find(file => file.path === 'skills/catalog.json').sha256 = createHash('sha256').update(readFileSync(at)).digest('hex');
      writeFileSync(manifestAt, JSON.stringify(manifest));
    });
    const result = install(dir, [], tarball, sums);
    expect(result.status).not.toBe(0); expect(result.stderr).toContain('catalog');
    expect(existsSync(join(dir, '.golems/current'))).toBe(false);
    expect(existsSync(join(dir, '.claude/skills'))).toBe(false);
  }
});
test('catalog upgrade removes only retired release links and refreshes pinned release links', () => {
  const dir = home(); ok(install(dir));
  const retired = 'pr-loop', at = join(source, 'skills/catalog.json'), original = readFileSync(at);
  const value = JSON.parse(original);
  for (const names of Object.values(value.roots)) names.splice(names.indexOf(retired), 1);
  const skills = join(dir, '.claude/skills');
  symlinkSync(join(dir, '.golems/releases', release.version, 'skills/golem-powers/_shared'), join(skills, '_shared'));
  symlinkSync('../../.golems/releases/missing/skills/golem-powers/retired', join(skills, 'retired'));
  symlinkSync(join(dir, 'Gits/other/skills/demo'), join(skills, 'foreign'));
  mkdirSync(join(skills, 'custom'));
  rmSync(join(skills, 'orc')); symlinkSync(join(dir, '.golems/releases', release.version, 'skills/golem-powers/orc'), join(skills, 'orc'));
  const next = upgrade(() => writeFileSync(at, JSON.stringify(value)));
  try {
    ok(install(dir, [], next.tarball, join(dirname(next.tarball), 'SHA256SUMS')));
    expect(existsSync(join(skills, retired))).toBe(false);
    expect(readdirSync(skills)).not.toContain(retired); expect(readdirSync(skills)).not.toContain('_shared');
    expect(readdirSync(skills)).not.toContain('retired');
    expect(readlinkSync(join(skills, 'foreign'))).toContain('/Gits/other/');
    expect(lstatSync(join(skills, 'custom')).isDirectory()).toBe(true);
    expect(readlinkSync(join(skills, 'orc'))).toContain('/current/skills/');
  } finally { writeFileSync(at, original); git('add', '.'); git('commit', '-m', 'restore catalog fixture'); }
});
test('installed-skills fixture row passes for catalog checkout links versus release install', () => {
  const left = home(), right = home(); ok(install(right));
  for (const [client, names] of Object.entries(catalog())) {
    const skills = join(left, `.${client}/skills`); mkdirSync(skills, { recursive: true });
    for (const name of names) symlinkSync(join(source, 'skills/golem-powers', name), join(skills, name));
  }
  mkdirSync(join(left, '.codex')); symlinkSync(join(left, '.agents/skills'), join(left, '.codex/skills'));
  const result = spawnSync('python3', ['-c', `
import hashlib, importlib.util, json, sys
from unittest.mock import patch
from pathlib import Path
spec=importlib.util.spec_from_file_location('parity', sys.argv[1]); parity=importlib.util.module_from_spec(spec); spec.loader.exec_module(parity)
pins=[{key: hashlib.sha256((label+key).encode()).hexdigest() for key in ('machine','hostname','home')} for label in ('checkout','release')]
with patch.object(parity, 'observed_identity', side_effect=pins):
    with patch.object(Path, 'home', return_value=Path(sys.argv[2])): left=parity.inventory()
    with patch.object(Path, 'home', return_value=Path(sys.argv[3])): right=parity.inventory()
required={'schema':2,'identities':pins,'roots':{root:{'readable':list(left['roots'][root]['entries']), 'allow_broken':[], 'allow_empty':[], 'target_aliases':{}} for root in parity.ROOTS}}
paths=[Path(sys.argv[3])/name for name in ('left.json','right.json','required.json')]
for at, document in zip(paths,(left,right,required)): at.write_text(json.dumps(document))
import subprocess
result=subprocess.run([sys.executable,sys.argv[1],'--left',str(paths[0]),'--right',str(paths[1]),'--requirements',str(paths[2])],capture_output=True,text=True)
print(result.stdout,end=''); print(result.stderr,end='',file=sys.stderr); sys.exit(result.returncode)
`, join(repo, 'scripts/ratchet/installed-skills.py'), left, right], { encoding: 'utf8' });
  ok(result); const row = JSON.parse(result.stdout);
  expect(row.measurement).toBe('fixture'); expect(row.error_count).toBe(0);
  expect(row.name_content_parity).toBe(true); expect(row.required_readable_valid).toBe(true);
});
test('fresh install without git, node or bun links both clients and writes release.json', () => {
  const dir = home(), result = install(dir); ok(result);
  expect(result.stdout).toContain('PATH');
  expect(result.stdout).toContain(release.commit);
  expect(result.stdout).toContain(createHash('sha256').update(readFileSync(release.tarball)).digest('hex'));
  const prefix = join(dir, '.golems');
  expect(readlinkSync(join(prefix, 'current'))).toBe(`releases/${release.version}`);
  expect(readlinkSync(join(dir, '.codex/skills'))).toBe(join(dir, '.agents/skills'));
  for (const client of ['.claude', '.agents']) expect(readlinkSync(join(dir, client, 'skills/pr-loop'))).toBe(join(prefix, 'current/skills/golem-powers/pr-loop'));
  expect(JSON.parse(readFileSync(join(prefix, 'release.json')))).toMatchObject({ version: release.version, commit: release.commit, channel: 'nightly', manifest_sha256: createHash('sha256').update(readFileSync(join(root, 'assets/MANIFEST.json'))).digest('hex'), tarball_sha256: createHash('sha256').update(readFileSync(release.tarball)).digest('hex') });
  expect(existsSync(join(prefix, 'installed.json'))).toBe(false);
  expect(existsSync(join(prefix, 'current/scripts/release/install.sh'))).toBe(true);
  expect(JSON.parse(readFileSync(join(prefix, 'current/release-gate.json'))).repositories['EtanHey/golems'].artifact.kind).toBe('github-release');
  expect(spawnSync(join(prefix, 'bin/pr-watch'), ['--help'], { encoding: 'utf8' }).status).toBe(0);
  expect(spawnSync(join(prefix, 'bin/golems-cli'), ['--help'], { encoding: 'utf8', env: { ...process.env, HOME: dir } }).status).toBe(0);
});
test('second install is a no-op, including through the installed update wrapper', () => {
  const dir = home(); ok(install(dir));
  const metadata = readFileSync(join(dir, '.golems/release.json'));
  const result = install(dir); ok(result); expect(result.stdout).toContain('already current'); expect(result.stdout).toContain(release.commit); expect(result.stdout).toContain(createHash('sha256').update(readFileSync(release.tarball)).digest('hex'));
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
  const result = install(dir, ['--prefix', prefix]); expect(result.status).not.toBe(0); expect(result.stderr).toContain('another install'); expect(result.stderr).toContain(join(prefix, '.install-lock'));
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
test('nightly uses only page one and newest created_at including stable releases, with optional API auth', () => {
  const fixture = join(root, 'network'), bin = join(fixture, 'bin'); mkdirSync(bin, { recursive: true });
  for (const file of readdirSync(join(root, 'assets'))) copyFileSync(join(root, 'assets', file), join(fixture, file));
  for (const tool of readdirSync(minimal).filter(tool => tool !== 'curl')) symlinkSync(join(minimal, tool), join(bin, tool));
  const tag = `v${release.version}`, entry = (tag_name, created_at, extra = {}) => ({ tag_name, created_at, published_at: '2099-01-01T00:00:00Z', draft: false, prerelease: true, body: 'escaped "tag_name": fake\n' + 'x'.repeat(4000), ...extra });
  // Deliberately larger than the requested page: stress the macOS awk parser.
  writeFileSync(join(fixture, 'page1.json'), JSON.stringify([
    entry('v2026.10.14-abcdef0', '2026-10-14T00:00:00Z', { draft: true }),
    entry(tag, '2026-10-12T00:00:00Z', { prerelease: false, published_at: '2000-01-01T00:00:00Z' }),
    ...Array.from({ length: 100 }, () => entry('v2026.01.01-deadbee', '2026-01-01T00:00:00Z')),
  ]));
  writeFileSync(join(fixture, 'release.json'), JSON.stringify(entry(tag, '2026-10-12T00:00:00Z')));
  writeFileSync(join(bin, 'curl'), `#!/bin/sh
printf '%s\\n' "$@" >> "$FIXTURE/args"
while [ "$#" -gt 0 ]; do case "$1" in https://*) url=$1 ;; -o) shift; output=$1 ;; -w) shift ;; esac; shift; done
printf '%s\\n' "$url" >> "$FIXTURE/requests"
case "$url" in https://github.com/*) printf '302\\nhttps://release-assets.githubusercontent.com/fixture/%s' "$(basename "$url")"; exit ;; esac
case "$url" in *'page=1') file=page1.json ;; *'/tags/'*) file=release.json ;; *) file=$(basename "$url") ;; esac
cp "$FIXTURE/$file" "$output"
printf 200
`); chmodSync(join(bin, 'curl'), 0o755);
  for (const channel of ['nightly', tag]) {
    const dir = home(), started = performance.now();
    ok(spawnSync('/bin/sh', [installer, '--channel', channel], { env: { ...process.env, HOME: dir, PATH: bin, FIXTURE: fixture, GITHUB_TOKEN: 'fixture-token' }, encoding: 'utf8', timeout: 10_000 }));
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(JSON.parse(readFileSync(join(dir, '.golems/release.json'))).channel).toBe(channel);
    expect(readlinkSync(join(dir, '.golems/current'))).toBe(`releases/${release.version}`);
  }
  const requests = readFileSync(join(fixture, 'requests'), 'utf8').trim().split('\n');
  expect(requests.filter(url => url.startsWith('https://release-assets.githubusercontent.com/'))).toHaveLength(6);
  expect(requests.filter(url => url.includes('?'))).toEqual(['https://api.github.com/repos/EtanHey/golems/releases?per_page=30&page=1']);
  const args = readFileSync(join(fixture, 'args'), 'utf8');
  expect(args.split('Authorization: Bearer fixture-token').length - 1).toBe(3); // API only; never asset hosts.
  writeFileSync(join(fixture, 'MANIFEST.json'), '{}');
  const dir = home(), refused = spawnSync('/bin/sh', [installer, '--channel', tag], { env: { ...process.env, HOME: dir, PATH: bin, FIXTURE: fixture }, encoding: 'utf8' });
  expect(refused.status).not.toBe(0); expect(refused.stderr).toContain('checksum');
  expect(existsSync(join(dir, '.golems/current'))).toBe(false);
});
for (const status of [403, 429]) {
  for (const host of ['api.github.com', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']) {
    test(`${host} HTTP ${status} identifies the refusing host and rate-limit guidance without activation`, () => {
      const dir = home(), bin = join(dir, 'bin'); mkdirSync(bin);
      for (const tool of readdirSync(minimal).filter(tool => tool !== 'curl')) symlinkSync(join(minimal, tool), join(bin, tool));
      writeFileSync(join(bin, 'curl'), `#!/bin/sh
while [ "$#" -gt 0 ]; do case "$1" in https://*) url=$1 ;; -o) shift; output=$1 ;; -w) shift ;; esac; shift; done
printf '%s\\n' "$url" >> "$HOME/requests"
case "$url" in
  https://"$REFUSING_HOST"/*) printf '%s' "$HTTP_STATUS" ;;
  https://api.github.com/*) printf '{"tag_name":"v2026.10.12-abcdef0","draft":false}' > "$output"; printf 200 ;;
  https://github.com/*) printf '302\\nhttps://%s/fixture/payload' "$REFUSING_HOST" ;;
esac
`); chmodSync(join(bin, 'curl'), 0o755);
      const result = spawnSync('/bin/sh', [installer, '--channel', 'v2026.10.12-abcdef0'], {
        env: { ...process.env, HOME: dir, PATH: bin, REFUSING_HOST: host, HTTP_STATUS: String(status), GITHUB_TOKEN: '' }, encoding: 'utf8',
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(host);
      expect(result.stderr).toContain(`HTTP ${status}`);
      expect(result.stderr).toContain(host === 'api.github.com' ? 'GitHub API' : 'asset download');
      expect(result.stderr).toContain('rate limit');
      expect(result.stderr).toContain('Wait');
      expect(result.stderr).toContain('GITHUB_TOKEN');
      const requests = readFileSync(join(dir, 'requests'), 'utf8').trim().split('\n');
      expect(new URL(requests.at(-1)).hostname).toBe(host);
      expect(requests).toHaveLength(host === 'api.github.com' ? 1 : host === 'github.com' ? 2 : 3);
      expect(existsSync(join(dir, '.golems/current'))).toBe(false);
      expect(existsSync(join(dir, '.golems/release.json'))).toBe(false);
      expect(existsSync(join(dir, '.golems/.install-lock'))).toBe(false);
    });
  }
}
test('redirects refuse non-GitHub hosts and HTTP before requesting the target', () => {
  for (const target of ['https://example.com/payload', 'http://github.com/payload', 'https://api.github.com@example.com/payload']) {
    const dir = home(), bin = join(dir, 'bin'); mkdirSync(bin);
    for (const tool of readdirSync(minimal).filter(tool => tool !== 'curl')) symlinkSync(join(minimal, tool), join(bin, tool));
    writeFileSync(join(bin, 'curl'), `#!/bin/sh
printf 'request\\n' >> "$HOME/requests"
printf '302\\n%s' "$REDIRECT_TARGET"
`); chmodSync(join(bin, 'curl'), 0o755);
    const result = spawnSync('/bin/sh', [installer], { env: { ...process.env, HOME: dir, PATH: bin, REDIRECT_TARGET: target }, encoding: 'utf8' });
    expect(result.status).not.toBe(0); expect(result.stderr).toContain('refusing download host');
    expect(readFileSync(join(dir, 'requests'), 'utf8')).toBe('request\n');
    expect(existsSync(join(dir, '.golems/current'))).toBe(false);
  }
});
test('truncated piped installer never executes setup or download side effects', () => {
  const script = readFileSync(installer, 'utf8');
  for (const marker of ['mkdir -p "$prefix"', 'download()', "printf 'golems %s installed"]) {
    const dir = home(), cut = script.indexOf(marker); expect(cut).toBeGreaterThan(0);
    spawnSync('/bin/sh', [], { input: script.slice(0, cut), env: { ...process.env, HOME: dir, PATH: minimal }, encoding: 'utf8' });
    expect(existsSync(join(dir, '.golems'))).toBe(false);
  }
});
test('manifest commit must match the filename tag SHA suffix even when checksums are valid', () => {
  const dir = home();
  const [tarball, sums] = repack(payload => {
    const path = join(payload, 'MANIFEST.json'), manifest = JSON.parse(readFileSync(path));
    manifest.commit = '0'.repeat(40); writeFileSync(path, JSON.stringify(manifest));
  });
  const result = install(dir, [], tarball, sums);
  expect(result.status).not.toBe(0); expect(result.stderr).toContain('manifest commit mismatch');
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

function runtime(dir) {
  const bin = join(dir, 'runtime'); mkdirSync(bin);
  for (const name of readdirSync(minimal)) symlinkSync(join(minimal, name), join(bin, name));
  for (const name of ['node', 'python3']) symlinkSync(execFileSync('/usr/bin/which', [name], { encoding: 'utf8' }).trim(), join(bin, name));
  const env = { ...process.env, HOME: dir, CODEX_HOME: join(dir, '.codex'), PATH: bin, TMP_BLOCK_LEDGER: join(dir, 'ledger.jsonl') };
  for (const key of ['WEAVE_ALLOW_TMP', 'PYTHONPATH', 'PYTHONHOME', 'GOLEM_ROLE', 'GOLEMS_WORKER', 'GOLEMS_HEAVY_SUITE_HELD']) delete env[key];
  return env;
}
const update = (dir, env, next) => {
  const wrapper = join(dir, '.golems/bin/golems-cli'), installed = existsSync(wrapper);
  return spawnSync(installed ? wrapper : '/bin/sh', [installed ? 'update' : installer, '--from-file', next.tarball, '--sums', join(dirname(next.tarball), 'SHA256SUMS')], { env, encoding: 'utf8' });
};
const hooks = (dir, env, flag) => spawnSync('node', [join(dir, '.golems/current/scripts/hooks/install-hooks.mjs'), '--host', 'client', '--source', join(dir, '.golems/current'), flag], { env, encoding: 'utf8' });
function upgrade(change = () => {}) {
  writeFileSync(join(source, 'LICENSE'), `hook update ${serial++}\n`); change(); git('add', '.'); git('commit', '-m', 'hook update fixture');
  return buildRelease({ repo: source, out: join(root, `hooks-upgrade-${serial++}`) });
}
function hookState(dir) {
  const snapshot = at => {
    const st = lstatSync(at);
    return [st.mode, st.isSymbolicLink() ? readlinkSync(at) : st.isDirectory() ? readdirSync(at).sort().map(n => [n, snapshot(join(at, n))]) : readFileSync(at).toString('base64')];
  };
  return ['.claude/hooks', '.claude/settings.json', '.codex/hooks.json', '.golems/current', '.golems/release.json', '.golems/release-history'].map(p => snapshot(join(dir, p)));
}
test('client hooks survive four release installs: verified pins, drift zero and no-token lease DENY in both clients', () => {
  const dir = home(), env = runtime(dir); ok(update(dir, env, release)); ok(hooks(dir, env, '--apply'));
  for (let i = 0; i < 3; i++) {
    const next = upgrade(); ok(update(dir, env, next));
    const status = hooks(dir, env, '--status'); ok(status); expect(status.stdout).toContain('drift=0');
    expect(readlinkSync(join(dir, '.claude/hooks/tmp-block'))).toBe(join(dir, '.golems/releases', next.version, 'skills/golem-powers/tmp-block'));
    const claude = JSON.parse(readFileSync(join(dir, '.claude/settings.json'))).hooks.PreToolUse.flatMap(g => g.hooks).find(h => h.command.includes('human-confirm-pretooluse')).command;
    const codex = JSON.parse(readFileSync(join(dir, '.codex/hooks.json'))).hooks.PreToolUse.flatMap(g => g.hooks).find(h => h.command.includes('human-confirm')).command;
    for (const command of [claude, codex]) {
      const denied = spawnSync('/bin/sh', ['-c', command], { env, encoding: 'utf8', input: JSON.stringify({ tool_name: 'Bash', cwd: dir, session_id: 'fixture', tool_input: { command: `git push --force-with-lease=refs/heads/topic:${'a'.repeat(40)} origin HEAD:refs/heads/topic` } }) });
      expect(denied.status).toBe(command === claude ? 2 : 0);
      expect(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
      expect(denied.stdout + denied.stderr).not.toContain('policy hook unavailable');
    }
  }
});
test('failed client reinstallation restores previous current, receipts and partially rewritten hooks', () => {
  const dir = home(), env = runtime(dir); ok(update(dir, env, release)); ok(hooks(dir, env, '--apply'));
  const at = join(source, 'scripts/hooks/codex-hooks-install.mjs'), original = readFileSync(at, 'utf8');
  const next = upgrade(() => writeFileSync(at, original.replace('renameSync(stage, plan.at);', "renameSync(stage, plan.at); throw new Error('fixture: late Codex failure');")));
  const before = hookState(dir), result = update(dir, env, next);
  expect(result.status).not.toBe(0); expect(result.stderr).toContain('late Codex failure');
  expect(hookState(dir)).toEqual(before);
  const status = hooks(dir, env, '--status'); ok(status); expect(status.stdout).toContain('drift=0');
  writeFileSync(at, original); git('add', '.'); git('commit', '-m', 'restore fixture installer');
});
test('client update without Node refuses and preserves release and hooks', () => {
  const dir = home(), env = runtime(dir); ok(update(dir, env, release)); ok(hooks(dir, env, '--apply'));
  const before = hookState(dir), result = update(dir, { ...env, PATH: minimal }, upgrade());
  expect(result.status).not.toBe(0); expect(result.stderr).toContain('node');
  expect(hookState(dir)).toEqual(before);
});
test('a release without rollback support cannot update an existing client hook install', () => {
  const dir = home(), env = runtime(dir); ok(update(dir, env, release)); ok(hooks(dir, env, '--apply'));
  const before = hookState(dir), [tarball, sums] = repack(payload => {
    const at = join(payload, 'scripts/hooks/release-hooks.mjs');
    writeFileSync(at, readFileSync(at, 'utf8').replace('export const CLIENT_INSTALL_PROTOCOL = 1;', ''));
    const manifestPath = join(payload, 'MANIFEST.json'), manifest = JSON.parse(readFileSync(manifestPath));
    manifest.files.find(r => r.path === 'scripts/hooks/release-hooks.mjs').sha256 = createHash('sha256').update(readFileSync(at)).digest('hex');
    writeFileSync(manifestPath, JSON.stringify(manifest));
  });
  // A fresh prefix with an existing client HOME must also enforce the protocol.
  const result = spawnSync('/bin/sh', [installer, '--prefix', join(dir, 'other-prefix'), '--from-file', tarball, '--sums', sums], { env, encoding: 'utf8' });
  expect(result.status).not.toBe(0); expect(result.stderr).toContain('rollback protocol');
  expect(hookState(dir)).toEqual(before);
});
