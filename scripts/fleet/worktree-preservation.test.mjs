import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { ageTree, mockGh, rawPR } from './worktree-fixtures.mjs';
const closeout = path.resolve('scripts/fleet/worktree-closeout.mjs');
const sweeper = path.resolve('scripts/fleet/worktree-sweeper.mjs');
const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
function fixture(t, prs = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preserve-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'repos', 'main'), wt = path.join(dir, 'worker'), bin = path.join(dir, 'bin');
  fs.mkdirSync(repo, { recursive: true }); fs.mkdirSync(bin);
  g(repo, 'init', '-b', 'main'); g(repo, 'config', 'user.name', 'Fixture'); g(repo, 'config', 'user.email', 'fixture');
  fs.writeFileSync(path.join(repo, '.gitignore'), 'docs.local/\nnode_modules/\n');
  fs.mkdirSync(path.join(repo, 'docs.local')); fs.writeFileSync(path.join(repo, 'docs.local', 'tracked'), 'tracked');
  g(repo, 'add', '.gitignore'); g(repo, 'add', '-f', 'docs.local/tracked'); g(repo, 'commit', '-m', 'base');
  g(repo, 'init', '--bare', path.join(dir, 'remote')); g(repo, 'remote', 'add', 'origin', path.join(dir, 'remote'));
  g(repo, 'push', '-u', 'origin', 'main'); g(repo, 'remote', 'set-head', 'origin', 'main');
  g(repo, 'worktree', 'add', '-b', 'worker', wt); g(wt, 'push', '-u', 'origin', 'worker');
  const headSha=g(wt,'rev-parse','HEAD');
  fs.writeFileSync(path.join(dir, 'prs.json'), JSON.stringify((prs ?? [{headSha}]).map(p => rawPR({...p,headSha:p.headSha??headSha}))));
  mockGh(bin,path.join(dir,'prs.json'));
  const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH };
  const run = mode => {ageTree(wt); return mode === 'closeout'
    ? spawnSync(process.execPath, [closeout, wt, '--json'], { env, encoding: 'utf8' })
    : spawnSync(process.execPath, ['--input-type=module', '-e', `import {sweep} from ${JSON.stringify('file://' + sweeper)}; sweep([process.argv[1]], {}, Date.now(), console.log);`, path.dirname(repo)], { env, encoding: 'utf8' });};
  const put = (name = 'keep.bin', data = Buffer.from([0, 1, 255, 10])) => fs.writeFileSync(path.join(wt, 'docs.local', name), data);
  return { dir, repo, wt, run, put, archive: path.join(repo, 'docs.local', 'worktree-archive', 'worker') };
}
for (const mode of ['closeout', 'sweeper']) {
  test(`${mode}: merged docs.local moves with verified receipt before removal`, t => {
    const f = fixture(t); f.put(); const r = f.run(mode); assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(f.archive, 'keep.bin')), r.stdout);
    assert.deepEqual(fs.readFileSync(path.join(f.archive, 'keep.bin')), Buffer.from([0, 1, 255, 10]));
    assert.ok(!fs.existsSync(f.wt)); assert.match(r.stdout, /moved 1 files \/ 4 bytes/);
    assert.match(r.stdout, /worktree removed.*proof/s);
    const receipt = JSON.parse(fs.readFileSync(f.archive + '.receipt.json'));
    assert.equal(receipt.pr, 1); assert.equal(receipt.branch, 'worker'); assert.equal(receipt.headSha, g(f.repo,'rev-parse','HEAD')); assert.ok('threadId' in receipt);
    assert.equal(receipt.files[0].sha256.length, 64); assert.equal(receipt.files[0].bytes, 4);
    assert.ok(!fs.existsSync(path.join(f.archive, 'tracked')));
  });
  test(`${mode}: no private files needs no archive`, t => {
    const f = fixture(t); const r = f.run(mode); assert.equal(r.status, 0, r.stderr);
    assert.ok(!fs.existsSync(f.wt)); assert.ok(!fs.existsSync(f.archive));
  });
  test(`${mode}: collision is suffixed without overwriting`, t => {
    const f = fixture(t); f.put(); fs.mkdirSync(f.archive, { recursive: true }); fs.writeFileSync(path.join(f.archive, 'keep.bin'), 'old');
    const r = f.run(mode); assert.equal(r.status, 0, r.stderr); assert.equal(fs.readFileSync(path.join(f.archive, 'keep.bin'), 'utf8'), 'old');
    assert.ok(fs.existsSync(path.join(f.archive + '-2', 'keep.bin'))); assert.match(r.stdout, /collision/);
  });
  for (const prs of [
    [{ number: 2, state: 'open', merged: false, head: 'child', base: 'worker' }],
    [{ number: 2, state: 'open', merged: false, head: 'worker', base: 'parent' }, { number: 1, state: 'open', merged: false, head: 'parent', base: 'main' }],
    [{ number: 1, state: 'closed', merged: true, head: 'worker', base: 'main' }, { number: 2, state: 'closed', merged: true, head: 'child', base: 'worker' }, { number: 3, state: 'open', merged: false, head: 'leaf', base: 'child' }],
    [{ number: 2, state: 'open', merged: false, head: 'child', base: 'worker' }, { number: 3, state: 'closed', merged: true, head: 'child', base: 'main' }]
  ]) test(`${mode}: open stack ${prs.at(-1).number} retains docs and output`, t => {
    const f = fixture(t, prs); f.put(); fs.mkdirSync(path.join(f.wt, 'node_modules'));
    const r = f.run(mode); assert.equal(r.status, 0, r.stderr); assert.ok(fs.existsSync(f.wt)); assert.equal(fs.existsSync(path.join(f.wt, 'node_modules')),mode==='closeout');
    assert.ok(!fs.existsSync(f.archive)); assert.match(r.stdout, /kept: stack .* open/);
  });
  test(`${mode}: dirty state is untouched`, t => {
    const f = fixture(t); f.put(); fs.writeFileSync(path.join(f.wt, 'dirty'), 'local'); f.run(mode);
    assert.ok(fs.existsSync(path.join(f.wt, 'docs.local', 'keep.bin'))); assert.ok(!fs.existsSync(f.archive));
  });
  test(`${mode}: fully merged stack closes`, t => {
    const f = fixture(t, [{ number: 1, state: 'closed', merged: true, head: 'worker', base: 'main' }, { number: 2, state: 'closed', merged: true, head: 'child', base: 'worker' }]);
    f.put(); const r = f.run(mode); assert.equal(r.status, 0, r.stderr); assert.ok(!fs.existsSync(f.wt)); assert.ok(fs.existsSync(f.archive));
  });
}
for (const mode of ['closeout', 'sweeper']) {
  for (const hazard of ['unpushed', 'unknown PR state', 'source symlink', 'archive symlink']) test(`${mode}: ${hazard} preserves originals`, t => {
    const f = fixture(t); f.put();
    if (hazard === 'unpushed') g(f.wt, 'commit', '--allow-empty', '-m', 'local');
    if (hazard === 'unknown PR state') fs.writeFileSync(path.join(f.dir, 'prs.json'), '{}');
    if (hazard === 'source symlink') fs.symlinkSync(path.join(f.repo, '.gitignore'), path.join(f.wt, 'docs.local', 'link'));
    if (hazard === 'archive symlink') fs.symlinkSync(f.wt, path.join(f.repo, 'docs.local', 'worktree-archive'));
    f.run(mode); assert.ok(fs.existsSync(path.join(f.wt, 'docs.local', 'keep.bin'))); assert.ok(fs.existsSync(f.wt));
  });
}
test('copy corruption retains every original before unlink', async t => {
  const f = fixture(t); f.put('first', 'first'); f.put('last', 'last');
  const { preserveDocs } = await import('./worktree-preservation.mjs');
  const copy = fs.copyFileSync;
  fs.copyFileSync = (...args) => { copy(...args); fs.writeFileSync(args[1], 'corrupt'); };
  try { assert.throws(() => preserveDocs(f.wt, f.repo, 'worker', g(f.wt, 'rev-parse', 'HEAD')), /hash verification/); }
  finally { fs.copyFileSync = copy; }
  assert.equal(fs.readFileSync(path.join(f.wt, 'docs.local', 'first'), 'utf8'), 'first');
  assert.equal(fs.readFileSync(path.join(f.wt, 'docs.local', 'last'), 'utf8'), 'last');
});
