import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { renderDecisionFlow } from '../src/decision-flow.mjs';
import { validateAudioDashboardEvidence } from '../src/audio-dashboard-evidence.mjs';
import { persistedAnswerKeys } from '../src/prepare-hosted.mjs';
import { sourcesSpec, sourcesCard, promptText } from './fixtures/sources-drawer.mjs';

const render = extra => renderDecisionFlow({ ...sourcesSpec, decisions: [{ ...sourcesCard, ...extra }] });
const parse = html => { const w = new Window(); w.document.write(html); return w; };
const detailsRejected = html => validateAudioDashboardEvidence({ html, stage: 'pre-publish' }).violations.some(v => v.code === 'TEXT_ONLY_VIEW_DETAILS');

test('optional closed Sources disclosure has safe new-tab links and an exact, escaped prompt payload', () => {
  const w = parse(render());
  try {
    const d = w.document, drawer = d.querySelector('details.df-sources');
    expect(drawer).not.toBeNull(); expect(drawer.hasAttribute('open')).toBe(false);
    expect(drawer.querySelector('summary').textContent).toBe('Sources');
    const links = [...drawer.querySelectorAll('a')]; expect(links.length).toBe(2);
    expect(links.map(a => a.getAttribute('href'))).toEqual(sourcesCard.sources.map(s => s.url));
    for (const a of links) { expect(a.target).toBe('_blank'); expect(a.rel).toBe('noopener noreferrer'); }
    expect(JSON.parse(drawer.querySelector('[data-copy-prompt]').dataset.copyPrompt)).toBe(promptText);
    expect(drawer.querySelector('.df-source-note').textContent).toBe(sourcesCard.copyPrompt.notes);
    expect(d.querySelector('.df-teleprompter').textContent).not.toContain('Compare');
    expect(JSON.parse(d.getElementById('tpdata').textContent).s1.cues[0].text).toBe(sourcesSpec.scenes[0].script);
    expect(persistedAnswerKeys(render())).toEqual(persistedAnswerKeys(render({ sources: undefined, copyPrompt: undefined })));
    expect(detailsRejected(render())).toBe(false);
  } finally { w.close(); }
});
test('sources only, prompt only, and neither render the correct optional drawer', () => {
  for (const [extra, count] of [[{ copyPrompt: undefined }, 1], [{ sources: [] }, 1], [{ sources: [], copyPrompt: undefined }, 0]]) {
    const w = parse(render(extra)); try { expect(w.document.querySelectorAll('.df-sources').length).toBe(count); expect(detailsRejected(render(extra))).toBe(false); } finally { w.close(); }
  }
});
for (const url of ['javascript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,x', 'http://example.com', '//evil.test', '\\evil.test', 'https://', '../outside.html', '%2e%2e/out.html']) {
  test(`sources refuse unsafe URL ${JSON.stringify(url)}`, () => expect(() => render({ sources: [{ label: 'Source', url }] })).toThrow(/sources/));
}
for (const extra of [{ sources: null }, { sources: {} }, { sources: [{ label: '', url: './ok.html' }] }, { sources: Array(13).fill(sourcesCard.sources[0]) },
  { sources: [{ label: 'x'.repeat(161), url: './ok.html' }] }, { copyPrompt: { text: 'x' } }, { copyPrompt: { label: 'Copy', text: '' } },
  { copyPrompt: { label: 'Copy', text: 'x', notes: 'x'.repeat(281) } }]) {
  test(`invalid sources/prompt shape rejects ${JSON.stringify(extra).slice(0, 70)}`, () => expect(() => render(extra)).toThrow());
}
test('the evidence exemption cannot hide repeated prose, nested details or hostile links', () => {
  const html = render();
  for (const injected of ['<p>Repeated briefing prose</p>', '<details><summary>More</summary>Prose</details>']) {
    expect(detailsRejected(html.replace('<div class="df-sources-body">', '<div class="df-sources-body">' + injected))).toBe(true);
  }
  expect(detailsRejected(html.replace('https://example.com/research?a=1&amp;b=2', 'javascript:alert(1)'))).toBe(true);
  expect(detailsRejected(html.replace('https://example.com/research?a=1&amp;b=2', '&#106;avascript:alert(1)'))).toBe(true);
  expect(detailsRejected('<article class="df-card"><details><summary>Sources</summary><p>Prose</p></details></article>')).toBe(true);
});
test('maximum-length escaped labels and notes remain evidence-valid', () => {
  expect(detailsRejected(render({ sources: [{ label: '&'.repeat(160), url: './ok.html' }],
    copyPrompt: { label: '&'.repeat(80), text: 'Exact & < > " text', notes: '&'.repeat(280) } }))).toBe(false);
});

let chromium;
try { ({ chromium } = await import('playwright')); await (await chromium.launch()).close(); }
catch (error) { if (process.env.ADASH_LAYOUT_REQUIRED === '1') throw error; console.warn('Sources browser tests skipped: ' + error.message.split('\n')[0]); chromium = null; }
const browserTest = chromium ? test : test.skip;
for (const width of [1280, 390]) browserTest(`Sources keyboard, exact clipboard and truthful fallback at ${width}px, list and story`, async () => {
  const browser = await chromium.launch();
  try {
    for (const story of [false, true]) for (const mode of ['clipboard', 'denied', 'absent', 'failed']) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      try {
        await page.clock.install();
        await page.addInitScript(mode => {
          window.copies = [];
          Object.defineProperty(navigator, 'clipboard', { value: mode === 'absent' ? undefined : { writeText: async text => {
            if (mode !== 'clipboard' || window.failCopy) throw Error('denied'); window.copies.push(text);
          } } });
          document.execCommand = () => { if (mode === 'failed' || window.failCopy) return false; window.copies.push(document.getSelection().toString()); return true; };
        }, mode);
        await page.goto('data:text/html,' + encodeURIComponent(render()));
        if (story) { await page.locator('#df-view-toggle').click(); await page.locator('.df-answer-open').click(); }
        const summary = page.locator('.df-sources > summary'), button = page.locator('[data-copy-prompt]');
        await summary.focus(); await page.keyboard.press('Enter');
        expect(await page.locator('.df-sources').evaluate(el => el.open)).toBe(true);
        await button.focus(); await page.keyboard.press('Space');
        if (mode === 'failed') {
          expect(await page.locator('.df-prompt-status').textContent()).toContain('Select');
          expect(await page.locator('.df-prompt-manual').isVisible()).toBe(true);
          expect(await page.locator('.df-prompt-manual').textContent()).toBe(promptText);
          expect(await button.textContent()).not.toBe('Copied');
        } else {
          await page.waitForFunction(() => window.copies.length === 1);
          expect(await page.evaluate(() => window.copies)).toEqual([promptText]);
          expect(await button.textContent()).toBe('Copied');
          expect(await button.evaluate(el => el === document.activeElement)).toBe(true);
          if (mode === 'clipboard') {
            // A second denied click must not leave stale Copied feedback from the first.
            await page.evaluate(() => { window.failCopy = true; });
            await button.click();
            expect(await button.textContent()).toBe(sourcesCard.copyPrompt.label);
            expect(await page.locator('.df-prompt-status').textContent()).toContain('Select');
            await page.evaluate(() => { window.failCopy = false; });
            await button.click();
          }
          await page.clock.fastForward(1600);
          expect(await button.textContent()).toBe(sourcesCard.copyPrompt.label);
        }
        expect(await page.locator('#df-answered').textContent()).toBe('0');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await summary.focus(); await page.keyboard.press('Space');
        expect(await page.locator('.df-sources').evaluate(el => el.open)).toBe(false);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
}, 60000);
