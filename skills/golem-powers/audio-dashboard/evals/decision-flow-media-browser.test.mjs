import { expect, test } from 'bun:test';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { renderDecisionFlow } from '../src/decision-flow.mjs';

// Native PCM playback and native ended events; only invocation timing/rejection is injected.
const wav = Buffer.alloc(44 + 160000);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(160000, 40);
const scenes = ['host', 'expert', 'other'].map(id => ({ id, title: id, script: 'Hello', words: [{ word: 'Hello', start: 0, end: 1 }], duration: 10, audioUrl: 'data:audio/wav;base64,' + wav.toString('base64') }));
const html = renderDecisionFlow({ storageKey: 'media-regression', heading: 'Media', scenes, decisions: [{ id: 'a', title: 'Audio', sceneIds: ['host', 'expert'], body: 'Listen', options: ['Keep'] }, { id: 'b', title: 'Other', sceneIds: ['other'], body: 'Listen', options: ['Keep'] }] });
for (const width of [390, 1280]) test(`sticky media transitions at ${width}px`, async () => {
  const browser = await chromium.launch({ args: ['--mute-audio'] });
  try {
    const output = process.env.ADASH_MEDIA_PROOF;
    if (output) mkdirSync(`${output}/${width}`, { recursive: true });
    const context = await browser.newContext({ viewport: { width, height: 844 }, ...(output ? { recordVideo: { dir: `${output}/${width}` } } : {}) });
    const page = await context.newPage();
    await page.setContent(html);
    page.setDefaultTimeout(5000);
    await page.locator("#df-view-toggle").click();
    await page.evaluate(() => {
      const native = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        return new Promise(resolve => setTimeout(resolve, 100)).then(() => {
          if (window.rejectNext) { window.rejectNext = false; throw new DOMException('Test rejection', 'NotAllowedError'); }
          return native.call(this);
        });
      };
    });
    const button = page.locator('#df-transport-play');
    const audio = id => `audio[data-audio-scene="${id}"]`;
    const shot = async name => { if (output) await page.screenshot({ path: `${output}/${width}/${name}.png` }); };
    async function state(icon, label) {
      await page.waitForFunction(({ icon, label }) => document.querySelector('.df-tplay-icon').textContent === icon && document.querySelector('#df-transport-play').getAttribute('aria-label') === label, { icon, label });
      expect(await button.locator('.df-tplay-icon').textContent()).toBe(icon);
      expect(await button.getAttribute('aria-label')).toBe(label);
    }
    async function playing(id) { await page.waitForFunction(selector => !document.querySelector(selector).paused, audio(id)); }
    async function finish(id) { await page.evaluate(selector => { const a = document.querySelector(selector); a.currentTime = a.duration - 0.05; }, audio(id)); }
    await state('▶', 'Play card: Audio'); await shot('before');
    // Sticky keyboard start, pause, resume; all assertions follow native media state.
    await button.focus(); await page.keyboard.press('Enter'); await playing('host');
    await state('⏸', 'Pause card: Audio'); await shot('playing');
    await button.click(); expect(await page.locator(audio('host')).evaluate(a => a.paused)).toBe(true);
    await state('▶', 'Resume card: Audio'); await shot('paused');
    await button.click(); await playing('host'); await state('⏸', 'Pause card: Audio'); await shot('resumed');
    await finish('host'); await playing('expert'); await state('⏸', 'Pause card: Audio');
    await finish('expert'); await state('↻', 'Again card: Audio');
    // Completed section retains its existing replay action (not a pause icon).
    await page.locator('#decision-a .df-play').evaluate(b => b.click()); await playing('host'); await state('⏸', 'Pause card: Audio');
    await page.locator('#df-transport-next').evaluate(b => b.click()); await playing('other'); await state('⏸', 'Pause card: Other');
    // Late noncurrent native events must render the current card, never the event's card.
    await page.evaluate(async selector => { const a = document.querySelector(selector); await a.play(); a.pause(); }, audio('expert'));
    await state('⏸', 'Pause card: Other');
    await button.click(); await state('▶', 'Resume card: Other');
    await page.evaluate(() => { window.rejectNext = true; });
    await button.click(); await page.waitForFunction(() => document.querySelector('#decision-b .df-player-state').textContent.includes('allow audio'));
    await state('▶', 'Resume card: Other');
    expect(await page.locator(audio('other')).evaluate(a => a.paused)).toBe(true);
    await page.locator('#decision-b .df-play').evaluate(b => b.click()); await playing('other'); await state('⏸', 'Pause card: Other');
    await page.evaluate(selector => document.querySelector(selector).pause(), audio('other'));
    await state('▶', 'Play card: Other');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await context.close();
  } finally { await browser.close(); }
}, 45000);
