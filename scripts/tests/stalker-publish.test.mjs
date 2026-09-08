import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { publishRunDashboard } from '../stalker-publish.mjs';

test('publication writes an admitted source before sync and only explicitly selected media', async t => {
  const root = await mkdtemp(join(import.meta.dirname, '.stalker-publish-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repoRoot = join(root, 'golems');
  const runDir = join(repoRoot, 'docs.local/stalker-golem/theo-2026-09-08-030512');
  await mkdir(join(runDir, 'clips'), { recursive: true });
  await writeFile(join(runDir, 'clips/clip-10m47s.mp4'), 'media');
  await writeFile(join(runDir, 'clips/clip-20m00s.mp4'), 'old selection');
  await writeFile(join(runDir, 'private-log.txt'), 'must not be published');
  const source = join(repoRoot, 'docs.local/dashboards/stalker/theo-2026-09-08-030512.html');
  const evidenceRoot = join(repoRoot, 'docs.local/dashboards/stalker/evidence/theo-2026-09-08-030512');
  const assetPath = async asset => join(evidenceRoot, (await readdir(evidenceRoot))[0], asset);
  let syncCalls = 0;
  const result = await publishRunDashboard({
    runDir, repoRoot, orchestratorRoot: join(root, 'orchestrator'), hubOrigin: 'https://hub.example',
    html: '<!doctype html><title>Theo</title>', assets: ['clips/clip-10m47s.mp4'],
    syncImpl: async () => {
      syncCalls++;
      assert.match(await readFile(source, 'utf8'), /Theo/);
      assert.equal(await readFile(await assetPath('clips/clip-10m47s.mp4'), 'utf8'), 'media');
      await assert.rejects(readFile(await assetPath('private-log.txt')));
    },
  });
  assert.equal(syncCalls, 1);
  assert.equal(result.url, 'https://hub.example/dashboards/golems/stalker/theo-2026-09-08-030512.html');
  assert.equal(result.sourceRelative, 'golems/docs.local/dashboards/stalker/theo-2026-09-08-030512.html');
  assert.equal(await readFile(join(runDir, 'dashboard.html'), 'utf8'), await readFile(source, 'utf8'));
  const republish = assets => publishRunDashboard({ runDir, repoRoot, orchestratorRoot: join(root, 'orchestrator'),
    hubOrigin: 'https://hub.example', html: '<!doctype html><title>Theo</title>', assets, syncImpl: async () => {} });
  await republish(['clips/clip-10m47s.mp4', 'clips/clip-20m00s.mp4']);
  await assert.rejects(republish(['clips/clip-10m47s.mp4', 'clips/clip-99m00s.mp4']));
  assert.equal(await readFile(await assetPath('clips/clip-20m00s.mp4'), 'utf8'), 'old selection');
  const oldSource = await readFile(source, 'utf8');
  const oldVersions = await readdir(evidenceRoot);
  const localDashboard = join(runDir, 'dashboard.html');
  await rm(localDashboard);
  await mkdir(localDashboard);
  await assert.rejects(republish(['clips/clip-10m47s.mp4']));
  assert.equal(await readFile(source, 'utf8'), oldSource);
  assert.deepEqual(await readdir(evidenceRoot), oldVersions);
  assert.equal(await readFile(await assetPath('clips/clip-20m00s.mp4'), 'utf8'), 'old selection');
  await rm(localDashboard, { recursive: true });
  await republish(['clips/clip-10m47s.mp4']);
  await assert.rejects(readFile(await assetPath('clips/clip-20m00s.mp4')));
  assert.equal(await readFile(source, 'utf8'), '<!doctype html><title>Theo</title>');
});

test('unsafe assets, absent selected media and sync failures never report publication', async t => {
  const root = await mkdtemp(join(import.meta.dirname, '.stalker-publish-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repoRoot = join(root, 'golems');
  const runDir = join(repoRoot, 'docs.local/stalker-golem/theo-run');
  await mkdir(runDir, { recursive: true });
  const options = { runDir, repoRoot, orchestratorRoot: join(root, 'orc'), hubOrigin: 'https://hub.example', html: '<!doctype html>', syncImpl: async () => {} };
  await assert.rejects(publishRunDashboard({ ...options, assets: ['../private.txt'] }), /stage 7.*asset/);
  await assert.rejects(publishRunDashboard({ ...options, assets: ['clips/clip-1m00s.mp4'] }), /stage 7/);
  await assert.rejects(publishRunDashboard({ ...options, syncImpl: async () => { throw new Error('sync failed'); } }), /stage 7.*sync failed/);
  await assert.rejects(publishRunDashboard({ ...options, hubOrigin: 'https://dashboards.example.invalid' }), /stage 7/);
});

test('failed media admission preserves the prior served HTML symlink and media', async t => {
  const root = await mkdtemp(join(import.meta.dirname, '.stalker-publish-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repoRoot = join(root, 'golems'), runDir = join(repoRoot, 'docs.local/stalker-golem/theo-run');
  await mkdir(join(runDir, 'clips'), { recursive: true });
  await writeFile(join(runDir, 'clips/clip-1m00s.mp4'), 'old media');
  const sourceRoot = join(repoRoot, 'docs.local/dashboards/stalker'), served = join(root, 'served');
  await mkdir(served);
  let fail = false, first = true;
  const syncImpl = async () => {
    if (fail) throw new Error('hub unavailable');
    if (first) {
      first = false;
      await symlink(join(sourceRoot, 'theo-run.html'), join(served, 'page.html'));
    }
    const revisions = await readdir(join(sourceRoot, 'evidence/theo-run'));
    for (const revision of revisions) {
      const directory = join(served, 'evidence/theo-run', revision, 'clips');
      await mkdir(directory, { recursive: true });
      await symlink(join(sourceRoot, 'evidence/theo-run', revision, 'clips/clip-1m00s.mp4'), join(directory, 'clip-1m00s.mp4')).catch(error => { if (error.code !== 'EEXIST') throw error; });
    }
  };
  const options = { runDir, repoRoot, hubOrigin: 'https://hub.example', assets: ['clips/clip-1m00s.mp4'], syncImpl };
  await publishRunDashboard({ ...options, html: '<html>old<video src="evidence/theo-run/clips/clip-1m00s.mp4"></video></html>' });
  const old = await readFile(join(served, 'page.html'), 'utf8'), media = old.match(/src="([^"]+)"/)[1];
  fail = true;
  await assert.rejects(publishRunDashboard({ ...options, html: '<html>new<video src="evidence/theo-run/clips/clip-1m00s.mp4"></video></html>' }));
  assert.equal(await readFile(join(served, 'page.html'), 'utf8'), old);
  assert.equal(await readFile(join(runDir, 'dashboard.html'), 'utf8'), old);
  assert.equal(await readFile(join(served, media), 'utf8'), 'old media');
});
