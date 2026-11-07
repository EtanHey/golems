import { test, expect } from 'bun:test';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { hostedEvidence } from './hosted-fixture.mjs';
import { fileURLToPath } from 'node:url';
const skillRoot = fileURLToPath(new URL('../', import.meta.url));
import { designTestCell } from './design-test-cell.mjs';
import { sha256, handoffPath } from '../src/hosted-delivery.mjs';
import { writePublishHandoff, prepareHostedInput } from '../src/prepare-hosted.mjs';
const cell = designTestCell();
test('real BUILD and QA produce a handoff; only delivery receipt earns PASS', () => {
  const jobDir = mkdtempSync(path.join(tmpdir(), 'handoff-job-'));
  const seg = path.join(jobDir, 'segments/one'); mkdirSync(seg, { recursive: true });
  const wav = path.join(seg, 'one.wav'), mp3 = path.join(seg, 'one.mp3');
  for (const flags of [['-f', 'lavfi', '-i', 'sine=frequency=140:duration=1', wav], ['-i', wav, mp3]]) {
    const encoded = spawnSync('ffmpeg', ['-v', 'error', ...flags]); expect(encoded.status).toBe(0);
  }
  for (const file of ['words.json', 'words.raw.json']) writeFileSync(path.join(seg, file), JSON.stringify([
    { word: 'real', start: 0.05, end: 0.4 }, { word: 'timing', start: 0.45, end: 0.8 }]));
  const baselinePath = path.join(jobDir, 'accepted-design.json'); writeFileSync(baselinePath, '{"accepted":true}');
  const outputPath = path.join(cell.root, 'docs.local/dashboards/example.html'), specPath = path.join(jobDir, 'job.json');
  writeFileSync(specPath, JSON.stringify({ id: 'example', series: 'isolated-handoff-fixture', type: 'decision-flow', outputPath,
    acceptedBaseline: { path: baselinePath, sha256: sha256(readFileSync(baselinePath)) },
    scenes: [{ id: 'one', script: 'real timing', audioWav: wav }], decisions: [{ id: 'd', title: 'Decision', body: 'Read [guide](https://example.com/guide).', sceneIds: ['one'], options: ['Keep', 'Change'], checklist: ['First', 'Second'] }] }));
  const built = spawnSync('bun', cell.command('scripts/build-dashboard.mjs', ['--spec', specPath, '--job-dir', jobDir,
    '--first-build', 'Isolated contract fixture']).slice(1), { cwd: skillRoot, encoding: 'utf8' });
  expect(built.status, built.stderr).toBe(0);
  const run = extra => spawnSync('bun', cell.command('scripts/validate-evidence.mjs', [
    '--spec', specPath, '--job-dir', jobDir, '--first-build', 'Isolated contract fixture', '--json', ...extra]).slice(1),
    { cwd: skillRoot, encoding: 'utf8', env: { ...process.env, AUDIO_DASHBOARD_DELIVERY_ORIGINS: '["https://example.com"]' } });
  const prepared = run(['--prepare-publish']);
  expect(prepared.status, prepared.stderr).toBe(0);
  expect(JSON.parse(prepared.stdout).verdict).toBe('READY_FOR_HOSTED_PUBLISH');
  const h = JSON.parse(readFileSync(handoffPath(outputPath))), html = readFileSync(outputPath, 'utf8');
  expect(h.answerRuntimeSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(h.schema).toBe('audio-dashboard.publish-handoff.v2');
  expect(h.builtHtmlSha256).toBe(sha256(html));
  expect(h.buildReceiptsSha256).toBe(sha256(readFileSync(outputPath.replace('.html', '.receipts.json'))));
  expect(h.design.admission).toBe('FIRST_IN_LINEAGE');
  expect(h.design.predecessorSha256).toBeNull();
  expect(h.sourcePath).toBe('example.publish-source/' + sha256(html));
  const sourceDir = path.join(path.dirname(outputPath), h.sourcePath), sourceHtml = readFileSync(path.join(sourceDir, 'index.html'), 'utf8');
  expect(sourceHtml).not.toContain('data:audio/'); expect(h.sourceHtmlSha256).toBe(sha256(sourceHtml));
  expect(h.sourceHtmlSha256).not.toBe(h.builtHtmlSha256); expect(sourceHtml).toContain('target="_blank"');
  expect(JSON.parse(readFileSync(path.join(sourceDir, 'asset-manifest.json'))).assets[0].duration).toBeGreaterThan(0);
  expect(h.answerKeys.map(k => k.key).sort()).toEqual(['d', 'd-checks', 'd-free', 'd-notes']);
  expect(h.answerKeys.find(k => k.key === 'd-checks')).toEqual({ key: 'd-checks', kind: 'checkbox', options: ['0', '1'] });
  const [clip] = h.mediaManifest;
  const bytes = readFileSync(path.resolve(path.dirname(outputPath), h.sourcePath, clip.file));
  expect([clip.size, clip.sha256]).toEqual([bytes.length, sha256(bytes)]);
  const tailnet = run(['--published', 'sync-tailnet-dashboards.mjs']);
  expect(tailnet.status).toBe(3);
  expect(tailnet.stdout).toContain('MISSING_HOSTED_DELIVERY');
  const receiptPath = path.join(jobDir, 'delivery.json');
  const delivery = hostedEvidence({ html }).delivery; delivery.admission.design = h.design.admission; delivery.sourceHtmlSha256 = h.sourceHtmlSha256;
  writeFileSync(receiptPath, JSON.stringify(delivery));
  const delivered = run(['--delivery', receiptPath]);
  expect(delivered.status, delivered.stderr).toBe(0);
  expect(JSON.parse(delivered.stdout).verdict).toBe('PASS');
  const receiptsPath = outputPath.replace('.html', '.receipts.json'), receipts = readFileSync(receiptsPath);
  writeFileSync(receiptsPath, Buffer.concat([receipts, Buffer.from(' ')]));
  expect(run(['--delivery', receiptPath]).stdout).toContain('BUILD_RECEIPTS_SHA_MISMATCH');
  writeFileSync(receiptsPath, receipts);
  delivery.admission.answerRuntime = 'deprecated'; writeFileSync(receiptPath, JSON.stringify(delivery));
  expect(run(['--delivery', receiptPath]).status).toBe(5);
  delivery.admission.answerRuntime = 'current'; writeFileSync(receiptPath, JSON.stringify(delivery));
  // Unit-check admission mapping using existing design-report statuses.
  const spec = JSON.parse(readFileSync(specPath)), reportPath = outputPath.replace('.html', '.design.json');
  const report = JSON.parse(readFileSync(reportPath)), predecessor = path.join(jobDir, 'previous.html');
  writeFileSync(predecessor, html); spec.designPreservation = { previousPublished: predecessor };
  for (const [status, admission] of [['COMPARED', 'COMPARED'], ['REDESIGN', 'REDESIGN_APPROVED']]) {
    const redesign = { reason: 'Fixture ruling', approvedBy: 'fixture-owner', from: sha256(html) };
    spec.redesign = redesign; writeFileSync(reportPath, JSON.stringify({ ...report, status, ...(status === 'REDESIGN' ? { redesign } : {}) }));
    const mapped = writePublishHandoff({ spec, specPath, outputPath, segmentsDir: path.join(jobDir, 'segments'), html });
    expect([mapped.design.admission, mapped.design.predecessorSha256]).toEqual([admission, sha256(html)]);
  }
  Object.assign(delivery, { backfilled: true, staging: { mode: 'none-backfill', servedShellSha256: delivery.servedShellSha256 } }); delivery.admission.design = 'UNKNOWN_BACKFILL';
  unlinkSync(handoffPath(outputPath)); writeFileSync(receiptPath, JSON.stringify(delivery));
  const historical = run(['--delivery', receiptPath, '--source-dir', sourceDir]); expect(historical.status, historical.stderr).toBe(4);
  expect(JSON.parse(historical.stdout).verdict).toBe('BACKFILL_ACCOUNT_PROVEN');
  const prepare = candidate => prepareHostedInput({ spec, outputPath, html: candidate, segmentsDir: path.join(jobDir, 'segments') });
  expect(() => prepare(html + '<audio src="data:audio/wav;base64,AA=="></audio>')).toThrow('PREPARE_EMBEDDED_MEDIA_REMAINS');
  expect(() => prepare(html.replace(/data:audio\/mpeg;base64,[A-Za-z0-9+/=]+/g, 'missing.mp3'))).toThrow('PREPARE_EMBEDDED_CLIP_MISSING');
  spec.acceptedBaseline.sha256 = '0'.repeat(64);
  expect(() => writePublishHandoff({ spec, specPath, outputPath, segmentsDir: path.join(jobDir, 'segments'), html })).toThrow('ACCEPTED_BASELINE_RECEIPT_REQUIRED');
}, 60000);
