import { expect, test } from 'bun:test';
import { COMPARISON_READY_META, hasComparisonReadyMarker, markComparisonReady, renderDecisionFlow } from '../src/decision-flow.mjs';
import { CANONICAL, REJECTED } from './fixtures/comparison-markers/specimens.mjs';

// ADX-2c review r1: without responseStatus (WebKit), success is an explicit ready marker on the comparison page,
// not a guess about which marks are charts. An error or 404 page never carries the marker.
let chromium = null, webkit = null;
try {
  ({ chromium, webkit } = await import('playwright'));
  await (await chromium.launch()).close();
} catch (error) {
  if (process.env.ADASH_LAYOUT_REQUIRED === "1") throw new Error(`decision-flow comparison ready tests require Playwright/Chromium (ADASH_LAYOUT_REQUIRED=1): ${error?.message}`, { cause: error });
  chromium = null;
}
let webkitReady = false;
if (webkit) try { await (await webkit.launch()).close(); webkitReady = true; } catch { webkitReady = false; }

const html = renderDecisionFlow({
  scenes: [{ id: 'a', title: 'A', script: 'hello', words: [{ word: 'hello', start: 0, end: 0.5 }], duration: 1, audioUrl: 'data:audio/mpeg;base64,SUQz' }],
  decisions: [{ id: 'a', title: 'Compare', sceneIds: ['a'], comparison: { url: 'visuals/a.html', timeoutMs: 1000 } }],
});
// Specimens from the ADX-2a r2 and ADX-2c r1 reviews.
const chart = '<svg width="320" height="120" role="img" aria-label="Revenue comparison"><rect width="205" height="32" fill="#2a7a6e"/><text x="0" y="70">A 64%, B 36%</text></svg>';
const icon = '<svg width="16" height="16" aria-hidden="true" class="icon"><path d="M1 1L15 15M1 15L15 1" stroke="red"/></svg>';
const pixel = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="25" height="25"%3E%3Cpath d="M1 1L24 24M1 24L24 1" stroke="red"/%3E%3C/svg%3E';
const pages = {
  'plain icon 404': [404, icon + '<h1>404: missing comparison</h1>', 'failed'],
  'figure-wrapped icon 404': [404, '<figure>' + icon + '<figcaption>404: missing comparison</figcaption></figure>', 'failed'],
  '25x25 decorative 404': [404, '<svg width="25" height="25"><path d="M1 1L24 24M1 24L24 1" stroke="red"/></svg><h1>404: missing comparison</h1>', 'failed'],
  'css-background figure 404': [404, '<figure style="width:25px;height:25px;background-image:url(' + pixel + ')"></figure><h1>404</h1>', 'failed'],
  'visibility:hidden svg 404': [404, '<svg style="visibility:hidden" width="320" height="120"><rect width="300" height="100"/></svg><h1>404</h1>', 'failed'],
  'markerless real chart': [200, '<figure>' + chart + '</figure>', 'failed'],
  'chart inside a link, marked': [200, COMPARISON_READY_META + '<a href="details.html"><figure>' + chart + '<figcaption>Revenue comparison, open details</figcaption></figure></a>', 'loaded'],
  'html attribute marker': [200, '<html data-adash-comparison="ready"><body><canvas width="320" height="160"></canvas></body></html>', 'loaded'],
  // ADX-2c review r2: a marker after body content lands in <body>, which the head-only check ignores.
  'meta in body after content 404': [404, '<h1>404</h1>' + COMPARISON_READY_META, 'failed'],
  // End-to-end producer case: the helper repairs a page whose only "marker" is commented out.
  'helper-marked page with a commented marker': [200, markComparisonReady('<!doctype html><html><head><!-- ' + COMPARISON_READY_META + ' --></head><body><a href="details.html"><figure>' + chart + '</figure></a></body></html>'), 'loaded'],
};

async function settle(browser, { status, body, noStatus }) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  if (noStatus) await page.addInitScript(() => { delete PerformanceResourceTiming.prototype.responseStatus; });
  await page.route('https://adx2.test/dashboard/index.html', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.route('https://adx2.test/dashboard/visuals/a.html', route => route.fulfill({ status, contentType: 'text/html', body }));
  await page.goto('https://adx2.test/dashboard/index.html');
  const reportsStatus = await page.evaluate(() => 'responseStatus' in PerformanceResourceTiming.prototype);
  await page.locator('.df-compare-open').click();
  await page.waitForFunction(() => document.getElementById('df-compare').dataset.state !== 'loading');
  const result = { reportsStatus, state: await page.locator('#df-compare').getAttribute('data-state'), message: await page.locator('#df-compare-message').textContent() };
  await page.close();
  return result;
}

// "chromium-no-status" deletes responseStatus in the parent, so CI's Chromium exercises the WebKit path too.
const engines = [['chromium-no-status', chromium, true], ['webkit', webkitReady ? webkit : null, false]];
for (const [engine, type, noStatus] of engines) (type ? test : test.skip)(`without responseStatus (${engine}), only a page marked ready loads`, async () => {
  const browser = await type.launch();
  try {
    for (const [name, [status, body, expected]] of Object.entries(pages)) {
      const result = await settle(browser, { status, body, noStatus });
      expect(result.reportsStatus).toBe(false);
      expect([name, result.state]).toEqual([name, expected]);
      if (name === 'markerless real chart') expect(result.message).toContain("isn't marked ready");
    }
  } finally {
    await browser.close();
  }
}, 60000);

// With responseStatus (Chromium), the status decides: a marked page that returns 404 is still an error.
(chromium ? test : test.skip)('with responseStatus (chromium), a marked 404 fails and a marked 200 loads', async () => {
  const browser = await chromium.launch();
  try {
    expect((await settle(browser, { status: 404, body: COMPARISON_READY_META + chart })).state).toBe('failed');
    expect((await settle(browser, { status: 200, body: COMPARISON_READY_META + chart })).state).toBe('loaded');
    expect((await settle(browser, { status: 404, body: pages['plain icon 404'][1] })).state).toBe('failed');
  } finally {
    await browser.close();
  }
}, 30000);

// ADX-2d review r1, parity: every page the build accepts (each canonical fixture, and the helper's output for
// every rejected one) must load in the runtime check, served as HTTP 200 with no responseStatus.
const accepted = [
  ...Object.entries(CANONICAL),
  ...Object.entries(REJECTED).map(([name, page]) => [`markComparisonReady(${name})`, markComparisonReady(page)]),
];
for (const [engine, type, noStatus] of engines) (type ? test : test.skip)(`build-accepted pages load in the runtime (${engine})`, async () => {
  const browser = await type.launch();
  try {
    for (const [name, body] of accepted) {
      expect([name, hasComparisonReadyMarker(body)]).toEqual([name, true]);
      expect([name, (await settle(browser, { status: 200, body, noStatus })).state]).toEqual([name, 'loaded']);
    }
  } finally {
    await browser.close();
  }
}, 180000);
