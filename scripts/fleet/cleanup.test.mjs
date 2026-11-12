import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, utimesSync, lstatSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sweep } from './worktree-sweeper.mjs';
import { planDisk } from './disk-guard.mjs';
import { execute, run } from './fleet-runtime.mjs';
import { mockGh, rawPR } from './worktree-fixtures.mjs';
const scratch = resolve('docs.local/fleet-tests');
mkdirSync(scratch, { recursive: true });
test('real git fixtures preserve root, dirty, unpushed and recent output', () => {
  const dir = mkdtempSync(join(scratch, 'run-'));
  const oldPath = process.env.PATH, bin = join(dir, 'bin'); mkdirSync(bin);
  const data=join(dir,'prs.json');mockGh(bin,data); process.env.PATH = bin + ':' + oldPath;
  const g = (p, ...args) => run('git', ['-C', p, ...args]);
  try {
    const remote = join(dir, 'remote.git'); run('git', ['init', '--bare', remote]);
    const repo = join(dir, 'repos/main'); mkdirSync(repo, { recursive: true });
    g(repo, 'init', '-b', 'master'); g(repo, 'config', 'user.name', 'Fixture'); g(repo, 'config', 'user.email', 'fixture.invalid');
    writeFileSync(join(repo, '.gitignore'), 'node_modules/\n');
    g(repo, 'add', '.'); g(repo, 'commit', '-m', 'base'); g(repo, 'remote', 'add', 'origin', remote); g(repo, 'push', '-u', 'origin', 'master'); g(repo, 'remote', 'set-head', 'origin', 'master');
    writeFileSync(data,JSON.stringify([rawPR({head:'merged',base:'master',headSha:g(repo,'rev-parse','HEAD')})]));
    const trees = {};
    for (const name of ['idle', 'merged', 'dirty', 'unpushed', 'recent']) {
      const p = join(dir, name); trees[name] = p; g(repo, 'worktree', 'add', '-b', name, p);
      if (name !== 'merged') { writeFileSync(join(p, 'file'), name); g(p, 'add', '.'); g(p, 'commit', '-m', name); }
      if (name !== 'unpushed') g(p, 'push', '-u', 'origin', name);
      mkdirSync(join(p, 'node_modules')); writeFileSync(join(p, 'node_modules/cache'), 'cache');
      if (name === 'dirty') writeFileSync(join(p, 'file'), 'modified dirty content');
    }
    mkdirSync(join(repo, 'node_modules'));
    const now = Date.now(); const old = new Date(now - 72 * 3600000);
    function age(p) { if (lstatSync(p).isDirectory()) for (const n of readdirSync(p)) age(join(p, n)); utimesSync(p, old, old); }
    for (const [name, p] of Object.entries(trees)) if (name !== 'recent') age(p);
    const result = sweep([join(dir, 'repos')], {}, now);
    assert.equal(existsSync(join(trees.idle, 'node_modules')), false);
    assert.equal(existsSync(trees.merged), false);
    for (const name of ['dirty', 'unpushed', 'recent']) assert.ok(existsSync(join(trees[name], 'node_modules')), name);
    assert.ok(existsSync(join(repo, 'node_modules')));
    assert.equal(result.posts.length, 2);
    assert.equal(sweep([join(dir, 'repos')], result.state, now + 1000).posts.length, 0);
  } finally { process.env.PATH = oldPath; rmSync(dir, { recursive: true }); }
});
test('disk crossing, daily repeat, recovery and recrossing', () => {
  const input = { free: 20, threshold: 40, sizes: { a: 5 }, host: 'fixture', now: 100000000 };
  const a = planDisk(input); assert.equal(a.posts.length, 1);
  const b = planDisk({ ...input, now: input.now + 3600000 }, a.state); assert.equal(b.posts.length, 0);
  const c = planDisk({ ...input, now: input.now + 25 * 3600000 }, b.state); assert.equal(c.posts.length, 1);
  const d = planDisk({ ...input, free: 80 }, c.state); assert.equal(d.posts.length, 0);
  assert.equal(planDisk(input, d.state).posts.length, 1);
});
test('missing config and failed SSH persist pending and OUTBOX with unhealthy exit', () => {
  const dir = mkdtempSync(join(scratch, 'delivery-'));
  try {
    const collect = s => ({ state: s, posts: ['alert\n'] });
    assert.equal(execute('fixture', collect, { dir, config() { throw Error('missing'); } }), 1);
    assert.match(readFileSync(join(dir, 'OUTBOX.md'), 'utf8'), /alert/);
    const config = () => ({ localOutbox: join(dir, 'outbox'), sshHost: 'fixture', remoteInbox: '/inbox' });
    assert.equal(execute('fixture', collect, { dir, config, ssh() { throw Error('offline'); } }), 1);
    assert.match(readFileSync(join(dir, 'outbox'), 'utf8'), /alert/);
    assert.equal(execute('fixture', () => ({ state: {}, posts: [] }), { dir, config, ssh() {} }), 0);
  } finally { rmSync(dir, { recursive: true }); }
});
test('stale lock recovery and consecutive failures are reported once on recovery', () => {
  const dir = mkdtempSync(join(scratch, 'health-'));
  const now = Date.now(); const path = join(dir, 'sweeper.json');
  const config = () => ({ localOutbox: join(dir, 'outbox') });
  const collect = s => ({ state: s, posts: [] }); const delivered = [];
  try {
    writeFileSync(path + '.lock', '');
    assert.equal(execute('sweeper', collect, { dir, config, now, ssh: t => delivered.push(t) }), 0);
    assert.equal(delivered.length, 0);
    const old = new Date(now - 91 * 60000); utimesSync(path + '.lock', old, old);
    assert.equal(execute('sweeper', collect, { dir, config, now, ssh: t => delivered.push(t) }), 0);
    assert.match(delivered[0], /stale lock recovered/);
    for (let i = 0; i < 3; i++) assert.equal(execute('sweeper', collect, { dir, now, config() { throw Error('missing'); } }), 1);
    assert.equal(execute('sweeper', collect, { dir, config, now, ssh: t => delivered.push(t) }), 0);
    assert.match(delivered[1], /SWEEPER was failing for 3 runs/);
    assert.equal(execute('sweeper', collect, { dir, config, now, ssh: t => delivered.push(t) }), 0);
    assert.equal(delivered.length, 2);
  } finally { rmSync(dir, { recursive: true }); }
});
