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

test('a missing bats fails in CI even without TAP failure lines', t => {
  const result = fixture(t, { run: ['a.bats'], skip: {} })('--run', { ...process.env, PATH: '' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /FAIL a.bats:.*ENOENT/);
});

test('requested Bats suites run once; unknown or skipped selections fail', t => {
  const root = mkdtempSync(join(tmpdir(), 'bats-selection-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['scripts/ci', 'scripts/tests', 'bin']) mkdirSync(join(root, dir), { recursive: true });
  copyFileSync(new URL('../ci/run-bats-suites.mjs', import.meta.url), join(root, 'scripts/ci/run-bats-suites.mjs'));
  writeFileSync(join(root, 'scripts/ci/bats-suites.json'), JSON.stringify({ run: ['a.bats', 'b.bats'], skip: { 'c.bats': 'Unavailable' } }));
  for (const name of ['a', 'b', 'c']) writeFileSync(join(root, `scripts/tests/${name}.bats`), '');
  writeFileSync(join(root, 'bin/bats'), '#!/bin/sh\nprintf "EXEC %s\\n" "$@"\n', { mode: 0o755 });
  const invoke = names => spawnSync(process.execPath, [join(root, 'scripts/ci/run-bats-suites.mjs'), '--run', ...names],
    { encoding: 'utf8', env: { ...process.env, PATH: `${root}/bin` } });
  const selected = invoke(['a.bats', 'a.bats']);
  assert.equal(selected.status, 0, selected.stderr);
  assert.equal(selected.stdout.match(/EXEC scripts\/tests\/a.bats/g)?.length, 1);
  assert.doesNotMatch(selected.stdout, /EXEC scripts\/tests\/b.bats/);
  for (const name of ['missing.bats', 'c.bats']) assert.notEqual(invoke([name]).status, 0);
});
