import { afterAll, beforeAll, expect, test } from 'bun:test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { checkDesignPreservation, loadPublishedDesign as loadRegistry, recordPublishedDesign as recordRegistry } from '../src/design-preservation.mjs';

import { designTestCell } from './design-test-cell.mjs';
const cell = designTestCell();
const loadPublishedDesign = (spec, output, options) => loadRegistry(spec, output, { ...options, ...cell.options });
const recordPublishedDesign = (spec, output, html) => recordRegistry(spec, output, html, cell.options);
const fixture = name => readFileSync(new URL(`./fixtures/design-preservation/${name}.html`, import.meta.url), 'utf8');
let browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });
const waiver = invariants => ({ reason: 'New transport requested.', invariants, from: createHash('sha256').update(fixture('previous')).digest('hex') });
const check = (html, extra = {}) => checkDesignPreservation({ browser, html, previousHtml: fixture('previous'), ...extra });
for (const code of ['STICKY_PLAYER', 'READ_ALONG', 'SPEAKER_LABELS', 'FULL_TRANSCRIPT', 'LAYOUT', 'ANSWER_CONTROLS', 'COPY_BUTTONS']) {
  test(`removed invariant rejects by name: ${code}`, async () => {
    const result = await check(fixture(code.toLowerCase()));
    expect(result.verdict).toBe('REJECTED');
    expect([...new Set(result.violations.map(v => v.code))]).toEqual([code]);
  });
}
test('preserved copy edit passes and reports pixel ratios at both widths', async () => {
  const result = await check(fixture('preserved'));
  expect(result.verdict).toBe('PASS');
  expect(result.screenshots.map(s => s.width)).toEqual([1280, 390]);
  expect(result.screenshots.every(s => s.pixelDiffRatio > 0 && s.pixelDiffRatio < 1)).toBe(true);
});
test('explicit redesign reason permits regressions but retains evidence', async () => {
  const result = await check(fixture('sticky_player'), { redesign: waiver(['STICKY_PLAYER']) });
  expect(result.verdict).toBe('PASS');
  expect(result.status).toBe('REDESIGN');
  expect(result.violations[0].code).toBe('STICKY_PLAYER');
  expect(result.redesign.reason).toBe('New transport requested.');
});
test('blank or implicit redesign cannot waive a violation', async () => {
  for (const redesign of [true, { reason: '' }, { reason: 'two\nlines' }]) {
    expect((await check(fixture('sticky_player'), { redesign })).verdict).toBe('REJECTED');
  }
});
test('first build records baseline; missing previous fails even with redesign', async () => {
  expect((await check(fixture('preserved'), { previousHtml: null })).status).toBe('BASELINE');
  const result = await check(fixture('preserved'), { previousHtml: undefined, redesign: { reason: 'New layout.' } });
  expect(result.violations[0].code).toBe('PREVIOUS_BUILD_MISSING');
  expect(result.verdict).toBe('REJECTED');
});
test('computed cascade, toggles, segment labels and input types cannot fake preservation', async () => {
  const html = fixture('previous');
  for (const [changed, code] of [
    [html.replace('</style>', '.player-controls{position:static!important}</style>'), 'STICKY_PLAYER'],
    [html.replace('<div class="readalong"', '<details><summary>Show transcript</summary><div class="readalong"').replace('</section>', '</details></section>'), 'READ_ALONG'],
    [html.replace('type="checkbox"', 'type="button"'), 'ANSWER_CONTROLS'],
    [html.replace('>Host</span>', '> </span>'), 'SPEAKER_LABELS'],
  ]) expect((await check(changed)).violations.some(v => v.code === code)).toBe(true);
});
test('published history is series-specific, immutable on rebuild, and fails closed on loss', () => {
  const dir = path.join(cell.root, 'history');
  mkdirSync(dir, { recursive: true });
  const output = path.join(dir, 'v1.html'), spec = { id: 'v1', series: 'adp-fixture-' + crypto.randomUUID() };
  expect(() => loadPublishedDesign(spec, output)).toThrow('previous build missing');
  recordPublishedDesign(spec, output, fixture('previous'));
  expect(loadPublishedDesign({ id: 'v2', series: spec.series }, output).previousHtml).toBe(fixture('previous'));
  expect(() => loadPublishedDesign({ id: 'v2', series: spec.series + '-other' }, output)).toThrow('previous build missing');
  const previous = loadPublishedDesign(spec, output);
  writeFileSync(previous.previousPath, 'corrupt');
  expect(() => loadPublishedDesign(spec, output)).toThrow('previous build missing');
  expect(() => loadPublishedDesign({ ...spec, designPreservation: { previousPublished: 'absent.html' } }, output)).toThrow('previous build missing');
});

