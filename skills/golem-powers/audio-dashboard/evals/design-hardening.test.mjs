import { afterAll, beforeAll, expect, test } from 'bun:test';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { checkDesignPreservation, checkPublishedDesign, loadPublishedDesign, recordPublishedDesign } from '../src/design-preservation.mjs';
import { designHash } from '../src/design-history.mjs';
import { designTestCell } from './design-test-cell.mjs';
const cell = designTestCell(), options = cell.options;
const html = readFileSync(new URL('./fixtures/design-preservation/previous.html', import.meta.url), 'utf8');
let browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); });
test('N1 carried first-build spec fails closed in an empty registry', async () => {
  const spec = { series: 'reused', designPreservation: { baseline: { reason: 'Old first publication.' } } };
  const result = await checkPublishedDesign(spec, path.join(cell.root, 'new-folder.html'), html, { ...options, browser });
  expect(result.violations.map(v => v.code)).toContain('PREVIOUS_BUILD_MISSING');
});
test('N1 per-invocation firstBuild and N3 injected registry preserve migration custody', () => {
  const spec = { series: 'isolated' }, output = path.join(cell.root, 'first.html');
  expect(loadPublishedDesign(spec, output, { ...options, firstBuild: 'Initial publication.' }).previousHtml).toBeNull();
  recordPublishedDesign(spec, output, html, options);
  const record = loadPublishedDesign(spec, path.join(cell.root, 'other', 'next.html'), options);
  expect(record.previousPath.startsWith(options.registryRoot + path.sep)).toBe(true);
  expect(record.previousHtml).toBe(html);
  writeFileSync(output, html);
  expect(loadPublishedDesign({ series: 'migrated', designPreservation: { previousPublished: output } }, output, options).previousHtml).toBe(html);
});
const layout = '<style>.df-layout{max-width:1000px;margin:auto;padding:20px;display:grid;grid-template-columns:200px 1fr;gap:20px}.df-ledger{grid-column:2;max-width:540px;width:100%;margin:0 auto}</style><div class="df-layout"><aside>Index</aside><main class="df-ledger"><p>Review the next step.</p></main></div>';
test('N2 reading-column width and parent-relative centering are gated separately from the outer grid', async () => {
  const check = html => checkDesignPreservation({ html, previousHtml: layout, browser });
  expect((await check(layout.replace('next step', 'current next step'))).verdict).toBe('PASS');
  for (const html of [layout.replace('max-width:540px', 'max-width:480px'), layout.replace('margin:0 auto', 'margin:0 auto 0 0')]) {
    expect((await check(html)).violations.map(v => v.code)).toContain('LAYOUT');
  }
  const result = await check(layout);
  expect(result.detail[0].new.column.centered).toBe(true);
});
test('N4 controls without a foundational design signal reject', async () => {
  const html = '<button>Copy</button><input type="radio"><div class="df-controller"><button>Play</button></div>';
  const result = await checkDesignPreservation({ html, previousHtml: html, browser });
  expect(result.violations.map(v => v.code)).toContain('NO_DESIGN_SIGNAL');
});
test('N6 baseline waivers and unused waiver entries reject', async () => {
  const redesign = { reason: 'Intentional layout change.', from: designHash(html), invariants: ['LAYOUT', 'STICKY_PLAYER'] };
  const result = await checkDesignPreservation({ html: html.replace('max-width:920px', 'max-width:1100px'), previousHtml: html, redesign, browser });
  expect(result.verdict).toBe('REJECTED');
  expect(result.violations.map(v => v.code)).toContain('REDESIGN_UNUSED_INVARIANT');
  expect((await checkDesignPreservation({ html, previousHtml: null, redesign: { ...redesign, from: designHash('') }, browser })).verdict).toBe('REJECTED');
});

test('all four entry points require a per-invocation --first-build, and publisher custody stays in the test cell', async () => {
  const outputPath = path.join(cell.root, 'repo/docs.local/dashboards/first.html'), specPath = path.join(cell.root, 'job.json'), jobDir = path.join(cell.root, 'job');
  const segment = path.join(jobDir, 'segments/sample'); mkdirSync(segment, { recursive: true });
  copyFileSync(new URL('./fixtures/design-preservation/hardening-tone.wav', import.meta.url), path.join(segment, 'sample.wav'));
  copyFileSync(new URL('../vendor/agent-html/templates/v4-story-mode/_placeholder.mp3', import.meta.url), path.join(segment, 'sample.mp3'));
  for (const file of ['words.json', 'words.raw.json']) writeFileSync(path.join(segment, file), JSON.stringify([{ word: 'alpha', start: 0.05, end: 0.42 }, { word: 'beta', start: 0.45, end: 0.8 }]));
  writeFileSync(specPath, JSON.stringify({ id: 'first', series: 'first-cli', outputPath, designPreservation: { baseline: { reason: 'Carried from an old spec.' } }, scenes: [{ id: 'sample', audioWav: 'fixture.wav', role: 'host', script: 'alpha beta' }] }));
  const run = async (script, flags = []) => {
    const child = Bun.spawn(cell.command(new URL(`../scripts/${script}.mjs`, import.meta.url).pathname, ['--spec', specPath, ...flags]), { env: process.env, stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { code, text: stdout + stderr };
  };
  const first = ['--first-build', 'Initial publication.'];
  for (const [script, flags] of [['build-dashboard', ['--job-dir', jobDir]], ['render-done-gate-cli', []], ['validate-evidence', ['--job-dir', jobDir, '--published', 'sync-tailnet-dashboards.mjs']]]) {
    expect((await run(script, flags)).text).toContain('PREVIOUS_BUILD_MISSING');
    expect((await run(script, [...flags, ...first])).code).toBe(0);
  }
  const server = Bun.serve({ port: 0, fetch: () => new Response(readFileSync(outputPath), { headers: { 'content-type': 'text/html' } }) });
  try {
    expect((await run('verify-tailnet-publish', ['--url', server.url.href])).text).toContain('PREVIOUS_BUILD_MISSING');
    expect((await run('verify-tailnet-publish', ['--url', server.url.href, ...first])).code).toBe(0);
    expect(loadPublishedDesign({ series: 'first-cli' }, outputPath, options).previousHtml).toBe(readFileSync(outputPath, 'utf8'));
  } finally { server.stop(true); }
}, 60000);
