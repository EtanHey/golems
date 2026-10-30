import { afterAll, beforeAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { checkDesignPreservation } from '../src/design-preservation.mjs';

let browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });
const fixture = name => readFileSync(new URL(`./fixtures/design-preservation/behavior/${name}.html`, import.meta.url), 'utf8');
const check = (name, extra = {}) => checkDesignPreservation({ browser, html: fixture(name), previousHtml: fixture('previous'), ...extra });
for (const [file, code] of [['stray_focus', 'STRAY_FOCUS'], ['scrub', 'SCRUB'], ['reset_controls', 'RESET_CONTROLS'], ['overall_reset', 'RESET_CONTROLS']]) {
  test(`drop-one behavior fails by name: ${file}`, async () => {
    const result = await check(file);
    expect(result.verdict).toBe('REJECTED');
    expect([...new Set(result.violations.map(v => v.code))]).toEqual([code]);
  });
}
test('preserved behavior passes with decoded media and measured seek evidence', async () => {
  const result = await check('preserved');
  expect(result.verdict).toBe('PASS');
  expect(result.behavior.every(row => row.previous.scrub && row.new.scrub && row.new.seek.after > row.new.seek.before)).toBe(true);
});
test('explicit redesign waives behavior regressions but keeps their evidence', async () => {
  const result = await check('scrub', { redesign: { reason: 'Requested transport replacement.', invariants: ['SCRUB'], from: createHash('sha256').update(fixture('previous')).digest('hex') } });
  expect(result.verdict).toBe('PASS');
  expect(result.violations[0].code).toBe('SCRUB');
});

test('native scrubber and interactive focus-visible outlines remain valid', async () => {
  const html = fixture('previous').replace('<span data-word-start="1.5" role="button" tabindex="0">Welcome</span>', '<input type="range" data-scrub min="0" max="3" step="0.1" aria-label="Seek">Welcome')
    .replace("document.querySelector('[data-word-start]').onclick=function(){audio.currentTime=Number(this.dataset.wordStart)};", "document.querySelector('[data-scrub]').oninput=function(){audio.currentTime=Number(this.value)};");
  const result = await checkDesignPreservation({ browser, html, previousHtml: fixture('previous') });
  expect(result.verdict).toBe('PASS');
  expect(result.behavior.every(row => row.new.scrub && row.new.seek.decoded)).toBe(true);
  const focusHtml = fixture('previous').replace('</style>', 'button:focus-visible{outline:2px solid yellow}</style>').replace('<button data-reset-all>', '<button data-reset-all autofocus>');
  expect((await checkDesignPreservation({ browser, html: focusHtml, previousHtml: fixture('previous') })).verdict).toBe('PASS');
});

test('answer export does not mask a newly introduced prose copy button', async () => {
  const previousHtml = fixture('previous').replace('</main>', '<button id="dbx-copy">Copy answers</button></main>');
  const html = previousHtml.replace('Project status</div>', 'Project status<button>Copy paragraph</button></div>');
  const result = await checkDesignPreservation({ browser, html, previousHtml });
  expect(result.violations.some(v => v.code === 'COPY_BUTTONS')).toBe(true);
});

test('real pointer scrubber may seek a different audio in a cumulative timeline', async () => {
  let html = fixture('previous');
  const audio = html.match(/<audio\b[^>]*>[\s\S]*?<\/audio>/)[0];
  html = html.replace(audio, audio + audio.replace('id="audio"', 'id="second-audio"'))
    .replace('<span data-word-start="1.5" role="button" tabindex="0">Welcome</span>', '<input id="scrubber" type="range" min="0" max="3" step="0.01" aria-label="Seek">Welcome')
    .replace("document.querySelector('[data-word-start]').onclick=function(){audio.currentTime=Number(this.dataset.wordStart)};", "document.getElementById('scrubber').onclick=()=>document.getElementById('second-audio').currentTime=1.5;");
  const result = await checkDesignPreservation({ browser, html, previousHtml: fixture('previous') });
  expect(result.verdict).toBe('PASS');
  expect(result.behavior.every(row => row.new.seek.audioIndex === 1 && row.new.scrub)).toBe(true);
});
test('pointer click reveals stray focus on a non-interactive time label', async () => {
  const html = fixture('previous').replace('</style>', 'time:focus{outline:2px solid yellow}</style>').replace('<h1>', '<time tabindex="-1" onpointerdown="this.focus()">0:00</time><h1>');
  const result = await checkDesignPreservation({ browser, html, previousHtml: fixture('previous') });
  expect(result.violations.some(v => v.code === 'STRAY_FOCUS')).toBe(true);
});
test('real reset accessible name is preserved without custom data attributes', async () => {
  const html = fixture('previous').replace('<button data-reset-all>', '<button>');
  expect((await checkDesignPreservation({ browser, html, previousHtml: fixture('previous') })).verdict).toBe('PASS');
});
test('removing an answered question preserves the share with clear controls', async () => {
  const { compareDesignBehavior } = await import('../src/design-behavior.mjs');
  expect(compareDesignBehavior({ focusClean: true, scrub: true, reset: true, questions: [{ key: 'old-a', clear: true }, { key: 'old-b', clear: true }] }, { focusClean: true, scrub: true, reset: true, questions: [{ key: 'new-question', clear: true }] })).toEqual([]);
});
