import { afterEach, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
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
  writeFileSync(join(root, 'skills/catalog.json'), JSON.stringify({ schema: 1, roots: { claude: ['demo'], agents: ['demo'] } }));
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
  expect(manifest.files.some(file => file.path === 'skills/catalog.json')).toBe(true);
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

const workflow = readFileSync(new URL('../../.github/workflows/golems-release.yml', import.meta.url), 'utf8');
const publishScript = workflow.split('      - name: Publish immutable release assets (reruns verify existing bytes)\n        run: |\n')[1]
  .split('\n').map(line => line.replace(/^ {10}/, '')).join('\n');

function publishFixture(state, { oldMaster = false, tampered = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'release-workflow-test-'));
  scratch.push(root);
  mkdirSync(join(root, 'bin'));
  const stubs = {
    node: `#!/bin/bash
set -eu
if [ "$1" = scripts/release/build-release.mjs ]; then
  mkdir -p dist/release
  for name in golems-2026.10.11-abcdef0.tar.gz MANIFEST.json SHA256SUMS; do
    printf 'immutable fixture bytes\\n' > "dist/release/$name"
  done
  printf '{"version":"2026.10.11-abcdef0"}\\n'
elif [ "$1" = -p ]; then
  printf '2026.10.11-abcdef0\\n'
else
  exit 1
fi
`,
    gh: `#!/bin/bash
set -eu
printf '%s\\t' "$@" >> "$GH_CALLS"
printf '\\n' >> "$GH_CALLS"
case "$1:$2" in
  api:--paginate) printf '%s' "$RELEASE_STATE" ;;
  release:download)
    mkdir -p dist/existing
    cp dist/release/* dist/existing/
    if [ "$TAMPERED" = true ]; then printf 'tampered\\n' > dist/existing/MANIFEST.json; fi ;;
  release:create|release:upload|release:edit) ;;
  *) exit 1 ;;
esac
`,
    git: `#!/bin/bash
set -eu
case "$1" in
  fetch) ;;
  rev-parse) printf '%s\\n' "$MASTER_SHA" ;;
  *) exit 1 ;;
esac
`,
  };
  for (const [name, contents] of Object.entries(stubs)) writeFileSync(join(root, 'bin', name), contents, { mode: 0o755 });
  const calls = join(root, 'gh-calls');
  const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', publishScript], {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, GH_CALLS: calls,
      RELEASE_STATE: state, TAMPERED: String(tampered), GITHUB_SHA: 'abcdef0',
      MASTER_SHA: oldMaster ? '1234567' : 'abcdef0', GITHUB_REPOSITORY: 'EtanHey/golems' },
  });
  return { ...result, calls: readFileSync(calls, 'utf8').trim().split('\n').map(line => line.replace(/\t$/, '').split('\t')) };
}

for (const [name, state, action, oldMaster] of [
  ['new release', '', 'create', false],
  ['interrupted draft', 'true', 'upload', false],
  ['published release at master tip', 'false', 'download', false],
  ['published release behind master tip', 'false', 'download', true],
]) {
  test(`${name} publishes to nightly without marking Latest`, () => {
    const result = publishFixture(state, { oldMaster });
    expect(result.status).toBe(0);
    expect(result.calls[0].slice(0, 2)).toEqual(['api', '--paginate']);
    expect(result.calls[1].slice(0, 2)).toEqual(['release', action]);
    const mutations = result.calls.filter(args => args[1] === 'create' || args[1] === 'edit');
    for (const args of mutations) {
      expect(args).toContain('--prerelease');
      expect(args).toContain('--latest=false');
    }
    expect(result.calls.at(-1)).toEqual(['release', 'edit', 'v2026.10.11-abcdef0', '--draft=false', '--prerelease', '--latest=false']);
    if (action === 'upload') expect(result.calls[1]).toContain('--clobber');
    if (action === 'create') expect(result.calls[1]).toContain('--draft');
  });
}

