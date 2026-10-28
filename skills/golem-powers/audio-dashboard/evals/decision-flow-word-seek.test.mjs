import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { renderDecisionFlow } from '../src/decision-flow.mjs';

const output = path.resolve(process.env.AD2_OUTPUT || 'docs.local/ad2');
mkdirSync(output, { recursive: true });
// Real, seekable synthetic PCM audio: no network or private dashboard content.
const wav = Buffer.alloc(44 + 8000 * 2 * 30);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
const words = Array.from({ length: 240 }, (_, i) => ({ word: `word${i}`, start: i * 0.1, end: i * 0.1 + 0.08 }));
const html = renderDecisionFlow({ storageKey: 'ad2-synthetic', heading: 'Word seek regression',
  scenes: [{ id: 'scene', title: 'Synthetic transcript', script: words.map(w => w.word).join(' '), words, duration: 30, audioUrl: `data:audio/wav;base64,${wav.toString('base64')}` }],
  decisions: [{ id: 'seek', title: 'Inspect word seek', rank: 1, sceneIds: ['scene'], body: 'Synthetic citation text for selection.', options: ['Continue', 'Pause'] }] });
const file = path.join(output, 'dashboard.html'); writeFileSync(file, html);

for (const width of [1280, 390]) test(`real pointer word seek and keyboard visibility at ${width}px`, async () => {
  const browser = await chromium.launch({ args: ['--mute-audio'] });
  try {
    const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
    await page.goto(`file://${file}`);
    await page.evaluate(() => { const label = document.createElement('output'); label.id = 'proof-time'; label.style.cssText = 'position:fixed;right:8px;top:8px;z-index:9999;background:#fff;color:#000;padding:8px'; document.body.append(label); const audio = document.querySelector('audio'); const update = () => label.textContent = 'Audio: ' + audio.currentTime.toFixed(2) + 's'; audio.addEventListener('timeupdate', update); audio.addEventListener('seeked', update); update(); });
    await page.evaluate(async () => { const audio = document.querySelector('audio'); audio.load(); await new Promise(resolve => { if (audio.readyState >= 2) resolve(); else audio.addEventListener('loadeddata', resolve, { once: true }); }); });
    await page.locator('.df-play').click();
    await page.evaluate(() => document.querySelector('audio').pause());
    // The paragraph begins behind the sticky bar; the late word remains exposed.
    await page.evaluate(() => { const p = document.querySelector('.df-words'); p.style.lineHeight = '40px'; window.scrollTo(0, p.getBoundingClientRect().top + scrollY - 30); window.events = []; ['pointerdown', 'mouseup', 'click'].forEach(type => document.addEventListener(type, e => window.events.push({ type, word: e.target.dataset.wordStart || null }))); });
    const target = page.locator('.df-word').nth(width === 390 ? 36 : 90);
    await target.evaluate(el => { const scroller = el.closest('.df-teleprompter'); scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 180; });
    const box = await target.boundingBox();
    expect(box.y).toBeGreaterThan(await page.locator('.df-controller').evaluate(el => el.getBoundingClientRect().bottom));
    await page.screenshot({ path: path.join(output, `${width}-before-click.png`) });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.screenshot({ path: path.join(output, `${width}-down.png`) });
    await page.mouse.up();
    await page.evaluate(() => document.querySelector('audio').pause());
    const result = await page.evaluate(() => ({ events: window.events, time: document.querySelector('audio').currentTime }));
    console.info(width, JSON.stringify(result));
    await page.screenshot({ path: path.join(output, `${width}-after-click.png`) });
    const start = Number(await target.getAttribute('data-word-start'));
    expect(result.events.map(e => e.word)).toEqual([String(start), String(start), String(start)]);
    expect(Math.abs(result.time - start)).toBeLessThan(0.1);
    await page.locator('.df-words').focus();
    await page.screenshot({ path: path.join(output, `${width}-keyboard-start.png`) });
    await page.keyboard.press('End');
    await page.screenshot({ path: path.join(output, `${width}-keyboard.png`) });
    const visible = await page.locator('.is-seek-target').evaluate(el => { const b = el.getBoundingClientRect(), dock = document.querySelector('.df-dock'), bar = document.querySelector('.df-controller'); return { top: b.top, bottom: b.bottom, bar: bar.getBoundingClientRect().bottom, limit: getComputedStyle(dock).position === 'fixed' ? dock.getBoundingClientRect().top : innerHeight }; });
    expect(visible.top).toBeGreaterThanOrEqual(visible.bar);
    expect(visible.bottom).toBeLessThanOrEqual(visible.limit + 1);
    const selected = await page.locator('.df-words').evaluate(el => { const range = document.createRange(); range.setStart(el.lastElementChild.previousElementSibling.firstChild, 0); range.setEnd(el.lastElementChild.firstChild, el.lastElementChild.textContent.length); getSelection().removeAllRanges(); getSelection().addRange(range); return getSelection().toString().trim(); });
    await page.locator('#df-cite').click();
    expect(await page.locator('#df-note-quote').textContent()).toBe(selected);
    expect(await page.locator('#df-note-text').evaluate(el => el === document.activeElement)).toBe(true);
    await page.locator('#df-note-cancel').click();
    expect(await page.locator('#df-note-dialog').evaluate(el => el.open)).toBe(false);
  } finally { await browser.close(); }
}, 30000);
