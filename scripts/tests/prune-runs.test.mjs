import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { planRuns, applyPlan } from '../ratchet/prune-runs.mjs';

// A fresh checkout (hosted CI) has no docs.local/ yet.
const scratch = () => { fs.mkdirSync('docs.local', { recursive: true }); return fs.mkdtempSync(path.resolve('docs.local/retention-test-')); };

test('size row counts symlinks by lstat without following cycle, absolute, relative or dangling targets', () => {
  const root = scratch();
  const cli = path.resolve('scripts/ratchet/mac/ratchet-runs-size.mjs');
  try {
    const repo = path.join(root, 'repo');
    fs.mkdirSync(repo);
    execFileSync('git', ['init', '--quiet', repo]);
    const runs = path.join(repo, 'docs.local/ratchet-runs');
    const run = path.join(runs, 'm1-procedure-aaaaaaa-20260101T000000');
    const outside = path.join(root, 'outside');
    fs.mkdirSync(run, { recursive: true });
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'keep'), Buffer.alloc(64 * 1024));
    fs.writeFileSync(path.join(run, 'receipt.log'), 'receipt');
    const links = { cycle: '.', absolute: outside, relative: path.relative(run, outside), dangling: 'missing' };
    for (const [name, target] of Object.entries(links)) fs.symlinkSync(target, path.join(run, name));
    const expectedBytes = [runs, run, ...fs.readdirSync(run).map(name => path.join(run, name))]
      .reduce((sum, entry) => sum + fs.lstatSync(entry).blocks * 512, 0);
    const result = spawnSync(process.execPath, [cli], { cwd: repo, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    const measured = JSON.parse(result.stdout);
    assert.equal(measured.bytes, expectedBytes);
    assert.equal(measured.health, true);
    assert.throws(() => planRuns(runs, { citations: '' }), /symlink refused/);
    assert.equal(fs.statSync(path.join(outside, 'keep')).size, 64 * 1024);
  } finally { fs.rmSync(root, { recursive: true }); }
});

test('apply refuses links introduced after planning without deleting through them', () => {
  const root = scratch();
  const old = new Date(Date.now() - 4 * 3600000);
  const names = ['pr1-aaaaaaa-20260101T000000', 'pr1-bbbbbbb-20260102T000000'];
  try {
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'keep'), 'preserve');
    for (const name of names) { fs.mkdirSync(path.join(root, name)); fs.utimesSync(path.join(root, name), old, old); }
    const plan = planRuns(root, { keep: 1, citations: '' });
    assert.equal(plan.find(row => row.name === names[0]).action, 'delete');
    const run = path.join(root, names[0]);
    for (const target of ['.', outside, '../outside', 'missing']) {
      const link = path.join(run, 'fixture');
      fs.symlinkSync(target, link);
      fs.utimesSync(run, old, old);
      assert.throws(() => applyPlan(root, plan), /symlink refused/);
      assert.equal(fs.readFileSync(path.join(outside, 'keep'), 'utf8'), 'preserve');
      assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
      fs.unlinkSync(link);
    }
    assert.equal(fs.existsSync(run), true);
  } finally { fs.rmSync(root, { recursive: true }); }
});

test('retention protects cited, recent and unknown runs; apply matches dry plan', () => {
  const root = scratch();
  const old = new Date(Date.now() - 4 * 3600000);
  const names = ['pr1-aaaaaaa-20260101T000000', 'pr1-aaaaaaa-20260102T000000',
    'pr1-bbbbbbb-20260103T000000', 'pr1-ccccccc-20260104T000000',
    'm1-procedure-aaaaaaa-20260101T000000123456', 'pr1-ddddddd-20260101T000000', 'unknown'];
  try {
    for (const name of names) { fs.mkdirSync(path.join(root, name)); fs.utimesSync(path.join(root, name), old, old); }
    fs.utimesSync(path.join(root, names[5]), new Date(), new Date());
    const plan = planRuns(root, { keep: 1, citations: 'receipt bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' });
    assert.deepEqual(plan.filter(x => x.action === 'delete').map(x => x.name), names.slice(0, 2));
    assert.equal(fs.readdirSync(root).length, names.length);
    assert.match(plan.find(x => x.name === 'unknown').reason, /unparseable/);
    applyPlan(root, plan);
    assert.deepEqual(fs.readdirSync(root).sort(), names.slice(2).sort());
  } finally { fs.rmSync(root, { recursive: true }); }
});

