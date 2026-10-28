import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, renameSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const helper = new URL('./launch-guard.mjs', import.meta.url);
const load = () => import(helper.href);
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } }).trim();
function fixture(t, branch = 'trunk') {
  const root = realpathSync(mkdtempSync(join(process.env.LAUNCH_GUARD_TEST_TMP ?? tmpdir(), 'launch-guard-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q', '-b', branch);
  git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-qm', 'fixture', '--allow-empty');
  const oid = git(root, 'rev-parse', 'HEAD');
  git(root, 'update-ref', `refs/remotes/origin/${branch}`, oid);
  git(root, 'symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${branch}`);
  return { root, oid };
}
const context = { threadId: 'thread-fixture', runId: 'run-fixture', baseRef: 'refs/heads/trunk', root: '/fixture/repo' };
const read = (status = 'running', items = []) => ({ thread: { threadId: context.threadId, status, latestRunId: context.runId }, recentRuns: [{ runId: context.runId, status }], items });
const prep = (status, text) => ({ itemId: 'turn-item:provider:codex:native-item:workspace-preparation%3Arun-fixture', sourceThreadId: context.threadId, runId: context.runId, type: 'command_execution', status, text, title: 'Workspace preparation failed' });
for (const branch of ['master', 'release-line']) test(`actual origin/HEAD default: ${branch}`, async t => {
  const f = fixture(t, branch), { preflight } = await load();
  const before = git(f.root, 'status', '--porcelain=v1');
  const r = preflight({ root: f.root });
  assert.equal(r.ok, true); assert.equal(r.commit, f.oid); assert.equal(r.resolvedRef, `refs/remotes/origin/${branch}`);
  assert.equal(r.remoteFreshness, 'NOT_CHECKED'); assert.equal(r.root, f.root); assert.equal(r.originalRoot, f.root);
  assert.equal(git(f.root, 'status', '--porcelain=v1'), before);
});
test('explicit missing main fails before launch, never substituted', async t => {
  const f = fixture(t, 'master'), { preflight } = await load(); let launches = 0;
  const r = preflight({ root: f.root, baseRef: 'main' }); if (r.ok) launches++;
  assert.equal(r.ok, false); assert.equal(r.reason, 'REF_NOT_FOUND_OR_AMBIGUOUS'); assert.equal(r.baseRef, 'main'); assert.equal(launches, 0);
});
test('explicit commit and ref resolve exactly; ambiguity fails', async t => {
  const f = fixture(t), { preflight } = await load();
  for (const baseRef of [f.oid, 'refs/heads/trunk']) assert.equal(preflight({ root: f.root, baseRef }).commit, f.oid);
  git(f.root, 'tag', 'trunk'); assert.equal(preflight({ root: f.root, baseRef: 'trunk' }).ok, false);
});
for (const mode of ['missing-default', 'dangling-default', 'detached', 'non-git', 'subdirectory']) test(`reject ${mode}`, async t => {
  const f = fixture(t), { preflight } = await load(); let root = f.root;
  if (mode === 'missing-default') git(root, 'symbolic-ref', '--delete', 'refs/remotes/origin/HEAD');
  if (mode === 'dangling-default') git(root, 'update-ref', '-d', 'refs/remotes/origin/trunk');
  if (mode === 'detached') git(root, 'checkout', '-q', '--detach');
  if (mode === 'non-git') rmSync(join(root, '.git'), { recursive: true });
  if (mode === 'subdirectory') { root = join(root, 'nested'); mkdirSync(root); }
  assert.equal(preflight({ root }).ok, false);
});
test('options, spaces and shell metacharacters remain literal and do not execute helpers', async t => {
  const f = fixture(t), { preflight } = await load(); const marker = join(f.root, 'executed');
  const evil = join(f.root, 'fsmonitor'); writeFileSync(evil, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
  git(f.root, 'config', 'core.fsmonitor', evil);
  const odd = join(f.root, '-path $(touch executed) with spaces'); mkdirSync(odd);
  const nested = fixture(t), literalRoot = join(nested.root, '-repo $(touch executed) with spaces');
  mkdirSync(literalRoot); renameSync(join(nested.root, '.git'), join(literalRoot, '.git'));
  const literal = preflight({ root: literalRoot, cwd: odd });
  assert.equal(literal.ok, true); assert.equal(literal.root, literalRoot); assert.equal(literal.cwd, odd);
  for (const baseRef of ['--help', '-c core.sshCommand=touch', '$(touch executed)', '', 42]) assert.equal(preflight({ root: f.root, baseRef }).ok, false);
  assert.equal(preflight({ root: f.root }).ok, true); assert.equal(existsSync(marker), false);
});
test('startFromOrigin is never certified as fresh by local resolution', async t => {
  const f = fixture(t), { preflight } = await load();
  const r = preflight({ root: f.root, startFromOrigin: true }); assert.equal(r.ok, false); assert.equal(r.reason, 'REMOTE_FRESHNESS_UNVERIFIED');
});
for (const status of ['failed', 'cancelled', 'interrupted', 'rolled_back']) test(`terminal run ${status} is loud and secret-free`, async () => {
  const { preparation } = await load(); const data = read(status); data.recentRuns[0].error = 'token=super-secret';
  const r = preparation(data, context); assert.equal(r.ok, false); assert.equal(r.status, 'ERROR');
  for (const [key, value] of Object.entries(context)) assert.equal(r[key], value);
  assert.equal(JSON.stringify(r).includes('super-secret'), false);
});
test('actual workspace preparation failure is detected despite accepted/running thread', async () => {
  const { preparation } = await load();
  const r = preparation(read('running', [prep('failed', 'Workspace preparation failed: ref_not_found token=secret')]), context);
  assert.equal(r.status, 'ERROR'); assert.equal(r.reason, 'REF_NOT_FOUND'); assert.equal(JSON.stringify(r).includes('token='), false);
});
test('quoted prompt/assistant/shell failure text is not a workspace failure', async () => {
  const { preparation } = await load();
  for (const type of ['user_message', 'assistant_message', 'command_execution']) {
    const data = read('running', [{ ...prep('completed', 'Workspace preparation failed: ref_not_found'), itemId: 'ordinary-message-or-command', type, createdBy: 'agent' }]);
    assert.equal(preparation(data, context).status, 'READY');
  }
});
for (const status of ['preparing', 'queued', 'starting', 'idle']) test(`${status} returns PENDING, never success`, async () => {
  const { preparation } = await load(); const r = preparation(read(status), context); assert.equal(r.status, 'PENDING'); assert.equal(r.ok, false);
});
test('running/completed, MCP envelopes, wrong identities and missing/unknown schema', async () => {
  const { preparation } = await load();
  for (const status of ['running', 'completed']) {
    for (const data of [read(status), { structuredContent: read(status) }, { content: [{ type: 'text', text: JSON.stringify(read(status)) }] }]) assert.equal(preparation(data, context).status, 'READY');
  }
  for (const data of [{}, read('alien'), { ...read(), thread: { threadId: 'wrong' } }, { ...read(), recentRuns: [] }]) assert.notEqual(preparation(data, context).ok, true);
  const stale = prep('failed', 'ref_not_found'); stale.runId = 'other-run'; assert.equal(preparation(read('running', [stale]), context).ok, true);
});
test('observer calls exactly one thread read; failure propagates without retry', async () => {
  const { checkPreparationOnce } = await load(); const calls = [];
  const r = await checkPreparationOnce(async args => { calls.push(args); return read('failed'); }, context);
  assert.equal(r.status, 'ERROR'); assert.equal(calls.length, 1); assert.equal(calls[0].threadId, context.threadId); assert.equal(calls[0].view, 'activity');
  let attempts = 0; const pending = await checkPreparationOnce(async () => { attempts++; return read('preparing'); }, context);
  assert.equal(pending.status, 'PENDING'); assert.equal(attempts, 1);
  const broken = await checkPreparationOnce(async () => { attempts++; throw Error('token=secret'); }, context);
  assert.equal(broken.status, 'ERROR'); assert.equal(attempts, 2); assert.equal(JSON.stringify(broken).includes('secret'), false);
});
test('CLI structured failure is nonzero and never leaks raw stderr', () => {
  const r = spawnSync(process.execPath, [helper.pathname, 'preflight'], { input: JSON.stringify({ root: '/definitely-missing-fixture' }), encoding: 'utf8' });
  assert.equal(r.status, 1); assert.equal(JSON.parse(r.stdout).ok, false);
});
test('canonical recipe static behavior and active examples use the guard', () => {
  const recipe = readFileSync(new URL('../references/worktree-launch.md', import.meta.url), 'utf8');
  assert.equal((recipe.match(/await tools\.mcp__t3_code__t3_thread_read\(/g) ?? []).length, 1);
  const triggers = JSON.parse(readFileSync(new URL('../evals/trigger-evals.json', import.meta.url), 'utf8'));
  assert.equal(triggers.find(c => c.query.includes('baseRef main')).should_trigger, true);
  assert.equal(triggers.find(c => c.query.includes('root thread')).should_trigger, false);
  const behavior = JSON.parse(readFileSync(new URL('../evals/evals.json', import.meta.url), 'utf8')).evals.find(c => c.id === 105);
  assert.ok(behavior.assertions.length && behavior.expected_output.includes('PENDING'));
  for (const term of ['PENDING', 'startFromOrigin', 'delegate_task', 't3-mixed-harness', 'remote', 'preflight']) assert.ok(recipe.includes(term), term);
  for (const path of ['../SKILL.md', '../references/t3-native.md', '../../large-plan/SKILL.md', '../../large-plan/adapters/codex.md', '../../large-plan/adapters/cursor.md', '../../large-plan/adapters/capabilities.yaml', '../../repogolem/SKILL.md', '../../cmux-agents/adapters/codex.md']) {
    const text = readFileSync(new URL(path, import.meta.url), 'utf8'); assert.ok(text.includes('worktree-launch.md'), path);
    assert.doesNotMatch(text, /git worktree add[^\n]*\b(?:main|master)\b/);
  }
});

for (const bad of [null, 42, { ...read(), recentRuns: [null] }, { ...read(), items: [null] }]) test('malformed schema fails structurally', async () => {
  const { preparation } = await load(); assert.equal(preparation(bad, context).status, 'ERROR');
});

test('execute the canonical model recipe: missing ref never launches; one read propagates error', async t => {
  const { preflight, unwrap, checkPreparationOnce } = await load(), f = fixture(t);
  const recipe = readFileSync(new URL('../references/worktree-launch.md', import.meta.url), 'utf8').match(/```js\n([\s\S]*?)```/)[1];
  const run = new (Object.getPrototypeOf(async function(){}).constructor)('tools', 'receipt', 'launchArgs', 'unwrap', 'checkPreparationOnce', recipe);
  const calls = [], tools = {
    mcp__t3_code__t3_thread_launch: async args => { calls.push(['launch', args]); return { threadId: context.threadId, runId: context.runId }; },
    mcp__t3_code__t3_thread_read: async args => { calls.push(['read', args]); return read('failed'); },
  };
  await assert.rejects(run(tools, preflight({ root: f.root, baseRef: 'main' }), {}, unwrap, checkPreparationOnce), /REF_NOT_FOUND/);
  assert.equal(calls.length, 0);
  await assert.rejects(run(tools, preflight({ root: f.root }), { environmentId: 'remote-fixture' }, unwrap, checkPreparationOnce), /RUN_OR_WORKSPACE_FAILED/);
  assert.deepEqual(calls.map(c => c[0]), ['launch', 'read']); assert.equal(calls[0][1].workspaceStrategy.baseRef, f.oid);
  assert.equal(calls[1][1].environmentId, 'remote-fixture');
});
