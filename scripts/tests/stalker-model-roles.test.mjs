import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
const root = new URL('../../', import.meta.url).pathname;
const config = JSON.parse(await readFile(join(root, 'standards/model-roles.json'), 'utf8'));

test('Stalker and stream helpers contain no model pins outside the resolver', async () => {
  async function scan(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await scan(path);
      else if (entry.name !== 'stalker-model.mjs') assert.doesNotMatch(await readFile(path, 'utf8'), /gpt-\d[\w.-]*|Gemini \d[^"'\n]*/i, path);
    }
  }
  await scan(join(root, 'scripts/stalker')); await scan(join(root, 'scripts/lib/stream'));
});

test('scoring resolves roles, preserves overrides, and stops before model calls on invalid routing', async t => {
  const dir = await mkdtemp(join(import.meta.dirname, '.stalker-model-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const scripts = join(dir, 'scripts'), stalker = join(scripts, 'stalker');
  await mkdir(join(stalker, 'process'), { recursive: true });
  await mkdir(join(scripts, 'lib')); await mkdir(join(scripts, 'ci'));
  for (const file of ['process-stream.sh', 'stalker-model.mjs']) {
    await cp(join(root, 'scripts/stalker', file), join(stalker, file));
  }
  await cp(join(root, 'scripts/model-roles.mjs'), join(scripts, 'model-roles.mjs'));
  await cp(join(root, 'scripts/ci/check-model-role-drift.mjs'), join(scripts, 'ci/check-model-role-drift.mjs'));
  await cp(join(root, 'standards'), join(dir, 'standards'), { recursive: true });
  for (const name of ['inputs', 'audio', 'signals', 'score-providers', 'score-workers', 'scoring', 'outputs']) await writeFile(join(stalker, 'process', `${name}.sh`), '');
  await writeFile(join(stalker, 'process/inputs.sh'), 'derive_stream_labels() { :; }; preflight_stream() { :; }; prepare_stream_inputs() { AGY_BIN=stub; CODEX_BIN=stub; }; run_audio_stages() { :; }; run_signal_stage() { :; }\n');
  await writeFile(join(scripts, 'lib/stream-helpers.sh'), 'stalker_mark_scoring_started() { :; }; stalker_score_parallel_limit() { echo 1; }; prepare_scoring_stage() { echo "MODEL_CALL:$STALKER_CODEX_MODEL:$STALKER_AGY_MODEL"; exit 0; }\n');
  const env = { ...process.env, STALKER_CODEX_MODEL: '', STALKER_AGY_MODEL: '', GOLEMS_MODEL_ROLES_ROOT: dir };
  const run = extra => spawnSync('bash', [join(stalker, 'process-stream.sh'), join(dir, 'video.mp4')], { encoding: 'utf8', env: { ...env, ...extra } });
  const defaults = run();
  assert.equal(defaults.status, 0, defaults.stderr);
  assert.ok(defaults.stdout.includes(`MODEL_CALL:${config.roles['codex.implement'].model}:${config.roles['gemini.gather.text'].launcher_tier}`));
  assert.match(run({ STALKER_CODEX_MODEL: 'custom-codex', STALKER_AGY_MODEL: 'custom-agy' }).stdout, /MODEL_CALL:custom-codex:custom-agy/);
  for (const extra of [{ STALKER_CODEX_MODEL: 'gpt-5.6-sol' }, { STALKER_AGY_MODEL: 'gpt-5.6-luna' }]) {
    const result = run(extra); assert.notEqual(result.status, 0); assert.match(result.stderr, /Stalker.*forbidden/i); assert.doesNotMatch(result.stdout, /MODEL_CALL/);
  }
  for (const role of ['codex.implement', 'gemini.gather.text']) {
    const missing = structuredClone(config); delete missing.roles[role];
    await writeFile(join(dir, 'standards/model-roles.json'), JSON.stringify(missing));
    const result = run(); assert.notEqual(result.status, 0); assert.ok(result.stderr.includes(role), result.stderr); assert.doesNotMatch(result.stdout, /MODEL_CALL/);
  }
});

test('both digest stages reject missing roles and forbidden overrides before generation', () => {
  const code = `import assert from 'node:assert/strict';
    import {generateHumanDigest} from './scripts/stalker/stalker-human-digest.mjs';
    import {curateDigest} from './scripts/stalker/stalker-digest-curation.mjs';
    const generateImpl = async () => assert.fail('model must not run');
    await assert.rejects(generateHumanDigest({generateImpl}), /Stalker:/);
    await assert.rejects(curateDigest({candidates:{topics:[],highlights:[],claims:[]},workDir:'.',generateImpl}), /Stalker:/);`;
  for (const extra of [{ GOLEMS_MODEL_ROLES_ROOT: '/nonexistent-stalker-roles' }, { STALKER_CODEX_MODEL: 'gpt-5.6-sol' }]) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: root, encoding: 'utf8', env: { ...process.env, STALKER_CODEX_MODEL: '', ...extra } });
    assert.equal(result.status, 0, result.stderr);
  }
});
