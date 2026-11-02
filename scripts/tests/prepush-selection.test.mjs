import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
function run(command, cwd = root) {
  const result = spawnSync(command[0], command.slice(1), {
    cwd, encoding: 'utf8', timeout: 50_000, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(result.status, 0, `${command.join(' ')}: ${result.error || ''}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
const list = cwd => JSON.parse(run(['node', 'scripts/ci/prepush-touched.mjs', '--list', '--all'], cwd));

test('whole-tree pre-push selection collects tests and works from a T3 checkout', { timeout: 60_000 }, () => {
  const selection = list(root);
  assert.ok(selection.suites.length > 0, 'whole-tree selection must not be empty');
  const pytest = selection.suites.filter(s => s.command.includes('pytest'));
  for (const suite of pytest) {
    assert.match(suite.path, /\/(?:test_[^/]*|[^/]*_test)\.py$/, `invalid pytest target: ${suite.path}`);
  }
  const paths = [...new Set(pytest.filter(s => s.patternSelected).map(s => s.path))].sort();
  assert.ok(paths.length > 0, 'pattern-selected pytest files must not be empty');
  const collected = run(['python3', '-m', 'pytest', '--collect-only', '-q', '-p', 'no:cacheprovider', ...paths]);
  const counts = new Map();
  for (const line of collected.split('\n')) {
    const [path, node] = line.split('::');
    if (node) counts.set(path, (counts.get(path) || 0) + 1);
  }
  const empty = paths.filter(path => !counts.has(path));
  assert.deepEqual(empty, [], `selected files collect zero tests: ${empty.join(', ')}`);

  // Temporary checkout exercises the real Git/T3 path guards; fixture state stays in ~/.cache.
  const scratch = mkdtempSync(join(tmpdir(), 'prepush-selection-'));
  const checkout = join(scratch, '.t3/worktrees/golems/t3-ratchet');
  try {
    mkdirSync(dirname(checkout), { recursive: true });
    run(['git', 'worktree', 'add', '--detach', checkout, 'HEAD']);
    // Dependencies are shared read-only; the detached checkout owns all test output.
    symlinkSync(join(root, 'node_modules'), join(checkout, 'node_modules'), 'dir');
    assert.deepEqual(list(checkout), selection, 'selection differs under a T3 checkout path');
    run(['python3', '-m', 'pytest', '-q', '-p', 'no:cacheprovider',
      'scripts/tests/test_workspace_lane.py', 'scripts/tests/test_workspace_shared_holds.py'], checkout);
  } finally {
    run(['git', 'worktree', 'remove', '--force', checkout]);
    rmSync(scratch, { recursive: true, force: true });
  }
});
