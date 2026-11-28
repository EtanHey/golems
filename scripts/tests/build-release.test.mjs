import { afterEach, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRelease, createManifest, shipped } from '../release/build-release.mjs';
import { closureViolations, scriptReferences } from './release-closure.mjs';

test('installed commands named by skills are shipped', () => {
  const repo = new URL('../../', import.meta.url);
  const docs = execFileSync('git', ['ls-files', 'skills/golem-powers/**/*.md'],
    { cwd: repo, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const missing = [];
  for (const doc of docs) {
    const text = readFileSync(new URL(doc, repo), 'utf8');
    for (const match of text.matchAll(/~\/\.golems\/current\/([A-Za-z0-9_./-]+)/g)) {
      if (!shipped(match[1])) missing.push(`${doc} -> ${match[1]}`);
    }
  }
  expect(missing).toEqual([]);
});

test('every shipped script includes its repository dependencies in the release', () => {
  const repo = new URL('../../', import.meta.url);
  // Re-run the identical scanner against committed baseline objects and policy.
  const baseline = process.env.RELEASE_CLOSURE_BASE;
  let files;
  if (baseline) {
    const records = execFileSync('git', ['ls-tree', '-rz', baseline], { cwd: repo, encoding: 'utf8' }).split('\0').filter(Boolean).map(record => {
      const [metadata, file] = record.split('\t');
      return { file, oid: metadata.split(' ')[2] };
    });
    const blobs = execFileSync('git', ['cat-file', '--batch'], { cwd: repo, input: records.map(row => row.oid + '\n').join(''), maxBuffer: 128 * 1024 * 1024 });
    let offset = 0;
    files = new Map(records.map(({ file }) => {
      const end = blobs.indexOf(10, offset);
      const length = Number(blobs.subarray(offset, end).toString().split(' ')[2]);
      const source = blobs.subarray(end + 1, end + 1 + length).toString();
      offset = end + length + 2;
      return [file, source];
    }));
  } else {
    const paths = execFileSync('git', ['ls-files', '-z'], { cwd: repo, encoding: 'utf8' }).split('\0').filter(Boolean);
    files = new Map(paths.map(file => [file, readFileSync(new URL(file, repo), 'utf8')]));
  }
  const policy = baseline && JSON.parse(execFileSync('git', ['show', `${baseline}:scripts/release/shipped-paths.json`], { cwd: repo, encoding: 'utf8' }));
  const selected = policy ? file => (policy.support.includes(file) || policy.roots.some(root => file.startsWith(root))) &&
    !file.split('/').some(part => policy.excluded_parts.includes(part)) && !new RegExp(policy.excluded_files).test(file) : shipped;
  // No checkout-only exceptions are currently needed by these literal forms.
  // Any future exception must be an exact "source -> target": "reason" pair.
  const checkoutOnly = {};
  expect(closureViolations(files, selected, checkoutOnly)).toEqual([]);
});

test.each([
  ['scripts/run.sh', 'source "$SCRIPT_DIR/lib/helper.py"'],
  ['scripts/run.bash', '. "${HERE}/lib/helper.py"'],
  ['scripts/run.sh', 'python3 "$SCRIPT_DIR/lib/helper.py"'],
  ['scripts/lib/run.sh', 'python3 "$SCRIPT_DIR/lib/helper.py"'],
  ['scripts/run.sh', 'node ./lib/helper.py'],
  ['scripts/run.sh', 'bash "./lib/helper.py"'],
  ['scripts/run', '#!/bin/sh\nsource ./lib/helper.py'],
  ['scripts/run.mjs', "import './lib/helper.py'"],
  ['scripts/run.js', "const helper = require('./lib/helper.py')"],
  ['scripts/run.ts', "import helper from './lib/helper.py'"],
  ['scripts/run.mjs', "readFileSync(new URL('./lib/helper.py', import.meta.url))"],
  ['scripts/run.mjs', "const here = dirname(fileURLToPath(import.meta.url)); readFileSync(join(here, 'lib', 'helper.py'))"],
  ['scripts/lib/run.py', "Path(__file__).with_name('helper.py')"],
  ['scripts/run.py', "Path(__file__).resolve().parent / 'lib' / 'helper.py'"],
  ['scripts/nested/run.py', "Path(__file__).parents[1] / 'lib/helper.py'"],
  ['scripts/run.py', "HERE = Path(__file__).resolve().parent\nhelper = HERE / 'lib/helper.py'"],
  ['scripts/lib/run.py', 'from .helper import run'],
])('closure rejects an omitted dependency in %s: %s', (file, source) => {
  const target = 'scripts/lib/helper.py';
  const files = new Map([[file, source], [target, 'pass']]);
  expect(closureViolations(files, candidate => candidate === file)).toEqual([`${file} -> ${target}`]);
  expect(closureViolations(files, () => true)).toEqual([]);
});

test('closure resolves extensionless imports, ignores absent external files, and scopes exceptions to one edge', () => {
  const files = new Map([
    ['scripts/run.ts', "import './helper'; import './absent'; import 'external'"],
    ['scripts/helper.ts', 'export const value = 1'],
    ['scripts/other.ts', "import './helper'"],
  ]);
  const selected = file => file !== 'scripts/helper.ts';
  expect(closureViolations(files, selected)).toHaveLength(2);
  expect(closureViolations(files, selected, { 'scripts/run.ts -> scripts/helper.ts': 'Checkout-only example' }))
    .toEqual(['scripts/other.ts -> scripts/helper.ts']);
  expect(scriptReferences('scripts/run.py', "# Path(__file__).with_name('ignored.py')")).toEqual([]);
});

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
  script = script.replace(/\\\r?\n/g, '');
  const hasNodeCommand = code => /\b(?:node|npm|npx)(?:\s|$)/.test(code) ||
    (/\bbun\s+run(?:\s|$)/.test(code) && !/(?:^|\s)--bun(?:\s|$)/.test(code));
  const legacy = script.split(/\n|&&|\|\||;/).some(command => hasNodeCommand(command.replace(/#.*/, '')));
  const commands = script.replace(/\$'(?:\\.|[^'\\])*'|'[^']*'|"(?:\\.|[^"\\])*"|\\.|(?<![^\s;&|(<>])#[^\n]*/g,
    token => token.startsWith('#') ? '' : token);
  // AIDEV-NOTE: Heredoc bodies are classified like any other line (fail closed); the legacy union stays as a safety net.
  // Shell quote removal: unquoted backslashes, '…', $'…' and "…" (where only \$ \` \" \\ are escapes).
  // marked() turns quoted or escaped expansion characters into U+FFFD, so only active ones count as expansions.
  const literal = text => text.replace(/[$`*?\[\]{}]/g, '\uFFFD');
  // $'…' bodies decode ANSI-C escapes; an escape without an established result (NUL, \c, unknown) becomes an active `$`.
  const ansiEscapes = { a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' };
  const ansiC = (body, mark) => body.replace(/([^\\]+)|\\(?:x([\da-fA-F]{1,2})|u([\da-fA-F]{1,4})|U([\da-fA-F]{1,8})|([0-7]{1,3})|(.))/gs,
    (_, text, hex, short, long, octal, other) => {
      const code = parseInt(hex ?? short ?? long ?? octal, octal ? 8 : 16);
      const decoded = text ?? (other !== undefined ? ansiEscapes[other] : code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : undefined);
      return decoded === undefined ? '$' : mark(decoded);
    });
  const unquote = (word, mark) => word.replace(/\\(.)|\$'((?:\\.|[^'\\])*)'|'([^']*)'|"((?:\\.|[^"\\])*)"/gs,
    (_, escaped, ansi, single, double) => ansi !== undefined ? ansiC(ansi, mark) : double === undefined ? mark(escaped ?? single) :
      double.replace(/\\([$`"\\])|[*?\[\]{}]/g, (token, escapedInDouble) => mark(escapedInDouble ?? token)));
  const plain = word => unquote(word, text => text);
  const marked = word => unquote(word, literal);
  // Leading wrappers run their command word; the listed options consume the next word.
  const wrapperValues = {
    builtin: [], command: [], exec: ['-a'], env: ['-u', '-C', '--unset', '--chdir'], nice: ['-n', '--adjustment'], nohup: [],
    time: ['-f', '-o', '--format', '--output'], timeout: ['-s', '-k', '--signal', '--kill-after'],
    xargs: ['-a', '-d', '-E', '-I', '-L', '-n', '-P', '-s', '--arg-file', '--delimiter', '--max-args', '--max-procs', '--max-chars'],
  };
  const expansion = /[$`*?\[\]{}]/;
  return legacy || commands.split(/\n|&&|\|\||\||;/).some(command => {
    const words = command.match(/(?:\\.|\$'(?:\\.|[^'\\])*'|'[^']*'|"(?:\\.|[^"\\])*"|[^\s'"\\])+/g) ?? [];
    for (;;) {
      while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0] ?? '')) words.shift();
      const wrapper = plain(words[0] ?? '').split('/').at(-1);
      if (!Object.hasOwn(wrapperValues, wrapper)) break;
      if (wrapper === 'exec' && words.slice(1).some(word => expansion.test(marked(word)))) return true;
      words.shift();
      for (let option; (option = plain(words[0] ?? '')).startsWith('-');) {
        words.shift();
        if (option === '--') break;
        if (wrapperValues[wrapper].includes(option)) words.shift();
      }
      if (wrapper === 'timeout') words.shift();
    }
    if (words.length === 0) return false;
    const program = marked(words[0]).split('/').at(-1);
    if (expansion.test(program) || program === 'eval') return true;
    const args = words.map(plain);
    // The -c argument is shell code, so classify it as its own script. The outer shell expands it first,
    // so an active `$` or backtick there fails closed; only quoted or escaped ones are literal script text.
    const shellCommand = ['sh', 'bash', 'dash', 'zsh'].includes(program) ? args.findIndex(word => /^-[A-Za-z]*c[A-Za-z]*$/.test(word)) : -1;
    if (shellCommand !== -1 && (/[$`]/.test(marked(words[shellCommand + 1] ?? '')) || runsNode(args[shellCommand + 1] ?? ''))) return true;
    if (['node', 'npm', 'npx'].includes(program)) return true;
    if (hasNodeCommand(args.join(' '))) return true;
    const bun = args.indexOf('bun');
    return bun !== -1 && args.slice(bun + 1).includes('run') && !args.slice(bun + 1).includes('--bun');
  });
}

