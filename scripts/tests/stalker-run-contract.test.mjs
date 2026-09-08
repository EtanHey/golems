import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { artifactHashes, verifyRunDelivery, sha256 } from '../stalker-run-contract.mjs';
import { MEDIA_RETENTION_RECEIPT } from '../stalker-media-retention.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/stalker-2026-09-08.json', import.meta.url)));
async function setup(t, delivered = true) {
  const root = await mkdtemp(join(import.meta.dirname, '.stalker-contract-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runDir = join(root, fixture.runName);
  await mkdir(runDir);
  for (const [name, body] of Object.entries(fixture.files)) await writeFile(join(runDir, name), body);
  if (!delivered) return { runDir };
  const html = '<!doctype html><title>Theo digest</title><article><video src="evidence/clip.mp4" poster="evidence/frame.jpg"></video></article><p>What was discussed</p>';
  const mediaBytes=Buffer.from('published media');
  const highlights = Array.from({ length: 5 }, (_, i) => `- [10:${40 + i}] Highlight ${i}`).join('\n');
  await writeFile(join(runDir, 'digest.md'), `# Theo\n## What was discussed\n[10:47] A topic\n## Top highlights\n${highlights}\n## Claims worth checking\n[10:47] A claim\n`);
  await writeFile(join(runDir, 'dashboard.html'), html);
  const manifest = { included: [{ linkPath: 'dashboards/golems/stalker/run.html', sourceRelative: 'golems/docs.local/dashboards/stalker/run.html' }] };
  const responses = { dashboardStatus: 200, html, manifest, media: mediaBytes, mediaStatus:200 };
  const server = createServer((req, res) => {
    if(req.url.includes('/evidence/')) { res.statusCode=responses.mediaStatus; return res.end(responses.media); }
    res.statusCode = req.url === '/manifest.json' ? 200 : responses.dashboardStatus;
    res.end(req.url === '/manifest.json' ? JSON.stringify(responses.manifest) : responses.html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const url = `${origin}/${manifest.included[0].linkPath}`;
  const receipt = {
    version: 3, runName: fixture.runName, status: 'complete',
    artifacts: await artifactHashes(runDir),
    publication: { url, manifestUrl: `${origin}/manifest.json`, ...manifest.included[0], media:['clip.mp4','frame.jpg'].map(name=>({path:`evidence/${name}`,size:mediaBytes.length,sha256:sha256(mediaBytes)})) },
    notification: { accepted: true, messageId: 123, url, body: `Stalker complete. Dashboard: ${url}` },
  };
  const save = () => writeFile(join(runDir, '.stalker-completion.json'), JSON.stringify(receipt));
  await save();
  await saveRetention(runDir);
  return { runDir, receipt, save, responses };
}

async function saveRetention(runDir) {
  await writeFile(join(runDir, MEDIA_RETENTION_RECEIPT), JSON.stringify({
    version: 1, runName: fixture.runName, status: 'complete', files: [],
    totals: { beforeBytes: 0, afterBytes: 0, freedBytes: 0 },
  }));
}

test('September 8 ratchet: processing markers and gems cannot make a run COMPLETE', async t => {
  const { runDir } = await setup(t, false);
  await assert.rejects(verifyRunDelivery(runDir), /FAILED at stage 6.*digest\.md/);
});

test('COMPLETE requires matching live HTML, hub manifest, artifacts and notified URL', async t => {
  const { runDir } = await setup(t);
  const result = await verifyRunDelivery(runDir);
  assert.equal(result.status, 'complete');
  assert.equal(result.retentionVerification, 'local-receipt-only');
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

test('an explicit no-claims finding does not require inventing a timestamped claim', async t => {
  const { runDir } = await setup(t);
  const file = join(runDir, 'digest.md');
  await writeFile(file, (await readFile(file, 'utf8')).replace('[10:47] A claim', '- No explicit checkable claims identified.'));
  assert.ok((await artifactHashes(runDir)).digest);
});

test('served clips are required: a missing or replaced video cannot remain COMPLETE', async t => {
  const {runDir,responses}=await setup(t);
  responses.mediaStatus=404;
  await assert.rejects(verifyRunDelivery(runDir),/stage 7.*media/);
  responses.mediaStatus=200;responses.media=Buffer.from('replaced bytes');
  await assert.rejects(verifyRunDelivery(runDir),/stage 7.*media/);
});

test('every dashboard card must carry a video and a published poster', async t => {
  const {runDir,receipt,responses,save}=await setup(t);
  responses.html=responses.html.replace('</article>','</article><article>A card with no clip</article>');
  await writeFile(join(runDir,'dashboard.html'),responses.html);receipt.artifacts=await artifactHashes(runDir);await save();
  await assert.rejects(verifyRunDelivery(runDir),/stage 7.*card/);
});

test('version 3 COMPLETE requires local retention while interim publication can explicitly opt out', async t => {
  const {runDir,receipt,save}=await setup(t);
  await rm(join(runDir,MEDIA_RETENTION_RECEIPT));
  await assert.rejects(verifyRunDelivery(runDir),/stage 9/);
  assert.equal((await verifyRunDelivery(runDir,{receipt,requireNotification:false,requireRetention:false})).status,'published');
  await saveRetention(runDir);
  assert.equal((await verifyRunDelivery(runDir)).status,'complete');
});

test('a valid notified receipt fails default verification at retention stage 9', async t => {
  const {runDir,receipt,save}=await setup(t);
  receipt.status='notified';await save();
  await assert.rejects(verifyRunDelivery(runDir),/FAILED at stage 9.*retention/);
});

test('legacy version 2 completion receipts cannot satisfy retention-aware COMPLETE', async t => {
  const {runDir,receipt,save}=await setup(t);
  receipt.version=2;await save();
  await assert.rejects(verifyRunDelivery(runDir),/missing or wrong-run completion receipt/);
});
