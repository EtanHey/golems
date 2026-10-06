import { test, expect } from 'bun:test';
import { evaluate, parseRows } from '../ratchet/table.mjs';
import { runRows } from '../ratchet/run-rows.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
mkdirSync(resolve('docs.local/l3-tests'), { recursive: true });
const script = resolve(import.meta.dir, '../ratchet/measure-code.py');
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const rows = JSON.parse(readFileSync(resolve(import.meta.dir, '../ratchet/rows.json'))).rows;
function fixture(fn) {
  const cwd = mkdtempSync(resolve('docs.local/l3-tests/debt-'));
  const run = (...args) => spawnSync('python3', [script, ...args], { cwd, encoding: 'utf8' });
  try {
    spawnSync('git', ['init', '-q'], { cwd, env: cleanEnv });
    fn(cwd, run);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}
test('undefined-name mutation grows the count; tracked vendor and local files stay excluded', () => fixture((cwd, run) => {
  writeFileSync(join(cwd, 'app.py'), 'print(1)\n');
  for (const dir of ['vendor', 'vendored', 'node_modules', '.worktrees', 'docs.local']) {
    mkdirSync(join(cwd, dir)); writeFileSync(join(cwd, dir, 'bad.py'), 'print(excluded_name)\n');
  }
  spawnSync('git', ['add', '-f', '.'], { cwd, env: cleanEnv });
  expect(run('--undefined-names').status).toBe(0);
  expect(run('--undefined-names').stdout.trim()).toBe('0');
  writeFileSync(join(cwd, 'app.py'), 'print(new_undefined_name)\n');
  expect(run('--undefined-names').stdout.trim()).toBe('1');
  writeFileSync(join(cwd, 'app.py'), 'def broken(:\n');
  expect(run('--undefined-names').status).not.toBe(0);
}));
test('line-count mutation exceeds ceiling and missing file fails closed', () => fixture((cwd, run) => {
  writeFileSync(join(cwd, 'app.py'), 'a\nb\n');
  expect(run('--lines', 'app.py').stdout.trim()).toBe('2');
  writeFileSync(join(cwd, 'app.py'), 'a\nb\nc\n');
  expect(Number(run('--lines', 'app.py').stdout)).toBeGreaterThan(2);
  expect(run('--lines', 'missing.py').status).not.toBe(0);
}));
test('CI debt rows exist and are numeric ceilings', () => {
  for (const id of ['py-undefined-names', 'size-repogolem-config', 'size-install-hooks', 'size-rm', 'size-codex-dispatch', 'size-tmp-block']) {
    const row = rows.find(r => r.id === id);
    expect(row).toBeDefined(); expect(row.runner).toBe('ci'); expect(row.direction).toBe('max');
    expect(typeof row.ceiling).toBe('number');
  }
});

test('each actual debt row fails the table on growth and passes after restoration', () => {
  const root = resolve(import.meta.dir, '../..');
  for (const row of rows.filter(r => r.id === 'py-undefined-names' || r.id.startsWith('size-'))) {
    const path = join(root, row.id === 'py-undefined-names' ? 'skills/golem-powers/git-guardian/git_safety_impl/rm.py' : row.command.split('--lines ')[1]);
    const original = readFileSync(path);
    const selected = parseRows({ schema: 1, rows: [row] });
    const verdict = () => evaluate({ rows: selected, baseRows: selected, head: 'fixture', results: runRows({ rows: selected, cwd: root, head: 'fixture' }) });
    try {
      expect(verdict().ok).toBe(true);
      writeFileSync(path, Buffer.concat([original, Buffer.from(row.id === 'py-undefined-names' ? '\nprint(ratchet_new_undefined_name)\n' : '\n')]));
      expect(verdict().rows[0].status).toBe('FAIL');
    } finally { writeFileSync(path, original); }
    expect(verdict().ok).toBe(true);
  }
});
