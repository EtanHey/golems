import { test, expect } from 'bun:test';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { hostedEvidence } from './hosted-fixture.mjs';
import { fileURLToPath } from 'node:url';
const skillRoot = fileURLToPath(new URL('../', import.meta.url));
import { designTestCell } from './design-test-cell.mjs';
import { loadPublishedDesign, recordPublishedDesign } from '../src/design-history.mjs';
import { sha256, handoffPath } from '../src/hosted-delivery.mjs';
import { writePublishHandoff, prepareHostedInput } from '../src/prepare-hosted.mjs';
const cell = designTestCell(), migrationCell = designTestCell();
// The real BUILD needs ffmpeg/ffprobe; skip (like the browser suites without Chromium) where they are absent.
const mediaTools = ['ffmpeg', 'ffprobe'].every(bin => spawnSync(bin, ['-version']).status === 0);
function expectHandoffKeys(handoff) {
  expect(Object.keys(handoff).sort()).toEqual([
    'schema', 'dashboardId', 'type', 'sourcePath', 'builtHtmlSha256', 'sourceHtmlSha256',
    'buildReceiptsSha256', 'answerPersistence', 'answerRuntimeSha256', 'answerKeys',
    'design', 'mediaManifest', 'createdAt',
  ].sort());
  const designKeys = ['admission', 'lineage', 'predecessorSha256'];
  if (handoff.design.admission === 'FIRST_IN_LINEAGE') designKeys.push('firstInLineage');
  if (handoff.design.admission === 'REDESIGN_APPROVED') designKeys.push('redesign');
  expect(Object.keys(handoff.design).sort()).toEqual(designKeys.sort());
}
function hostedJob(testCell) {
  const jobDir = mkdtempSync(path.join(testCell.root, 'handoff-job-'));
  const seg = path.join(jobDir, 'segments/one'); mkdirSync(seg, { recursive: true });
  const wav = path.join(seg, 'one.wav'), mp3 = path.join(seg, 'one.mp3');
  for (const flags of [['-f', 'lavfi', '-i', 'sine=frequency=140:duration=1', wav], ['-i', wav, mp3]]) {
    const encoded = spawnSync('ffmpeg', ['-v', 'error', ...flags]); expect(encoded.status).toBe(0);
  }
  for (const file of ['words.json', 'words.raw.json']) writeFileSync(path.join(seg, file), JSON.stringify([
    { word: 'real', start: 0.05, end: 0.4 }, { word: 'timing', start: 0.45, end: 0.8 }]));
  const baselinePath = path.join(jobDir, 'accepted-design.json'); writeFileSync(baselinePath, '{"accepted":true}');
  const outputPath = path.join(jobDir, 'docs.local/dashboards/example.html'), specPath = path.join(jobDir, 'job.json');
  writeFileSync(specPath, JSON.stringify({ id: 'example', design: { firstInLineage: { reason: 'Approved isolated fixture lineage', approvedBy: 'fixture-owner' } }, series: 'isolated-handoff-fixture', type: 'decision-flow', outputPath,
    acceptedBaseline: { path: baselinePath, sha256: sha256(readFileSync(baselinePath)) },
    scenes: [{ id: 'one', script: 'real timing', audioWav: wav }], decisions: [{ id: 'd', title: 'Decision', body: 'real timing', sources: [{ label: 'guide', url: 'https://example.com/guide' }], sceneIds: ['one'], options: ['Keep', 'Change'], checklist: ['First', 'Second'] }] }));
  return { jobDir, outputPath, specPath };
}
(mediaTools ? test : test.skip)('real BUILD and QA produce a handoff; only delivery receipt earns PASS', () => {
  const { jobDir, outputPath, specPath } = hostedJob(cell);
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
  expectHandoffKeys(h);
  expect(h.answerRuntimeSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(h.schema).toBe('audio-dashboard.publish-handoff.v2');
  expect(h.builtHtmlSha256).toBe(sha256(html));
  expect(h.buildReceiptsSha256).toBe(sha256(readFileSync(outputPath.replace('.html', '.receipts.json'))));
  expect(h.design.admission).toBe('FIRST_IN_LINEAGE');
  expect(h.design.lineage).toBe('briefings');
  expect(h.design.firstInLineage).toEqual({ reason: 'Approved isolated fixture lineage', approvedBy: 'fixture-owner' });
  expect(() => loadPublishedDesign({ series: 'another-series' }, outputPath, cell.options)).toThrow('previous build missing');
  expect(h.design.predecessorSha256).toBeNull();
  expect(h.sourcePath).toBe('example.publish-source/' + sha256(html));
  const sourceDir = path.join(path.dirname(outputPath), h.sourcePath), sourceHtml = readFileSync(path.join(sourceDir, 'index.html'), 'utf8');
  expect(sourceHtml).not.toContain('data:audio/'); expect(h.sourceHtmlSha256).toBe(sha256(sourceHtml));
  expect(h.sourceHtmlSha256).not.toBe(h.builtHtmlSha256); expect(sourceHtml).toContain('target="_blank"');
  expect(JSON.parse(readFileSync(path.join(sourceDir, 'asset-manifest.json'))).assets[0].duration).toBeGreaterThan(0);
  expect(h.answerKeys.map(k => k.key).sort()).toEqual(['d', 'd-checks', 'd-free', 'd-notes']);
  expect(h.answerKeys.find(k => k.key === 'd-checks')).toEqual({ key: 'd-checks', kind: 'checkbox', options: ['0', '1'] });
  const approvedSpec = JSON.parse(readFileSync(specPath));
  const changedApprovalSpec = { ...approvedSpec, design: { firstInLineage: { ...approvedSpec.design.firstInLineage, approvedBy: 'other-owner' } } };
  expect(() => writePublishHandoff({ spec: changedApprovalSpec, specPath, outputPath, html, firstBuild: 'Isolated contract fixture' })).toThrow('PUBLISH_HANDOFF_FIRST_LINEAGE_APPROVAL_CHANGED');
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
  expect(loadPublishedDesign({ series: 'another-series' }, outputPath, cell.options).previousHtml).toBe(html);
  expect(run(['--delivery', receiptPath]).status).toBe(0);
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
    spec.redesign = redesign; writeFileSync(reportPath, JSON.stringify({ ...report, status, predecessorSha256: sha256(html), admission, ...(status === 'REDESIGN' ? { redesign } : {}) }));
    const mapped = writePublishHandoff({ spec, specPath, outputPath, segmentsDir: path.join(jobDir, 'segments'), html });
    expectHandoffKeys(mapped);
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

(mediaTools ? test : test.skip)('BUILD and handoff migrate supplied page Y instead of legacy series page X; accepted conflicts refuse', () => {
  const { jobDir, outputPath, specPath } = hostedJob(migrationCell), spec = JSON.parse(readFileSync(specPath));
  const run = (script, flags = []) => spawnSync('bun', migrationCell.command(`scripts/${script}.mjs`, ['--spec', specPath, '--job-dir', jobDir, ...flags]).slice(1),
    { cwd: skillRoot, encoding: 'utf8' });
  const seed = run('build-dashboard', ['--first-build', 'Approved fixture seed']); expect(seed.status, seed.stderr).toBe(0);
  const y = readFileSync(outputPath, 'utf8'), x = readFileSync(new URL('./fixtures/design-preservation/previous.html', import.meta.url), 'utf8');
  expect(sha256(x)).not.toBe(sha256(y));
  const legacy = path.join(migrationCell.options.registryRoot, spec.series); mkdirSync(legacy, { recursive: true });
  const filename = sha256(x) + '.html'; writeFileSync(path.join(legacy, filename), x);
  writeFileSync(path.join(legacy, 'published.json'), JSON.stringify({ series: spec.series, filename, sha256: sha256(x) }));
  const served = path.join(jobDir, 'served-y.html'); writeFileSync(served, y);
  spec.designPreservation = { previousPublished: served }; delete spec.design.firstInLineage;
  writeFileSync(specPath, JSON.stringify(spec));
  const rebuilt = run('build-dashboard'); expect(rebuilt.status, rebuilt.stderr).toBe(0);
  const report = JSON.parse(readFileSync(outputPath.replace('.html', '.design.json')));
  expect([report.admission, report.lineage, report.predecessorSha256]).toEqual(['COMPARED', 'briefings', sha256(y)]);
  const prepared = run('validate-evidence', ['--prepare-publish', '--json']); expect(prepared.status, prepared.stderr).toBe(0);
  const handoff = JSON.parse(readFileSync(handoffPath(outputPath)));
  expectHandoffKeys(handoff);
  expect(handoff.design).toEqual({ admission: 'COMPARED', lineage: 'briefings', predecessorSha256: sha256(y) });
  const reset = run('build-dashboard', ['--first-build', 'Attempted migration reset']);
  expect(reset.status).not.toBe(0); expect(reset.stderr).toContain('DESIGN_LINEAGE_RESET_REFUSED');
  recordPublishedDesign(spec, outputPath, y, { ...migrationCell.options, acceptedBy: 'fixture-owner' });
  const accepted = loadPublishedDesign(spec, outputPath, migrationCell.options);
  expect(accepted.previousPath).toContain('/lineages/briefings/'); expect(accepted.previousHtml).toBe(y);
  spec.designPreservation.previousPublished = path.join(legacy, filename); writeFileSync(specPath, JSON.stringify(spec));
  const conflict = run('build-dashboard');
  expect(conflict.status).not.toBe(0); expect(conflict.stderr).toContain('DESIGN_PREDECESSOR_CONFLICT');
}, 30000);