test('refuses symlinks, including nested and root aliases; rechecks changed plans', () => {
  const root = scratch();
  try {
    const name = 'pr1-aaaaaaa-20260101T000000';
    fs.symlinkSync('..', path.join(root, name));
    assert.throws(() => planRuns(root, { citations: '' }), /symlink/);
    fs.unlinkSync(path.join(root, name)); fs.mkdirSync(path.join(root, name));
    fs.symlinkSync('..', path.join(root, name, 'escape'));
    assert.throws(() => planRuns(root, { citations: '' }), /symlink/);
    fs.unlinkSync(path.join(root, name, 'escape'));
    assert.throws(() => applyPlan(root, [{ name: '../outside', action: 'delete' }]), /child/);
    const alias = `${root}-alias`; fs.symlinkSync(root, alias);
    try { assert.throws(() => planRuns(alias, { citations: '' }), /symlink/); } finally { fs.unlinkSync(alias); }
  } finally { fs.rmSync(root, { recursive: true }); }
});

import { validRunsMeasurement, parseRows } from '../ratchet/table.mjs';
test('budget fixtures are measured fail/pass and row policy stays scoped', () => {
  for (const [suffix, health] of [['over', false], ['under', true]]) {
    const m = JSON.parse(fs.readFileSync(`scripts/ratchet/fixtures/ratchet-runs-size-${suffix}.json`));
    assert.equal(validRunsMeasurement(m), true);
    assert.equal(m.health, health);
    assert.equal(validRunsMeasurement({ ...m, health: !health }), false);
  }
  const doc = JSON.parse(fs.readFileSync('scripts/ratchet/rows.json'));
  assert.doesNotThrow(() => parseRows(doc));
  doc.rows.at(-1).id = 'unapproved-row';
  assert.throws(() => parseRows(doc), /report-only/);
});

test('named citation and descendant writes protect runs; changed plan is refused', () => {
  const root = scratch();
  const old = new Date(Date.now() - 4 * 3600000);
  const names = ['pr2-aaaaaaa-20260101T000000', 'pr2-bbbbbbb-20260102T000000', 'pr2-ccccccc-20260103T000000'];
  try {
    for (const name of names) { fs.mkdirSync(path.join(root, name)); fs.utimesSync(path.join(root, name), old, old); }
    assert.equal(planRuns(root, { keep: 1, citations: names[0] })[0].action, 'keep');
    const plan = planRuns(root, { keep: 1, citations: '' });
    fs.writeFileSync(path.join(root, names[0], 'live.log'), 'active');
    fs.utimesSync(path.join(root, names[0]), old, old);
    assert.equal(planRuns(root, { keep: 1, citations: '' })[0].action, 'keep');
    assert.throws(() => applyPlan(root, plan), /changed/);
    assert.equal(fs.readdirSync(root).length, 3);
  } finally { fs.rmSync(root, { recursive: true }); }
});

test('archive files are never selected, even old, uncited and run-shaped', () => {
  // skill-creator's ack condition for #1098: m1-procedure-*.tar.zst archives must survive the prune.
  const root = scratch();
  const old = new Date(Date.now() - 4 * 3600000);
  const dirs = ['m1-procedure-aaaaaaa-20260101T000000', 'm1-procedure-bbbbbbb-20260102T000000'];
  const files = ['m1-procedure-ccccccc-20260103T000000.tar.zst', 'm1-procedure-ddddddd-20260104T000000'];
  try {
    for (const name of dirs) fs.mkdirSync(path.join(root, name));
    for (const name of files) fs.writeFileSync(path.join(root, name), 'archive');
    for (const name of [...dirs, ...files]) fs.utimesSync(path.join(root, name), old, old);
    const plan = planRuns(root, { keep: 1, citations: '' });
    assert.deepEqual(plan.filter(x => x.action === 'delete').map(x => x.name), [dirs[0]]);
    applyPlan(root, plan);
    assert.deepEqual(fs.readdirSync(root).sort(), [dirs[1], ...files].sort());
  } finally { fs.rmSync(root, { recursive: true }); }
});
