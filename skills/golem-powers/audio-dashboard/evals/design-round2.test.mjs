import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { checkDesignPreservation, loadPublishedDesign as loadRegistry, recordPublishedDesign as recordRegistry, writeDesignReport } from '../src/design-preservation.mjs';
import { validateAudioDashboardEvidence } from '../src/audio-dashboard-evidence.mjs';
import { designTestCell } from './design-test-cell.mjs';
const cell = designTestCell();
const loadPublishedDesign = (spec, output, options) => loadRegistry(spec, output, { ...options, ...cell.options });
const recordPublishedDesign = (spec, output, html) => recordRegistry(spec, output, html, { ...cell.options, acceptedBy: 'fixture-owner' });
const html = readFileSync(new URL('./fixtures/design-preservation/previous.html', import.meta.url), 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
const root = cell.root;
let browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); });
const check = (next, extra = {}) => checkDesignPreservation({ html: next, previousHtml: html, browser, ...extra });
test('missing history is not a first-build declaration; series survives a directory and id change', () => {
  const spec = { design: { firstInLineage: { reason: 'Approved isolated fixture lineage', approvedBy: 'fixture-owner' } }, series: 'adp-r2-' + crypto.randomUUID() }, first = path.join(root, 'one.html');
  expect(() => loadPublishedDesign(spec, first)).toThrow('previous build missing');
  expect(loadPublishedDesign(spec, first, { firstBuild: 'New series.' }).previousHtml).toBeNull();
  recordPublishedDesign(spec, first, html);
  expect(loadPublishedDesign({ ...spec, id: 'different' }, path.join(root, 'other', 'two.html')).previousHtml).toBe(html);
  expect(loadPublishedDesign({ ...spec, designPreservation: { baseline: { reason: 'Cannot reset history.' } } }, first).previousHtml).toBe(html);
  expect(() => loadPublishedDesign({ design: { lineage: 'unknown' } }, first)).toThrow();
});
test('content reconciliation preserves design even with changed ids, labels, groups and counts', async () => {
  const next = html.replaceAll('intro', 'new-scene').replace('>Host<', '>Presenter<').replaceAll('choice', 'new-answer');
  expect((await check(next)).verdict).toBe('PASS');
});
test('waiver is limited to invariant and predecessor hash', async () => {
  const changed = html.replace('max-width:920px', 'max-width:1100px');
  const redesign = { reason: 'Wider reading column.', approvedBy: 'fixture-owner', invariants: ['LAYOUT'], from: hash(html) };
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

for (const cssPath of ['templates/decision-flow/decision-flow.css', 'vendor/agent-html/templates/v4-story-mode/cinema.css']) test(`badge AA contrast: ${cssPath}`, async () => {
  const page = await browser.newPage();
  try { await page.setContent(`<style>${readFileSync(new URL('../' + cssPath, import.meta.url), 'utf8')}</style><div style="color:#eee;background:#79cfc2"><span class="ad-badge">recommended</span><span class="ad-badge">REBOOT</span></div>`);
    const luminance = rgb => rgb.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
    for (const width of [390, 1280]) { await page.setViewportSize({ width, height: 800 }); for (const badge of await page.locator('.ad-badge').all()) { const colors = await badge.evaluate(el => [getComputedStyle(el).color, getComputedStyle(el).backgroundColor].map(c => c.match(/[\d.]+/g).map(Number))); expect(colors[1][3] ?? 1).toBe(1); expect(contrast(...colors)).toBeGreaterThanOrEqual(4.5); } }
    expect(contrast([119, 119, 119], [255, 255, 255])).toBeLessThan(4.5); expect(contrast([238, 238, 238], [121, 207, 194])).toBeLessThan(4.5); expect(contrast([255, 255, 255], [16, 26, 44])).toBeGreaterThanOrEqual(4.5);
  } finally { await page.close(); }
});
