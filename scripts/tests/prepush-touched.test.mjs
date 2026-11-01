import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const source = resolve('.');
const fixturePython = spawnSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).stdout.trim();
mkdirSync(join(source, 'docs.local/n4b'), { recursive: true });
function fixture(t, paths, options = {}) {
  const root = mkdtempSync(join(source, 'docs.local/n4b/fake-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['scripts/ci', 'scripts/tests', '.github/workflows', 'bin', 'skills/golem-powers/example/tests'])
    mkdirSync(join(root, dir), { recursive: true });
  for (const name of ['prepush-touched.sh', 'prepush-touched.mjs', 'run-bats-suites.mjs'])
    cpSync(join(source, 'scripts/ci', name), join(root, 'scripts/ci', name));
  writeFileSync(join(root, 'scripts/ci/bats-suites.json'), JSON.stringify({ run: ['test-example.bats'], skip: {} }));
  writeFileSync(join(root, 'scripts/tests/test-example.bats'), '# scripts/example.sh skills/golem-powers/example/');
  writeFileSync(join(root, 'scripts/tests/example.test.mjs'), "// scripts/example.sh\n");
  writeFileSync(join(root, 'scripts/tests/other.test.mjs'), '// other');
  writeFileSync(join(root, 'skills/golem-powers/example/tests/test_example.py'), '# test');
  writeFileSync(join(root, '.github/workflows/golem-powers-skill-tests.yml'), `jobs:
  script-tests:
    steps:
      - run: node --test scripts/tests/example.test.mjs scripts/tests/other.test.mjs
  python-skill-tests:
    steps:
      - name: Pristine split baseline gate
        run: python scripts/ci/pristine-harness.py check
`);
  writeFileSync(join(root, '.github/workflows/security.yml'), 'jobs: {}');
  if (options.skillBats) writeFileSync(join(root, 'skills/golem-powers/example/tests/example.bats'), '# test');
  if (options.missingYaml) {
    mkdirSync(join(root, 'node_modules/yaml'), { recursive: true });
    writeFileSync(join(root, 'node_modules/yaml/package.json'), '{"type":"module","exports":"./index.mjs"}');
    writeFileSync(join(root, 'node_modules/yaml/index.mjs'), "export { parse } from './not-installed.mjs';");
  }
  for (const [path, content] of Object.entries(options.files || {}))
    writeFileSync(join(root, path), content);
  const log = join(root, 'commands');
  writeFileSync(log, '');
  const fake = `#!${fixturePython}
import json, os, sys
args = sys.argv[1:]
name = os.path.basename(sys.argv[0])
with open(os.environ['COMMAND_LOG'], 'a') as f: f.write(json.dumps([name] + args, separators=(',', ':')) + '\\n')
if name == 'git':
    if args[0] == 'diff':
        sys.stdout.buffer.write(${JSON.stringify(paths.join('\0') + (paths.length ? '\0' : ''))}.encode().replace(b'\\\\0', b'\\0'))
    elif args[0] == 'merge-base': print('base')
    elif args[0] == 'ls-files': print('skills/golem-powers/example/SKILL.md')
    sys.exit(int(os.environ.get('GIT_FAIL', '0')))
if name == 'python' and '-c' in args and os.environ.get('NO_PYTEST'):
    sys.exit(1)
if name == 'bash' and 'run-skill-tests.sh' in ' '.join(args):
    print('skills/golem-powers/example/tests')
if name == 'python' and '-m' in args and 'pytest' in args and os.environ.get('PYTEST_EXIT'):
    sys.exit(int(os.environ['PYTEST_EXIT']))
sys.exit(7 if os.environ.get('FAIL_COMMAND') in [' '.join([name] + args)] else 0)
`;
  for (const name of ['git', 'bash', 'python', 'node', ...(options.noBats ? [] : ['bats'])]) {
    // The real node starts the runner; only its child commands use the shim.
    writeFileSync(join(root, 'bin', name), fake, { mode: 0o755 });
  }
  const env = { ...process.env, PATH: options.isolatedPath ? `${root}/bin` : `${root}/bin:${process.env.PATH}`, COMMAND_LOG: log,
    TMP_BLOCK_LEDGER: join(root, 'ledger.jsonl'), PYTHON_BIN: 'python', ...options };
  const result = spawnSync(process.execPath, [join(root, 'scripts/ci/prepush-touched.mjs'), ...(options.args ?? ['base..head'])],
    { cwd: root, env, input: options.input ?? '', encoding: 'utf8' });
  return { ...result, log: readFileSync(log, 'utf8'), root };
}
test('skill changes scope pytest and cheap gates without unrelated pristine work', t => {
  const r = fixture(t, ['skills/golem-powers/example/SKILL.md']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.log, /"python","-m","pytest","skills\/golem-powers\/example\/tests","-q"/);
  assert.doesNotMatch(r.log, /pristine-harness.py.*check/);
  assert.match(r.log, /check-publish-boundary.sh/);
  assert.match(r.log, /check-model-role-drift.mjs/);
  assert.match(r.log, /canon-drift-lint.mjs/);
  assert.doesNotMatch(r.log, /other.test.mjs/);
});
test('script changes select importing node and bats suites', t => {
  const r = fixture(t, ['scripts/example.sh']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.log, /example.test.mjs/);
  assert.match(r.log, /run-bats-suites.mjs.*--run.*test-example.bats/);
  assert.doesNotMatch(r.log, /other.test.mjs/);
});
test('docs skip suites but retain cheap gates', t => {
  const r = fixture(t, ['README.md']);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.log, /pytest|--test|pristine-harness.py/);
  assert.match(r.log, /check-publish-boundary.sh/);
});
test('failures block and print the failing command', t => {
  const r = fixture(t, ['scripts/example.sh'], { FAIL_COMMAND: 'node --test scripts/tests/example.test.mjs' });
  assert.equal(r.status, 7);
  assert.match(r.stderr, /FAIL.*node --test scripts\/tests\/example.test.mjs/);
});
test('stdin refs handle new branches, multiple refs, and delete-only pushes', t => {
  const r = fixture(t, ['README.md'], { args: [], input: `refs/heads/a tip refs/heads/a old\nrefs/heads/b next refs/heads/b ${'0'.repeat(40)}\n` });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.log, /old\.\.tip/);
  assert.match(r.log, /base\.\.next/);
  const deleted = fixture(t, [], { args: [], input: `refs/heads/a ${'0'.repeat(40)} refs/heads/a old\n` });
  assert.equal(deleted.status, 0, deleted.stderr);
  assert.doesNotMatch(deleted.log, /check-publish-boundary/);
});
test('unknown script mappings fall back to CI script suites', t => {
  const r = fixture(t, ['scripts/unknown.sh']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.log, /other.test.mjs/);
});
test('git errors fail closed', t => {
  const r = fixture(t, [], { GIT_FAIL: '3' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /git diff/);
});
test('escape hatch is loud and writes the existing bypass ledger schema', t => {
  const r = fixture(t, [], { GOLEMS_PREPUSH_TOUCHED: '0' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /SKIP.*GOLEMS_PREPUSH_TOUCHED=0/);
  const entry = JSON.parse(readFileSync(join(r.root, 'ledger.jsonl'), 'utf8'));
  assert.equal(entry.hatch, 'GOLEMS_PREPUSH_TOUCHED=0');
  assert.equal(entry.cwd, r.root);
});

test('empty stdin uses the branch merge-base range', t => {
  const r = fixture(t, ['README.md'], { args: [] });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.log, /base\.\.HEAD/);
});
test('an unwritable ledger blocks the escape hatch', t => {
  const r = fixture(t, [], { GOLEMS_PREPUSH_TOUCHED: '0', TMP_BLOCK_LEDGER: source });
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.stderr, /SKIP/);
});
test('hook preserves package failure and only then calls touched suites', t => {
  const root = mkdtempSync(join(source, 'docs.local/n4b/hook-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'bin'));
  for (const status of [0, 7]) {
    writeFileSync(join(root, 'bin/bun'), `#!/bin/sh\nexit ${status}\n`, { mode: 0o755 });
    writeFileSync(join(root, 'bin/bash'), '#!/bin/sh\necho touched-suite-called\n', { mode: 0o755 });
    const hook = spawnSync('/bin/bash', [join(source, '.githooks/pre-push')], {
      cwd: root, input: '', encoding: 'utf8',
      env: { ...process.env, HOME: root, PATH: `${root}/bin:${process.env.PATH}` },
    });
    assert.equal(hook.status, status, hook.stderr);
    assert.equal(hook.stdout.includes('touched-suite-called'), !status);
  }
});

test('pristine input changes also run the CI baseline command', t => {
  const r = fixture(t, ['skills/golem-powers/_shared/shell_parse.py']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.log, /pristine-harness.py.*check/);
});

test('missing bats defers both skill and registered suites with one warning', t => {
  const r = fixture(t, ['skills/golem-powers/example/SKILL.md'], { noBats: true, isolatedPath: true, skillBats: true });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /prepush-touched: bats not installed here; 2 bats suites will run in CI/);
  assert.equal(r.stderr.match(/bats not installed here/g)?.length, 1);
});
test('missing Python defers its suites to CI', t => {
  const r = fixture(t, ['skills/golem-powers/example/SKILL.md'], { PYTHON_BIN: 'fixture-python-not-installed' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /fixture-python-not-installed not installed here;.*CI/);
});
test('missing yaml defers workflow-selected suites after the cheap gates', t => {
  const r = fixture(t, ['scripts/example.sh'], { missingYaml: true });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /yaml not installed here;.*CI/);
  assert.match(r.log, /check-model-role-drift.mjs/);
});

test('missing pytest and Ruby defer only dependent checks to CI', t => {
  const r = fixture(t, ['skills/golem-powers/example/SKILL.md'], {
    NO_PYTEST: '1', PUBLISH_BOUNDARY_RUBY_BIN: 'fixture-ruby-not-installed',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /pytest not installed here;.*CI/);
  assert.match(r.stderr, /ruby not installed here;.*CI/);
  assert.doesNotMatch(r.log, /"python","-m","pytest"|check-publish-boundary.sh/);
});
test('shell entry point defers to CI when node is missing', t => {
  const r = spawnSync('/bin/bash', ['scripts/ci/prepush-touched.sh'], {
    cwd: source, env: { ...process.env, PATH: '' }, encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /node not installed here;.*CI/);
});

for (const [name, selected] of [['test-x.py', false], ['test_x.py', true], ['x_test.py', true]]) {
  test(`pytest discovery ${selected ? 'includes' : 'excludes'} ${name}`, t => {
    const path = `scripts/tests/${name}`;
    const r = fixture(t, ['scripts/example.sh'], { files: { [path]: '# scripts/example.sh' } });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.log.includes(JSON.stringify(['python', '-m', 'pytest', path, '-q'])), selected);
  });
}
test('pattern-selected pytest exit 5 warns and passes', t => {
  const r = fixture(t, ['scripts/example.sh'], {
    files: { 'scripts/tests/test_empty.py': '# scripts/example.sh' }, PYTEST_EXIT: '5',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /WARN.*no tests collected.*test_empty\.py/);
});
test('explicit pytest exit 5 still blocks even when also discovered by pattern', t => {
  const r = fixture(t, ['scripts/example.sh'], {
    files: {
      'scripts/tests/test_explicit.py': '# scripts/example.sh',
      '.github/workflows/security.yml': 'jobs:\n  check:\n    steps:\n      - run: python -m pytest scripts/tests/test_explicit.py -q\n',
    }, PYTEST_EXIT: '5',
  });
  assert.equal(r.status, 5, r.stderr);
  assert.match(r.stderr, /FAIL.*pytest.*test_explicit\.py/);
  assert.doesNotMatch(r.stderr, /WARN.*no tests collected/);
});
test('pattern-selected pytest assertion failures still block', t => {
  const r = fixture(t, ['scripts/example.sh'], {
    files: { 'scripts/tests/test_failure.py': '# scripts/example.sh' }, PYTEST_EXIT: '1',
  });
  assert.equal(r.status, 1, r.stderr);
});
