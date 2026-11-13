import { test, expect } from 'bun:test';
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import { renderDecisionFlow } from '../src/decision-flow.mjs';
import { card, spec } from './fixtures/card-visuals.mjs';
const render = extra => renderDecisionFlow({ ...spec, decisions: [{ ...card, ...extra }] });
test('real table, escaped cells, closed status pills and new-tab rail', () => {
  const w = new Window(); try {
    w.document.write(render()); const d = w.document;
    expect(d.querySelector('table caption')?.textContent).toBe('Checks <now>');
    expect(d.querySelector('td')?.textContent).toBe('<script>bad</script>');
    expect(d.querySelector('td script')).toBeNull();
    expect(d.querySelector('td .df-v-ready')?.textContent).toBe('pass');
    expect(d.querySelector('.df-rail-link')?.target).toBe('_blank');
    expect(d.querySelector('.df-rail-link')?.rel).toBe('noopener noreferrer');
  } finally { w.close(); }
});
test('bar and line SVG carry exact accessible data and negative values', () => {
  for (const type of ['bar', 'line']) {
    const html = render({ charts: [{ ...card.charts[0], type, series: [{ name: 'Delta', values: [{ label: 'Low', value: -2 }, { label: 'High', value: 8 }] }] }] });
    expect(html).toContain('class="df-chart"'); expect(html).toContain('role="img"');
    expect(html).toContain('Low: -2 jobs'); expect(html).toContain('High: 8 jobs');
    expect(html).not.toMatch(/(?:NaN|Infinity)/);
  }
});
test('Details totals derive from final clips and unique Section rail values', () => {
  expect(render()).toContain('Total audio 1 min 5 s · 1 sections · 1 cards.');
});
for (const extra of [
  { tables: [{ ...card.tables[0], surprise: true }] }, { tables: [{ ...card.tables[0], rows: [[{ status: 'evil' }]] }] },
  { tables: [{ ...card.tables[0], rows: [['short']] }] }, { tables: [{ ...card.tables[0], align: ['unsafe'] }] },
  { charts: [{ ...card.charts[0], type: 'pie' }] }, { charts: [{ ...card.charts[0], script: 'unsafe' }] },
  { charts: [{ ...card.charts[0], series: [{ name: 'bad', values: [{ label: 'x', value: Infinity }] }] }] },
  { rail: [{ label: 'Link', value: 'x', href: 'javascript:alert(1)', newTab: true }] },
  { rail: [{ label: 'Link', href: 'https://example.com', newTab: 'true' }] },
]) test('unsafe or unknown visual data refuses ' + JSON.stringify(extra), () => expect(() => render(extra)).toThrow());
test('golden full HTML fixture', () => expect(render()).toBe(readFileSync(new URL('./fixtures/card-visuals.html', import.meta.url), 'utf8')));

test('payload accounting bounds UTF-8 bytes, validates nested keys, and caps the prepare payload', async () => {
  const { cardVisualBytes } = await import('../src/card-visuals.mjs');
  const expected = ['tables', 'charts'].reduce((n, k) => n + Buffer.byteLength(JSON.stringify(card[k])), 0) + Buffer.byteLength(JSON.stringify(card.rail[0]));
  expect(cardVisualBytes([card])).toBe(expected);
  expect(() => cardVisualBytes(Array(1000).fill(card))).toThrow(/256 KiB/);
  for (const c of [
    { tables: [{ ...card.tables[0], rows: [[{ status: 'pass', html: 'x' }, 'x', 1]] }] },
    { charts: [{ ...card.charts[0], series: [{ name: 'x', values: [{ label: 'x', value: 0, href: 'unsafe' }] }] }] },
    { charts: [{ ...card.charts[0], series: [{ name: 'x', values: [{ label: 'x', value: 0 }, { label: 'x', value: 1 }] }] }] },
  ]) expect(() => cardVisualBytes([c])).toThrow();
});
test('zero, single point and dense series retain finite geometry and readable plot width', () => {
  for (const type of ['bar', 'line']) for (const count of [1,30]) {
    const html = render({ charts: [{ ...card.charts[0], type, series: [{name:'Zero',values:Array.from({length:count},(_,i)=>({label:'Point '+i,value:0}))}] }] });
    expect(html).not.toMatch(/(?:NaN|Infinity)/);
    if(count===30) expect(html).toContain('min-width:2480px');
  }
});

