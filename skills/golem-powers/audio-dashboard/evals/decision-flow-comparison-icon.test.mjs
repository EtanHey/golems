import { expect, test } from 'bun:test';
import { renderDecisionFlow } from '../src/decision-flow.mjs';

// ADX-2a review r2: without responseStatus (WebKit), the visual handshake must not accept a decorative icon.
// Ported from the reviewer's reproducer: an HTTP 404 page whose only mark is an aria-hidden 16px svg icon.
let chromium = null, webkit = null;
try {
  ({ chromium, webkit } = await import('playwright'));
  await (await chromium.launch()).close();
} catch (error) {
  if (process.env.ADASH_LAYOUT_REQUIRED === "1") throw new Error(`decision-flow comparison icon tests require Playwright/Chromium (ADASH_LAYOUT_REQUIRED=1): ${error?.message}`, { cause: error });
  chromium = null;
}
let webkitReady = false;
if (webkit) try { await (await webkit.launch()).close(); webkitReady = true; } catch { webkitReady = false; }

const html = renderDecisionFlow({
  scenes: [{ id: 'a', title: 'A', script: 'hello', words: [{ word: 'hello', start: 0, end: 0.5 }], duration: 1, audioUrl: 'data:audio/mpeg;base64,SUQz' }],
  decisions: [{ id: 'a', title: 'Compare', sceneIds: ['a'], comparison: { url: 'visuals/a.html', timeoutMs: 1000 } }],
});
const chart = '<figure><svg width="320" height="120" role="img" aria-label="A 64%, B 36%"><rect width="205" height="32" fill="#2a7a6e"/></svg></figure>';
const pages = {
  'reviewer icon 404': [404, '<svg width="16" height="16" aria-hidden="true" class="icon"><path d="M1 1L15 15M1 15L15 1" stroke="red"/></svg><h1>404: missing comparison</h1>', 'failed'],
  'large aria-hidden svg': [404, '<svg width="320" height="120" aria-hidden="true"><rect width="300" height="100"/></svg><h1>404</h1>', 'failed'],
  'presentational svg': [404, '<svg width="320" height="120" role="presentation"><rect width="300" height="100"/></svg>', 'failed'],
  'svg inside a button': [404, '<button><svg width="40" height="40"><circle r="10" cx="20" cy="20"/></svg> Retry</button>', 'failed'],
  'glyph class': [404, '<span class="nav-glyph"><svg width="64" height="64"><rect width="60" height="60"/></svg></span>', 'failed'],
  'small unnamed img': [404, '<img width="16" height="16" alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">', 'failed'],
  'labelled chart': [200, chart, 'loaded'],
  'unlabelled canvas chart': [200, '<canvas width="320" height="160"></canvas>', 'loaded'],
};

// "chromium-no-status" removes responseStatus in the parent, so CI's Chromium exercises the WebKit path too.
const engines = [['chromium-no-status', chromium], ['webkit', webkitReady ? webkit : null]];
for (const [engine, type] of engines) (type ? test : test.skip)(`without responseStatus (${engine}), only a chart counts as a loaded comparison`, async () => {
  const browser = await type.launch();
  try {
    for (const [name, [status, body, expected]] of Object.entries(pages)) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
      if (engine === 'chromium-no-status') await page.addInitScript(() => { delete PerformanceResourceTiming.prototype.responseStatus; });
      await page.route('https://adx2.test/dashboard/index.html', route => route.fulfill({ contentType: 'text/html', body: html }));
      await page.route('https://adx2.test/dashboard/visuals/a.html', route => route.fulfill({ status, contentType: 'text/html', body }));
      await page.goto('https://adx2.test/dashboard/index.html');
      expect(await page.evaluate(() => 'responseStatus' in PerformanceResourceTiming.prototype)).toBe(false);
      await page.locator('.df-compare-open').click();
      await page.waitForFunction(() => document.getElementById('df-compare').dataset.state !== 'loading');
      expect([name, await page.locator('#df-compare').getAttribute('data-state')]).toEqual([name, expected]);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}, 60000);

// With responseStatus (Chromium), the reviewer's icon 404 still fails on its status alone.
(chromium ? test : test.skip)('with responseStatus (chromium), the icon 404 fails on its status', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route('https://adx2.test/dashboard/index.html', route => route.fulfill({ contentType: 'text/html', body: html }));
    await page.route('https://adx2.test/dashboard/visuals/a.html', route => route.fulfill({ status: 404, contentType: 'text/html', body: pages['reviewer icon 404'][1] }));
    await page.goto('https://adx2.test/dashboard/index.html');
    await page.locator('.df-compare-open').click();
    await page.waitForFunction(() => document.getElementById('df-compare').dataset.state !== 'loading');
    expect(await page.locator('#df-compare').getAttribute('data-state')).toBe('failed');
  } finally {
    await browser.close();
  }
}, 30000);
