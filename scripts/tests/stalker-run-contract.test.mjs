import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { artifactHashes, verifyRunDelivery } from '../stalker-run-contract.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/stalker-2026-09-08.json', import.meta.url)));
async function setup(t, delivered = true) {
  const root = await mkdtemp(join(import.meta.dirname, '.stalker-contract-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runDir = join(root, fixture.runName);
  await mkdir(runDir);
  for (const [name, body] of Object.entries(fixture.files)) await writeFile(join(runDir, name), body);
  if (!delivered) return { runDir };
  const html = '<!doctype html><title>Theo digest</title><p>What was discussed</p>';
  const highlights = Array.from({ length: 5 }, (_, i) => `- [10:${40 + i}] Highlight ${i}`).join('\n');
  await writeFile(join(runDir, 'digest.md'), `# Theo\n## What was discussed\n[10:47] A topic\n## Top highlights\n${highlights}\n## Claims worth checking\n[10:47] A claim\n`);
  await writeFile(join(runDir, 'dashboard.html'), html);
  const manifest = { included: [{ linkPath: 'dashboards/golems/stalker/run.html', sourceRelative: 'golems/docs.local/dashboards/stalker/run.html' }] };
  const responses = { dashboardStatus: 200, html, manifest };
  const server = createServer((req, res) => {
    res.statusCode = req.url === '/manifest.json' ? 200 : responses.dashboardStatus;
    res.end(req.url === '/manifest.json' ? JSON.stringify(responses.manifest) : responses.html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const url = `${origin}/${manifest.included[0].linkPath}`;
  const receipt = {
    version: 1, runName: fixture.runName, status: 'complete',
    artifacts: await artifactHashes(runDir),
    publication: { url, manifestUrl: `${origin}/manifest.json`, ...manifest.included[0] },
    notification: { accepted: true, messageId: 123, url, body: `Stalker complete. Dashboard: ${url}` },
  };
  const save = () => writeFile(join(runDir, '.stalker-completion.json'), JSON.stringify(receipt));
  await save();
  return { runDir, receipt, save, responses };
}

test('September 8 ratchet: processing markers and gems cannot make a run COMPLETE', async t => {
  const { runDir } = await setup(t, false);
  await assert.rejects(verifyRunDelivery(runDir), /FAILED at stage 6.*digest\.md/);
});

test('COMPLETE requires matching live HTML, hub manifest, artifacts and notified URL', async t => {
  const { runDir } = await setup(t);
  assert.equal((await verifyRunDelivery(runDir)).status, 'complete');
});

test('replaced gems invalidate a previously delivered run', async t => {
  const { runDir } = await setup(t);
  await writeFile(join(runDir, 'gems.md'), 'rescored');
  await assert.rejects(verifyRunDelivery(runDir), /artifact hash mismatch/);
});

test('empty digest and decorative headings fail before delivery', async t => {
  const { runDir } = await setup(t);
  await writeFile(join(runDir, 'digest.md'), '## What was discussed\n## Top highlights\n## Claims worth checking\n');
  await assert.rejects(artifactHashes(runDir), /digest/);
});

test('one timestamped highlight plus four context bullets is not five highlights', async t => {
  const { runDir } = await setup(t);
  const file = join(runDir, 'digest.md');
  await writeFile(file, (await readFile(file, 'utf8')).replace(/- \[10:4[1-4]\] Highlight [1-4]/g, '- context only'));
  await assert.rejects(artifactHashes(runDir), /5–10 highlights/);
});

test('nested detail bullets do not inflate timestamped highlight cardinality', async t => {
  const { runDir } = await setup(t);
  const file = join(runDir, 'digest.md');
  await writeFile(file, (await readFile(file, 'utf8')).replaceAll('Highlight', 'Highlight\n  - Detail [10:59]\n  - More detail'));
  assert.ok((await artifactHashes(runDir)).digest);
});

test('HTTP 200 from an old dashboard cannot satisfy publication', async t => {
  const { runDir, responses } = await setup(t);
  responses.html = '<title>Old dashboard</title>';
  await assert.rejects(verifyRunDelivery(runDir), /FAILED at stage 7/);
});

test('missing manifest row, wrong source, and HTTP failure each fail closed', async t => {
  const { runDir, responses } = await setup(t);
  responses.dashboardStatus = 404;
  await assert.rejects(verifyRunDelivery(runDir), /HTTP 404/);
  responses.dashboardStatus = 200;
  responses.manifest.included[0].sourceRelative = 'unrelated.html';
  await assert.rejects(verifyRunDelivery(runDir), /manifest/);
  responses.manifest.included = [];
  await assert.rejects(verifyRunDelivery(runDir), /manifest/);
});

test('failed notification, missing URL, preview status and wrong run cannot be complete', async t => {
  const { runDir, receipt, save } = await setup(t);
  for (const change of [
    () => { receipt.notification.messageId = null; },
    () => { receipt.notification.messageId = 123; receipt.notification.accepted = false; },
    () => { receipt.notification.accepted = true; receipt.notification.body = 'Local MD only'; },
    () => { receipt.notification.body = receipt.publication.url; receipt.status = 'preview'; },
    () => { receipt.status = 'complete'; receipt.runName = 'another-run'; },
  ]) {
    change(); await save();
    await assert.rejects(verifyRunDelivery(runDir), /FAILED at stage/);
  }
});

test('CRLF human digest validates without changing its byte-bound hash', async t => {
  const { runDir, receipt, save } = await setup(t);
  const file = join(runDir, 'digest.md');
  await writeFile(file, (await readFile(file, 'utf8')).replaceAll('\n', '\r\n'));
  receipt.artifacts = await artifactHashes(runDir);
  await save();
  assert.equal((await verifyRunDelivery(runDir)).status, 'complete');
});