test.each(['node script.mjs', 'npm ci', 'npx vitest', 'bun run test', 'bun run typecheck', 'echo ok && bun run test', 'bun \\\n  run test', "n''ode script.mjs", '"node" script.mjs', 'echo --bun | bun run test', '$VAR script.mjs', '$(command) script.mjs', 'eval something'])('detects Node execution: %s', command => {
  expect(runsNode(command)).toBe(true);
});

test.each(['"$dir/node" x.mjs', '"$BIN" x', '$CMD run', '"$dir/$tool" x', '$(which node) x', 'eval "$X"', '$X/npx x', './node_modules/.bin/npm ci', 'sh -c "$X"', 'bash -c "$X"', 'exec "$X"'])('detects dynamic or Node program: %s', command => {
  expect(runsNode(command)).toBe(true);
});

// Reviewer reproductions from golems#969 (B1 heredoc bodies, B2 backslash quoting, B3 -c bundles, B4/F1 wrappers).
// F2 (`node& wait`, `(node)`) is FOLLOWUP-969-SEPARATORS: splitting on `&`/`(`/`)` flags a committed Python heredoc.
test.each([
  "bash <<'EOF'\necho '#' | node x.mjs\nEOF", "bash <<'EOF'\n\"node\" x.mjs\nEOF", "bash <<'EOF'\nn''ode x.mjs\nEOF",
  "bash <<'EOF'\n\"$Y\" x.mjs\nEOF", "bash <<'EOF'\n\"bun\" \"run\" probe\nEOF", "cat <<'EOF'\nit's\nEOF\n\"node\" x.mjs",
  String.raw`n\ode x.mjs`, String.raw`n\pm --version`, String.raw`n\px --version`, String.raw`b\un r\un probe`,
  'sh -ec "$X"', 'bash -ec "$X"', 'bash -ce "$X"', 'bash -xec "$X"', 'zsh -ec "$X"', "sh -c '$X'", "bash -c '\"node\" x'",
  'command sh -c "$X"', 'env bash -c "$X"', 'command eval "$X"', 'command exec "$Y" x.mjs', 'env "$Y" x.mjs', 'nice "$Y" x.mjs',
  'env node x', 'env -i FOO=1 node x', 'nice -n 5 "$Y" x', 'nohup node x', 'timeout -s KILL 5m "$Y" x', 'xargs -n 1 node', 'builtin eval "$X"', 'time -p "$Y" x',
])('detects reviewer bypass: %s', command => {
  expect(runsNode(command)).toBe(true);
});

