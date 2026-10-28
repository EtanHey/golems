import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { renderDecisionFlow } from '../src/decision-flow.mjs';

// AD-15 in a real browser: Chromium fires load, not error, for failed frame navigations.
let chromium = null;
try {
  ({ chromium } = await import('playwright'));
  const probe = await chromium.launch();
  await probe.close();
} catch (error) {
  if (process.env.ADASH_LAYOUT_REQUIRED === "1") throw new Error(`decision-flow comparison browser tests require Playwright/Chromium (ADASH_LAYOUT_REQUIRED=1): ${error?.message}`, { cause: error });
  console.warn(`decision-flow comparison browser tests skipped: ${error?.message?.split('\n')[0]}`);
  chromium = null;
}
const browserTest = chromium ? test : test.skip;

const output = process.env.ADX2_OUTPUT ? path.resolve(process.env.ADX2_OUTPUT) : null;
if (output) mkdirSync(output, { recursive: true });
const capture = (page, name) => output ? page.screenshot({ path: path.join(output, name) }) : Promise.resolve();

const words = ['Two', 'voices', 'side', 'by', 'side'].map((word, i) => ({ word, start: i * 0.4, end: i * 0.4 + 0.3 }));
const sceneFor = id => ({ id, title: 'Narration', script: words.map(w => w.word).join(' '), words, duration: 2, audioUrl: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=' });
const card = (id, title, url, extra = {}) => ({ id, title, rank: 1, sceneIds: [id], options: ['Keep', 'Change'], body: 'Listen to both takes, then pick one.', comparison: { url }, ...extra });
const ADX2_SPEC = {
  storageKey: 'adx2-synthetic', heading: 'Voice comparison',
  scenes: ['ok', 'missing', 'down', 'slow'].map(sceneFor),
  decisions: [
    card('ok', 'Keep the warmer voice?', 'visuals/ok.html', { rail: [{ label: 'Owner', value: 'Operator' }] }),
    card('missing', 'Missing page', 'visuals/missing.html'),
    card('down', 'Network down', 'visuals/down.html'),
    card('slow', 'Stalled server', 'visuals/slow.html', { comparison: { url: 'visuals/slow.html', timeoutMs: 1500 } }),
  ],
};
const html = renderDecisionFlow(ADX2_SPEC);
if (output) writeFileSync(path.join(output, 'dashboard.html'), html);
const visual = '<!doctype html><body style="margin:0;font:16px system-ui;background:#fff"><figure style="margin:24px"><figcaption>Voice A vs Voice B, listener preference</figcaption><svg width="320" height="120" role="img" aria-label="A 64 percent, B 36 percent"><rect x="0" y="20" width="205" height="32" fill="#2a7a6e"/><rect x="0" y="68" width="115" height="32" fill="#c98a12"/><text x="214" y="42">A 64%</text><text x="124" y="90">B 36%</text></svg></figure></body>';

for (const width of [1280, 390]) browserTest(`comparison settles in Chromium at ${width}px`, async () => {
  const browser = await chromium.launch({ args: ['--mute-audio'] });
  try {
    const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
    let releaseOk, releaseSlow = null;
    const okGate = new Promise(resolve => { releaseOk = resolve; });
    await page.route('https://adx2.test/', route => route.fulfill({ contentType: 'text/html', body: html }));
    await page.route('https://adx2.test/visuals/ok.html', async route => { await okGate; await route.fulfill({ contentType: 'text/html', body: visual }); });
    await page.route('https://adx2.test/visuals/missing.html', route => route.fulfill({ status: 404, contentType: 'text/html', body: '<h1>404</h1>' }));
    await page.route('https://adx2.test/visuals/down.html', route => route.abort('failed'));
    await page.route('https://adx2.test/visuals/slow.html', route => { if (releaseSlow) route.fulfill({ contentType: 'text/html', body: visual }); else releaseSlow = route; });
    await page.goto('https://adx2.test/');
    const state = () => page.locator('#df-compare').getAttribute('data-state');
    const opener = id => page.locator(`#decision-${id} .df-compare-open`);

    await page.evaluate(() => window.scrollTo(0, document.getElementById('decision-ok').getBoundingClientRect().top + scrollY - document.querySelector('.df-controller').getBoundingClientRect().bottom - 12));
    await capture(page, `${width}-card.png`);

    // Loading -> loaded, with focus on Back and the spinner still under reduced motion.
    await opener('ok').click();
    expect(await state()).toBe('loading');
    expect(await page.locator('#df-compare-message').textContent()).toBe('Loading comparison…');
    expect(await page.evaluate(() => document.activeElement.id)).toBe('df-compare-back');
    expect(await page.locator('.df-compare-spinner').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
    await capture(page, `${width}-loading.png`);
    releaseOk();
    await page.waitForFunction(() => document.getElementById('df-compare').dataset.state === 'loaded');
    expect(await page.frameLocator('#df-compare iframe').locator('figure').isVisible()).toBe(true);
    await capture(page, `${width}-loaded.png`);
    await page.keyboard.press('Escape');
    expect(await page.locator('#df-compare').evaluate(el => el.open)).toBe(false);
    expect(await page.evaluate(() => document.activeElement.closest('.df-card')?.id)).toBe('decision-ok');

    // HTTP 404 and a network failure both fire load in Chromium; both must read as failures.
    for (const id of ['missing', 'down']) {
      await opener(id).click();
      await page.waitForFunction(() => document.getElementById('df-compare').dataset.state === 'failed');
      expect(await page.locator('#df-compare-message').textContent()).toContain("couldn't load");
      expect(await page.evaluate(() => document.activeElement.id)).toBe('df-compare-retry');
      if (id === 'down') await capture(page, `${width}-error.png`);
      await page.locator('#df-compare-close').click();
      expect(await page.evaluate(id => document.activeElement === document.querySelector(`#decision-${id} .df-compare-open`), id)).toBe(true);
    }

    // A stalled server times out, then Retry (keyboard) re-attempts and loads.
    await opener('slow').click();
    expect(await state()).toBe('loading');
    await capture(page, `${width}-slow-loading.png`);
    await page.waitForFunction(() => document.getElementById('df-compare').dataset.state === 'failed', null, { timeout: 5000 });
    expect(await page.locator('#df-compare-message').textContent()).toContain('1.5 seconds');
    await capture(page, `${width}-timeout.png`);
    await releaseSlow.abort('timedout');
    releaseSlow = true;
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('df-compare').dataset.state === 'loaded');
    await capture(page, `${width}-retry-loaded.png`);
    await page.locator('#df-compare-back').click();
    expect(await page.locator('#df-compare iframe').count()).toBe(0);
  } finally {
    await browser.close();
  }
}, 30000);
