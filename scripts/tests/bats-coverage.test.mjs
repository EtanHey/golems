import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function fixture(t, manifest) {
  const root = mkdtempSync(join(tmpdir(), 'bats-coverage-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts/ci'), { recursive: true });
  mkdirSync(join(root, 'scripts/tests'));
  copyFileSync(new URL('../ci/run-bats-suites.mjs', import.meta.url), join(root, 'scripts/ci/run-bats-suites.mjs'));
  writeFileSync(join(root, 'scripts/ci/bats-suites.json'), JSON.stringify(manifest));
  writeFileSync(join(root, 'scripts/tests/a.bats'), '');
  return (mode = '--check', env = process.env) => spawnSync(process.execPath,
    [join(root, 'scripts/ci/run-bats-suites.mjs'), mode], { encoding: 'utf8', env });
}

test('unregistered suites fail coverage', t => {
  const result = fixture(t, { run: [], skip: {} })();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Uncovered suite: a.bats/);
});

test('run entries and reasoned skips cover suites', t => {
  assert.equal(fixture(t, { run: ['a.bats'], skip: {} })().status, 0);
  assert.equal(fixture(t, { run: [], skip: { 'a.bats': 'Requires macOS' } })().status, 0);
});

test('stale entries, duplicates, and invalid skip reasons fail', t => {
  for (const manifest of [
    { run: ['a.bats', 'gone.bats'], skip: {} },
    { run: ['a.bats', 'a.bats'], skip: {} },
    { run: ['a.bats'], skip: { 'a.bats': 'Requires macOS' } },
    { run: [], skip: { 'a.bats': '' } },
    { run: [], skip: { 'a.bats': 'two\nlines' } },
  ]) assert.equal(fixture(t, manifest)().status, 1);
});

test('a missing runner command fails even without TAP failure lines', t => {
  const result = fixture(t, { run: ['a.bats'], skip: {} })('--run', { ...process.env, PATH: '' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /FAIL a.bats:.*ENOENT/);
});