test('published asset mismatch fails before changing release metadata', () => {
  const result = publishFixture('false', { tampered: true });
  expect(result.status).not.toBe(0);
  expect(result.calls.map(args => args[1])).toEqual(['--paginate', 'download']);
});

test('publication remains serialized and both jobs use the pinned Node version', () => {
  expect(workflow).toContain('group: golems-release\n      cancel-in-progress: false');
  expect(workflow.match(/node-version: '24\.22\.1'/g)).toHaveLength(2);
});

function runsNode(script) {
  const hasNodeCommand = code => /\b(?:node|npm|npx)(?:\s|$)/.test(code) ||
    (/\bbun\s+run(?:\s|$)/.test(code) && !/(?:^|\s)--bun(?:\s|$)/.test(code));
  const legacy = script.split(/\n|&&|\|\||;/).some(command => hasNodeCommand(command.replace(/#.*/, '')));
  const uncommented = script.replace(/\$'(?:\\.|[^'\\])*'|'[^']*'|"(?:\\.|[^"\\])*"|\\.|(?<![^\s;&|(<>])#[^\n]*/g,
    token => token.startsWith('#') ? '' : token);
  // AIDEV-NOTE: Full heredoc parsing is out of scope; union with the legacy detector is the safety net.
  return legacy || uncommented.split(/\n|&&|\|\||;/).some(hasNodeCommand);
}

test('Node command detection includes Bun fallback but excludes forced Bun execution', () => {
  for (const command of ['node script.mjs', 'npm ci', 'npx vitest', 'bun run test', 'bun run typecheck', 'echo ok && bun run test']) {
    expect(runsNode(command), command).toBe(true);
  }
  for (const command of ['bun test ./packages', 'bun run --bun test', 'bun --bun run test', '# node ignored.mjs', 'echo ok # npm ci']) {
    expect(runsNode(command), command).toBe(false);
  }
});

function nodeSetupViolations(parsed, file) {
  const violations = [];
  for (const [jobName, job] of Object.entries(parsed.jobs ?? {})) {
    let setup;
    for (const step of job.steps ?? []) {
      if (step.uses?.startsWith('actions/setup-node@')) setup = step;
      if (typeof step.run !== 'string' || !runsNode(step.run)) continue;
      if (setup?.uses !== 'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38' ||
          setup.with?.['node-version'] !== '24.22.1' || setup.if !== undefined || setup['continue-on-error']) {
        violations.push(`${file}:${jobName}: ${step.name ?? step.run.split('\n')[0]}`);
      }
    }
  }
  return violations;
}

test.each([
  ["printf '#' | node x.js", 1],
  ['echo "a # b" | npx tsc', 1],
  [String.raw`printf '\"#' | node x.js`, 1],
  [String.raw`echo "a \" # b" | npx tsc`, 1],
  [String.raw`printf \# | node x.js`, 1],
  ['echo ${#value} | node x.js', 1],
  ['echo a#b | node x.js', 1],
  ['echo $(echo a)#b | node x.js', 1],
  [String.raw`echo $'x\'y #' | node x.js`, 1],
  [String.raw`echo $'\' #' | node x.js`, 1],
  ["cat <<EOF\nit's\nEOF\necho ' #'; node x.js", 1],
  ['echo hi # node', 0],
  ['echo hi # "node"', 0],
  ['echo hi # comment; node ignored.js', 1], // Fail-safe union retains the legacy over-detection.
])('workflow job without setup-node: %s', (run, count) => {
  expect(nodeSetupViolations({ jobs: { demo: { steps: [{ run }] } } }, 'fixture.yml')).toHaveLength(count);
});

test('every workflow job running Node has the SHA-pinned setup before execution', () => {
  const directory = new URL('../../.github/workflows/', import.meta.url);
  const violations = readdirSync(directory).filter(file => /\.ya?ml$/.test(file)).sort().flatMap(file =>
    nodeSetupViolations(Bun.YAML.parse(readFileSync(new URL(file, directory), 'utf8')), file));
  expect(violations).toEqual([]);
});
