import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, symlinkSync, rmSync, unlinkSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { syncClones } from '../ci/boundary-clones.mjs';

test('symlink alias converges once and preserves custody and original hook chain', () => {
  const scratch = resolve('docs.local/boundary-clones-test');
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, 'alias-'));
  const repo = join(root, 'canonical');
  mkdirSync(repo);
  const git = (...args) => {
    const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    git('init', '-q');
    const original = join(realpathSync(repo), '.git/hooks');
    writeFileSync(join(original, 'pre-commit'), '#!/bin/sh\nprintf original-chain\n', { mode: 0o755 });
    const hook = readFileSync(join(original, 'pre-commit'), 'utf8');
    symlinkSync(repo, join(root, 'alias'), 'dir');
    const reports = [];
    assert.equal(syncClones({ root, apply: true, report: line => reports.push(line) }), 0);
    assert.equal(syncClones({ root, report() {} }), 0, 'status after apply must converge');
    assert.equal(reports.filter(line => line.startsWith('boundary-prepush clone=')).length, 1);
    assert.equal(reports.at(-1), 'boundary-prepush-drift=0 clones=1');
    const managed = join(realpathSync(repo), '.git/golems-boundary-hooks');
    assert.equal(git('config', '--get', 'core.hooksPath'), managed);
    const record = join(repo, '.git/golems-boundary-hooks.json');
    assert.deepEqual(JSON.parse(readFileSync(record, 'utf8')), { original: null });
    assert.equal(readFileSync(join(original, 'pre-commit'), 'utf8'), hook);
    const chained = spawnSync(join(managed, 'pre-commit'), [], { cwd: repo, encoding: 'utf8', timeout: 3000 });
    assert.equal(chained.status, 0, chained.stderr);
    assert.equal(chained.stdout, 'original-chain');
    const custody = readFileSync(record, 'utf8');
    assert.equal(syncClones({ root, apply: true, report() {} }), 0);
    assert.equal(readFileSync(record, 'utf8'), custody);
    // A final-state change must survive apply's summary and return code.
    const driftReports = [];
    assert.equal(syncClones({ root, apply: true, report(line) {
      driftReports.push(line);
      if (line.startsWith('boundary-prepush clone=') && !line.endsWith(' drift')) unlinkSync(join(managed, 'pre-commit'));
    } }), 1);
    assert.ok(driftReports.some(line => line.startsWith('boundary-prepush clone=') && line.endsWith(' drift')));
    assert.equal(driftReports.at(-1), 'boundary-prepush-drift=1 clones=1');
    assert.equal(syncClones({ root, report() {} }), 1);
    assert.equal(syncClones({ root, apply: true, report() {} }), 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const poisonedRecord of [false, true]) {
  test(`alias-spelled managed hooks refuse ${poisonedRecord ? 'self-pointing' : 'missing'} custody`, () => {
    const scratch = resolve('docs.local/boundary-clones-test');
    mkdirSync(scratch, { recursive: true });
    const root = mkdtempSync(join(scratch, 'custody-'));
    const repo = join(root, 'canonical');
    mkdirSync(repo);
    const git = (...args) => {
      const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
    };
    try {
      git('init', '-q');
      symlinkSync(repo, join(root, 'alias'), 'dir');
      syncClones({ root, apply: true, report() {} });
      const aliasHooks = join(root, 'alias/.git/golems-boundary-hooks');
      const record = join(repo, '.git/golems-boundary-hooks.json');
      const hook = join(aliasHooks, 'pre-commit');
      const before = readFileSync(hook, 'utf8');
      git('config', 'core.hooksPath', aliasHooks);
      if (poisonedRecord) writeFileSync(record, JSON.stringify({ original: aliasHooks }) + '\n');
      else unlinkSync(record);
      for (const apply of [false, true]) {
        assert.throws(() => syncClones({ root, apply, report() {} }),
          poisonedRecord ? /invalid original hooks path/ : /managed hooks have no custody record/);
      }
      assert.equal(readFileSync(hook, 'utf8'), before);
      if (!poisonedRecord) assert.equal(existsSync(record), false);
      const chained = spawnSync(hook, [], { cwd: repo, encoding: 'utf8', timeout: 3000 });
      assert.equal(chained.status, 0, chained.error?.message ?? chained.stderr);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
