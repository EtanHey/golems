import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { checkDesignPreservation, loadPublishedDesign, recordPublishedDesign, writeDesignReport } from '../src/design-preservation.mjs';
import { validateAudioDashboardEvidence } from '../src/audio-dashboard-evidence.mjs';
const html = readFileSync(new URL('./fixtures/design-preservation/previous.html', import.meta.url), 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
const root = path.resolve('docs.local/adp/r2/tests-' + process.pid);
mkdirSync(root, { recursive: true });
let browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); });
const check = (next, extra = {}) => checkDesignPreservation({ html: next, previousHtml: html, browser, ...extra });
test('missing history is not a first-build declaration; series survives a directory and id change', () => {
  const spec = { series: 'adp-r2-' + crypto.randomUUID() }, first = path.join(root, 'one.html');
  expect(() => loadPublishedDesign(spec, first)).toThrow('previous build missing');
  expect(loadPublishedDesign({ ...spec, designPreservation: { baseline: { reason: 'New series.' } } }, first).previousHtml).toBeNull();
  recordPublishedDesign(spec, first, html);
  expect(loadPublishedDesign({ ...spec, id: 'different' }, path.join(root, 'other', 'two.html')).previousHtml).toBe(html);
  expect(loadPublishedDesign({ ...spec, designPreservation: { baseline: { reason: 'Cannot reset history.' } } }, first).previousHtml).toBe(html);
  expect(() => loadPublishedDesign({ id: spec.series }, first)).toThrow();
});
test('content reconciliation preserves design even with changed ids, labels, groups and counts', async () => {
  const next = html.replaceAll('intro', 'new-scene').replace('>Host<', '>Presenter<').replaceAll('choice', 'new-answer');
  expect((await check(next)).verdict).toBe('PASS');
});
test('waiver is limited to invariant and predecessor hash', async () => {
  const changed = html.replace('max-width:920px', 'max-width:1100px');
  const redesign = { reason: 'Wider reading column.', invariants: ['LAYOUT'], from: hash(html) };
  expect((await check(changed, { redesign })).verdict).toBe('PASS');
  expect((await check(changed.replace('position:sticky', 'position:static'), { redesign })).verdict).toBe('REJECTED');
  expect((await check(changed, { redesign: { ...redesign, from: hash(changed) } })).verdict).toBe('REJECTED');
});
test('no design signals is a named rejection, and absent invariants remain visible in the report', async () => {
  const result = await check('<p>Only prose</p>', { previousHtml: '<p>Only prose</p>' });
  expect(result.violations.some(v => v.code === 'NO_DESIGN_SIGNAL')).toBe(true);
  expect(result.invariants.some(row => row.code === 'STICKY_PLAYER' && !row.detectedInPrevious)).toBe(true);
});
test('entrance animation settles before read-along measurement', async () => {
  const next = html.replace('</style>', '@keyframes enter{from{opacity:0}to{opacity:1}}.readalong{animation:enter 30s linear}</style>');
  expect((await check(next)).verdict).toBe('PASS');
});
test('library rejects absent, stale and rejected design sidecars', () => {
  const outputPath = path.join(root, 'gate.html'), evidence = { html, outputPath };
  expect(validateAudioDashboardEvidence(evidence).violations.some(v => v.code === 'DESIGN_PRESERVATION_MISSING')).toBe(true);
  writeDesignReport(outputPath, html, { verdict: 'PASS' });
  expect(validateAudioDashboardEvidence(evidence).violations.some(v => v.code.startsWith('DESIGN_PRESERVATION'))).toBe(false);
  expect(validateAudioDashboardEvidence({ ...evidence, html: html + 'changed' }).violations.some(v => v.code === 'DESIGN_PRESERVATION_REJECTED')).toBe(true);
  writeDesignReport(outputPath, html, { verdict: 'REJECTED' });
  expect(validateAudioDashboardEvidence(evidence).violations.some(v => v.code === 'DESIGN_PRESERVATION_REJECTED')).toBe(true);
});
test('transcript visibility is checked after the last clip ends, independent of summary copy', async () => {
  const previousHtml = html.replace('</main>', '<audio></audio></main>');
  const next = previousHtml.replace('</body>', '<script>document.querySelector("audio").onended=()=>document.getElementById("full-transcript").open=false;</script></body>');
  const result = await check(next, { previousHtml });
  expect(result.violations.some(v => v.code === 'FULL_TRANSCRIPT')).toBe(true);
  expect((await check(previousHtml.replace('Full transcript', 'Transcript'), { previousHtml })).verdict).toBe('PASS');
});
test('de-identified real template preserves copy and detects a dropped controller', async () => {
  const { renderDecisionFlow } = await import('../src/decision-flow.mjs');
  const previousHtml = renderDecisionFlow({ scenes: [{ id: 'sample', title: 'Sample', speaker: 'Presenter', script: 'Review now', words: [{ word: 'Review', start: 0, end: 0.3 }, { word: 'now', start: 0.3, end: 0.6 }], audioUrl: 'data:audio/mpeg;base64,SUQz' }], decisions: [{ id: 'question', title: 'Next step', sceneIds: ['sample'], options: ['Continue'] }] }).replace('</head>', '<style>.df-teleprompter[hidden]{display:block!important}</style></head>');
  const next = previousHtml.replaceAll('Next step', 'Choose a step');
  expect((await check(next, { previousHtml })).verdict).toBe('PASS');
  const result = await check(next.replace('</head>', '<style>.df-controller{position:static!important}</style></head>'), { previousHtml });
  expect(result.violations.some(v => v.code === 'STICKY_PLAYER')).toBe(true);
  expect(result.invariants.some(row => row.code === 'READ_ALONG' && row.detectedInPrevious)).toBe(true);
});
test('real-markup reduction rejects a lost transport and transcript', async () => {
  const previousHtml = readFileSync(new URL('./fixtures/design-preservation/template-baseline.html', import.meta.url), 'utf8');
  const next = readFileSync(new URL('./fixtures/design-preservation/template-redesign.html', import.meta.url), 'utf8');
  const result = await check(next, { previousHtml });
  expect(result.violations.map(v => v.code)).toContain('STICKY_PLAYER');
  expect(result.violations.map(v => v.code)).toContain('READ_ALONG');
});
