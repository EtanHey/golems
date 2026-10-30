import { afterAll, beforeAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
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
  const result = await check('scrub', { redesign: { reason: 'Requested transport replacement.' } });
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