test('real CLI and render-done gate reject every regression and allow an explicit redesign', () => {
  const dir = path.join(cell.root, 'cli');
  mkdirSync(dir, { recursive: true });
  const outputPath = path.join(dir, 'new.html'), specPath = path.join(dir, 'job.json');
  const spec = { series: 'adp-cli-' + crypto.randomUUID(), id: 'weekly', outputPath, designPreservation: { previousPublished: path.resolve(new URL('./fixtures/design-preservation/previous.html', import.meta.url).pathname) } };
  const run = script => Bun.spawnSync(cell.command(new URL(`../scripts/${script}.mjs`, import.meta.url).pathname, ['--spec', specPath]));
  for (const code of ['STICKY_PLAYER', 'READ_ALONG', 'SPEAKER_LABELS', 'FULL_TRANSCRIPT', 'LAYOUT', 'ANSWER_CONTROLS', 'COPY_BUTTONS']) {
    writeFileSync(outputPath, fixture(code.toLowerCase())); writeFileSync(specPath, JSON.stringify(spec));
    const result = run('check-design-preservation');
    expect(result.exitCode).toBe(3); expect(result.stdout.toString()).toContain(code);
  }
  expect(run('render-done-gate-cli').exitCode).toBe(3);
  writeFileSync(specPath, JSON.stringify({ ...spec, redesign: waiver(['COPY_BUTTONS']) }));
  expect(run('render-done-gate-cli').exitCode).toBe(0);
  writeFileSync(specPath, JSON.stringify({ ...spec, designPreservation: { previousPublished: 'absent.html' } }));
  expect(run('check-design-preservation').stdout.toString()).toContain('PREVIOUS_BUILD_MISSING');
}, 30000);

test('publish probe advances history only after byte equality and preservation pass', async () => {
  const dir = path.join(cell.root, 'publish');
  mkdirSync(dir, { recursive: true });
  const outputPath = path.join(dir, 'new.html'), specPath = path.join(dir, 'job.json'), spec = { id: 'weekly', series: 'adp-publish-' + crypto.randomUUID(), outputPath, designPreservation: { baseline: { reason: 'New fixture series.' } } };
  let served = fixture('previous');
  const server = Bun.serve({ port: 0, fetch: () => new Response(served, { headers: { 'content-type': 'text/html' } }) });
  const probe = async (firstBuild = false) => {
    const child = Bun.spawn(cell.command(new URL('../scripts/verify-tailnet-publish.mjs', import.meta.url).pathname, ['--spec', specPath, '--url', server.url.href, ...(firstBuild ? ['--first-build', 'New fixture series.'] : [])]), { stdout: 'pipe', stderr: 'pipe' });
    return { code: await child.exited, stderr: await new Response(child.stderr).text() };
  };
  try {
    writeFileSync(specPath, JSON.stringify(spec)); writeFileSync(outputPath, served);
    expect((await probe(true)).code).toBe(0);
    writeFileSync(outputPath, fixture('preserved'));
    expect((await probe()).stderr).toContain('hash mismatch');
    served = fixture('sticky_player'); writeFileSync(outputPath, served);
    expect((await probe()).stderr).toContain('STICKY_PLAYER');
    expect(loadPublishedDesign(spec, outputPath).previousHtml).toBe(fixture('previous'));
  } finally { server.stop(true); }
}, 30000);
