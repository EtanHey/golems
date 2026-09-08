import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

async function fixture(t) {
  const root = await mkdtemp(join(import.meta.dirname, '.stalker-wiring-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const scripts = join(root, 'scripts'), runDir = join(root, 'theo-2026-09-08-030512'), bin = join(root, 'bin');
  await Promise.all([mkdir(scripts), mkdir(runDir), mkdir(bin)]);
  await cp(join(import.meta.dirname, '../lib'), join(scripts, 'lib'), { recursive: true });
  await cp(join(import.meta.dirname, '../post-stream.sh'), join(scripts, 'post-stream.sh'));
  await writeFile(join(runDir, 'video.mp4'), 'fixture video');
  await writeFile(join(runDir, 'chat.log'), '[00:00:01] viewer: fixture chat\n');
  await writeFile(join(runDir, 'gems.md'), '# Gems\n### [00:01] Fixture gem\n');
  await writeFile(join(runDir, '.stage-brainlayer.done'), 'done');
  await writeFile(join(runDir, '.stage-complete-notify.done'), 'legacy false completion');
  await writeFile(join(runDir, '.stage-notified.done'), 'legacy digest');
  for (const name of ['process-stream', 'archive-stream']) await writeFile(join(scripts, `${name}.sh`), `#!/bin/bash\nprintf '${name}\\n' >> "$CALLS"\n`, { mode: 0o755 });
  await writeFile(join(scripts, 'stalker-complete-run.mjs'), `import {appendFileSync} from 'node:fs'; appendFileSync(process.env.CALLS,'delivery\\n'); process.exit(Number(process.env.DELIVERY_EXIT ?? 0));`);
  await writeFile(join(bin, 'ffprobe'), '#!/bin/bash\necho 24000\n', { mode: 0o755 });
  await writeFile(join(bin, 'notify'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  const calls = join(root, 'calls');
  const run = extra => spawnSync('bash', [join(scripts, 'post-stream.sh'), runDir, join(runDir, 'video.mp4'), join(runDir, 'chat.log'), 'theo'], {
    encoding: 'utf8', timeout: 10000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CALLS: calls, ...extra },
  });
  return { runDir, calls, run };
}

test('post-stream delivers before archive even with legacy success markers', async t => {
  const { run, calls } = await fixture(t);
  const result = run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(await readFile(calls, 'utf8'), 'process-stream\ndelivery\narchive-stream\n');
});

test('a resumed process stage still validates delivery and fails before archive', async t => {
  const { run, runDir, calls } = await fixture(t);
  await writeFile(join(runDir, '.stage-process.done'), 'done');
  const result = run({ DELIVERY_EXIT: '75' });
  assert.equal(result.status, 75, result.stdout + result.stderr);
  assert.equal(await readFile(calls, 'utf8'), 'delivery\n');
});

test('overnight monitor rejects the incident shape instead of announcing gems as complete', async t => {
  const { runDir } = await fixture(t);
  const result = spawnSync('bash', [join(import.meta.dirname, '../stream-overnight-monitor.sh')], {
    encoding: 'utf8', timeout: 5000, env: { ...process.env, STALKER_MONITOR_ONCE: '1', STALKER_RUN_DIR: runDir },
  });
  assert.equal(result.status, 75, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /PIPELINE COMPLETE/);
  await assert.rejects(readFile(join(runDir, 'morning-summary.md')));
});
