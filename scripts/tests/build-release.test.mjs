import { afterEach, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRelease, createManifest } from '../release/build-release.mjs';

const scratch = [];
afterEach(() => scratch.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'release-build-test-'));
  scratch.push(root);
  git(root, 'init', '-b', 'master');
  git(root, 'config', 'user.email', 'fixture@example.com');
  git(root, 'config', 'user.name', 'Fixture');
  for (const path of ['skills/golem-powers/demo/SKILL.md', 'skills/golem-powers/demo/scripts/run.sh', 'scripts/pr-watch', 'scripts/pr-watch-lib/vendor/upstream.py', 'scripts/repogolem/runtime.zsh', 'scripts/hooks/manifest.json', 'packages/golem-skills/src/index.ts', 'package.json', 'docs.local/private.txt', 'skills/golem-powers/demo/tests/leak.txt', 'skills/golem-powers/demo/evals/fixture.json', 'skills/golem-powers/demo/.env', 'packages/golem-skills/src/__tests__/test.ts']) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), path === 'package.json' ? '{"dependencies":{"ajv":"8.18.0","yaml":"2.8.3","varlock":"1.21.1"}}' : path === 'scripts/hooks/manifest.json' ? '{"hosts":{}}' : `${path}\n`);
  }
  chmodSync(join(root, 'scripts/pr-watch'), 0o755);
  git(root, 'add', '.');
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root, env: { ...process.env, GIT_AUTHOR_DATE: '2026-01-02T23:30:00-05:00', GIT_COMMITTER_DATE: '2026-01-02T23:30:00-05:00' } });
  return root;
}
test('manifest records sorted paths, content hashes and executable modes', () => {
  const result = createManifest('2026.01.03-abcdef0', 'abcdef0', [{ path: 'z', data: Buffer.from('hello'), mode: '0755' }, { path: 'a', data: Buffer.from('a'), mode: '0644' }]);
  expect(result.files.map(file => file.path)).toEqual(['a', 'z']);
  expect(result.files[1]).toEqual({ path: 'z', sha256: createHash('sha256').update('hello').digest('hex'), mode: '0755' });
});
test('same commit builds identical bytes; extraction matches manifest and excludes private/test files', () => {
  const root = fixture();
  const sha = git(root, 'rev-parse', 'HEAD');
  const first = buildRelease({ repo: root, commit: sha, out: join(root, 'first') });
  writeFileSync(join(root, 'scripts/pr-watch'), 'dirty bytes must not ship');
  const second = buildRelease({ repo: root, commit: 'HEAD', out: join(root, 'second') });
  expect(first.version).toBe(`2026.01.03-${sha.slice(0, 7)}`);
  for (const name of [`golems-${first.version}.tar.gz`, 'MANIFEST.json', 'SHA256SUMS']) expect(readFileSync(join(root, 'first', name))).toEqual(readFileSync(join(root, 'second', name)));
  const extracted = join(root, 'extracted');
  mkdirSync(extracted);
  execFileSync('tar', ['-xzf', first.tarball, '-C', extracted]);
  const manifest = JSON.parse(readFileSync(join(extracted, 'MANIFEST.json')));
  expect(manifest.commit).toBe(sha);
  expect(manifest.files.some(file => /docs.local|tests|evals|\.env/.test(file.path))).toBe(false);
  expect(manifest.files.find(file => file.path === 'scripts/pr-watch').mode).toBe('0755');
  for (const file of manifest.files) {
    expect(createHash('sha256').update(readFileSync(join(extracted, file.path))).digest('hex')).toBe(file.sha256);
    expect(statSync(join(extracted, file.path)).mode & 0o777).toBe(parseInt(file.mode, 8));
  }
  expect(readFileSync(join(extracted, 'scripts/pr-watch'), 'utf8')).toBe('scripts/pr-watch\n');
  expect(JSON.parse(readFileSync(join(extracted, 'package.json'))).workspaces).toBeUndefined();
});
test('selected symlinks and invalid commits fail before assets are written', () => {
  const root = fixture();
  symlinkSync('/etc/passwd', join(root, 'skills/golem-powers/demo/escape'));
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'unsafe link');
  expect(() => buildRelease({ repo: root, out: join(root, 'out') })).toThrow('unsupported git mode');
  expect(() => buildRelease({ repo: root, commit: '--help', out: join(root, 'out') })).toThrow();
});