// Round 3 (golems#969 re-review): R2-R1 outer-expanded -c arguments, R2-R2 ANSI-C escapes decoded or failed closed.
test.each([
  'bash -c "echo $X"', 'bash -c "$X/anything"', 'sh -ec "echo $X"', 'env bash -c "echo $X"', 'bash -c "$(cat f)"', 'bash -c "echo `cat f`"',
  "sh -c '$X'", String.raw`bash -c 'n\ode x'`, String.raw`$'n\x6fde' x.mjs`, String.raw`$'n\157de' x.mjs`, String.raw`$'node' x.mjs`, String.raw`$'node\0x' x.mjs`,
])('job without setup-node flags round-2 regression: %s', run => {
  expect(nodeSetupViolations({ jobs: { demo: { steps: [{ run }] } } }, 'fixture.yml')).toHaveLength(1);
});

test.each(['"$dir/trufflehog" --version', '"$RUNNER_TEMP/x/trufflehog" scan', String.raw`'n\ode' x.mjs`, 'env FOO=1 "$dir/trufflehog" --version', 'timeout 5m "$dir/trufflehog" scan',
  "bash -c 'echo $X'", String.raw`bash -c "echo \$X"`, String.raw`$'\x24dir/trufflehog' --version`, String.raw`$'tr\165fflehog' --version`])('accepts literal non-Node program: %s', command => {
  expect(runsNode(command)).toBe(false);
});

test('Node command detection excludes forced Bun execution', () => {
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