test('real Chromium keeps overflow local and opens the rail in another tab', async () => {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({viewport:{width:390,height:1000}});
    await page.route('https://example.com/**', route => route.fulfill({body:'Synthetic linked page'}));
    for (const colorScheme of ['light','dark']) {
      await page.emulateMedia({colorScheme}); await page.setContent(render());
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
      const table = page.locator('.df-table-scroll'); await table.focus();
      expect(await table.evaluate(el => el === document.activeElement)).toBe(true);
      const chart = page.locator('.df-chart-scroll');
      expect(await chart.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
      await chart.evaluate(el => el.scrollLeft = el.scrollWidth);
      expect(await chart.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
      const [popup] = await Promise.all([page.waitForEvent('popup'),page.locator('.df-rail-link').click()]);
      expect(page.isClosed()).toBe(false); expect(await popup.evaluate(() => window.opener)).toBeNull(); await popup.close();
      await page.locator('#df-view-toggle').click(); await page.locator('.df-answer-open').click();
      expect(await table.isVisible()).toBe(true); expect(await chart.isVisible()).toBe(true);
      await page.keyboard.press('Escape'); expect(await table.isVisible()).toBe(false);
      await page.locator('.df-story-exit').click();
    }
  } finally { await browser.close(); }
}, 20000);

test('hosted prepare records actual visual and HTML bytes and refuses excess before copying', async () => {
  const fs = await import('node:fs'), path = await import('node:path');
  const { prepareHostedInput } = await import('../src/prepare-hosted.mjs');
  const { cardVisualBytes } = await import('../src/card-visuals.mjs');
  fs.mkdirSync('docs.local/w87-test', {recursive:true});
  const root = fs.mkdtempSync(path.resolve('docs.local/w87-test/prepare-'));
  try {
    const segmentsDir=path.join(root,'segments'), dir=path.join(segmentsDir,'s1'), outputPath=path.join(root,'test.html');
    fs.mkdirSync(dir,{recursive:true});
    const mp3=fs.readFileSync(new URL('../vendor/agent-html/templates/v4-story-mode/_placeholder.mp3',import.meta.url));
    fs.writeFileSync(path.join(dir,'s1.mp3'),mp3);
    for(const file of ['words.json','words.raw.json']) fs.writeFileSync(path.join(dir,file),'[]');
    for(const suffix of ['receipts.json','design.json']) fs.writeFileSync(path.join(root,'test.'+suffix),'{}');
    const shell='<audio src="data:audio/mpeg;base64,'+mp3.toString('base64')+'"></audio>';
    const result=prepareHostedInput({spec,html:shell,segmentsDir,outputPath});
    const manifest=JSON.parse(fs.readFileSync(path.join(root,result.sourcePath,'asset-manifest.json')));
    expect(manifest.visualPayloadBytes).toBe(cardVisualBytes([card]));
    expect(manifest.htmlBytes).toBe(fs.statSync(path.join(root,result.sourcePath,'index.html')).size);
    expect(() => prepareHostedInput({spec:{...spec,decisions:Array(1000).fill(card)},html:shell,segmentsDir,outputPath})).toThrow(/256 KiB/);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('visual cells preserve the existing command and issue-reference gates', async () => {
  const { analyzeCopyBlocks } = await import('../src/copy-blocks.mjs');
  const { findBareReferences } = await import('../src/decision-flow.mjs');
  const tables=[{caption:'Evidence',columns:['Action','State'],rows:[['git status','pending']]}];
  expect(analyzeCopyBlocks(render({tables})).verdict).toBe('REJECTED');
  expect(findBareReferences([{...card,tables:[{caption:'Issue #39',columns:['State'],rows:[['open']]}]}])).toHaveLength(1);
});
