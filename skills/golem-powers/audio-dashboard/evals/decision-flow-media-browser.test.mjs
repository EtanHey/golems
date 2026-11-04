import { expect, test } from 'bun:test';
import { chromium } from 'playwright';
import { renderDecisionFlow } from '../src/decision-flow.mjs';

test('sticky transport follows delayed real media play and pause events', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // A real ten-second PCM WAV; no mocked paused property or synthetic media events.
    const wav = Buffer.alloc(44 + 160000);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(160000, 40);
    const html = renderDecisionFlow({ storageKey: 'media-regression', heading: 'Media', scenes: [{ id: 'a', title: 'Audio', script: 'Hello', words: [{ word: 'Hello', start: 0, end: 1 }], duration: 10, audioUrl: 'data:audio/wav;base64,' + wav.toString('base64') }], decisions: [{ id: 'a', title: 'Audio', sceneIds: ['a'], body: 'Listen', options: ['Keep'] }] });
    await page.setContent(html);
    const button = page.locator('#df-transport-play');
    expect(await button.getAttribute('aria-label')).toBe('Play card: Audio');
    // Delay invoking native play, as an asynchronous playback backend does.
    await page.evaluate(() => { const native = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { return new Promise(resolve => setTimeout(resolve, 100)).then(() => native.call(this)); }; });
    await button.click();
    await page.waitForFunction(() => !document.querySelector('audio').paused);
    await page.waitForTimeout(100);
    expect(await button.locator('.df-tplay-icon').textContent()).toBe('⏸');
    expect(await button.getAttribute('aria-label')).toBe('Pause card: Audio');
    await page.evaluate(() => document.querySelector('audio').pause());
    await page.waitForTimeout(100);
    expect(await button.locator('.df-tplay-icon').textContent()).toBe('▶');
    expect(await button.getAttribute('aria-label')).toMatch(/^(Play|Resume) card: Audio$/);
  } finally { await browser.close(); }
});
