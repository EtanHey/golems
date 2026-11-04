import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium } from 'playwright';
import { renderDecisionFlow } from '../src/decision-flow.mjs';
import { injectDecisionSurfaceIntoHtml } from '../src/decision-surface.mjs';
import { renderV4 } from '../vendor/agent-html/lib/render-v4.mjs';

const scene = { id: 's1', title: 'A neutral question', script: 'Choose a path.', duration: 1,
  words: [{ word: 'Choose', start: 0, end: 0.3 }, { word: 'a', start: 0.3, end: 0.5 }, { word: 'path.', start: 0.5, end: 1 }] };
const decision = { id: 'choice', title: 'Choose a path', body: 'Keep the current plan or change it.', options: ['Keep', 'Change'], checklist: ['Read the proposal'], sceneIds: ['s1'] };
export function fixture(type, storageKey = 'dbx:account-proof') {
  const opts = { id: 'account-proof', dashboardId: 'account-proof', storageKey, answerSink: '/answers', title: 'A shared decision', scenes: [scene], decisions: [decision] };
  return type === 'decision-flow' ? renderDecisionFlow(opts)
    : injectDecisionSurfaceIntoHtml(renderV4(opts), [decision], opts).html;
}
let browser;
// The fixture card asks for a pick, so its free text is the optional note behind "Add a note" (2026-11-04 answer
// rule). These tests are about persisting that field, so each page opens the note before interacting.
const openNotes = () => document.addEventListener('DOMContentLoaded', () => document.querySelectorAll('.df-note-toggle').forEach(button => button.click()));
async function newPage() { const page = await browser.newPage(); await page.addInitScript(openNotes); return page; }
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); });
async function open(type, bridge = true) {
  const page = await newPage();
  page.setDefaultTimeout(2000);
  await page.addInitScript(useBridge => {
    window.saves = [];
    window.hold = false;
    window.releases = [];
    if (useBridge) window.__answerStore = {
      load: async () => ({ _prefs: { rate: 1.5, view: 'list' }, choice: 'Change', 'choice-free': 'Account answer', '_notes:s1': { text: 'Account scene note' } }),
      save: (field, value) => { window.saves.push([field, value]); return window.hold ? new Promise(resolve => window.releases.push(() => resolve({ ok: true }))) : Promise.resolve({ ok: true }); },
      onRemoteChange: cb => { window.remoteChange = cb; },
      onStatus: cb => { window.remoteStatus = cb; },
    };
  }, bridge);
  await page.route('http://dashboard.test/**', route => route.fulfill({ contentType: 'text/html', body: fixture(type) }));
  await page.goto('http://dashboard.test/index.html');
  if (type === 'cinema') await page.locator('#cx-exit').click();
  return page;
}
for (const type of ['decision-flow', 'cinema']) {
  const free = type === 'decision-flow' ? '.df-free' : '.dbx-free';
  test(`${type}: renderer carries a stable account identity and bridge`, () => {
    expect(fixture(type)).toContain('<meta name="dashboard-id" content="account-proof">');
    expect(fixture(type)).toContain('__answerStore');
  });
  test(`${type}: account load, save, remote changes and pending edit protection`, async () => {
    const page = await open(type);
    try {
      await page.waitForFunction(selector => document.querySelector(selector)?.value === 'Account answer', free, { timeout: 1500 });
      expect(await page.locator('input[value="Change"]').isChecked()).toBe(true);
      if (type === 'decision-flow') expect(await page.locator('#df-speed').inputValue()).toBe('1');
      await page.evaluate(() => { window.hold = true; });
      await page.locator(free).fill('First edit');
      await page.locator(free).fill('Latest edit');
      await page.evaluate(() => window.remoteChange('choice-free', 'Stale remote'));
      expect(await page.locator(free).inputValue()).toBe('Latest edit');
      await page.evaluate(() => { window.hold = false; window.releases.splice(0).forEach(release => release()); });
      await page.waitForFunction(() => window.saves.some(([field, value]) => field === 'choice-free' && value === 'Latest edit'));
      await page.waitForFunction(() => document.querySelector('[data-answer-status]')?.textContent.includes('account'));
      await page.evaluate(() => window.remoteChange('choice-free', 'Another device'));
      expect(await page.locator(free).inputValue()).toBe('Another device');
      expect(await page.evaluate(() => localStorage.getItem('dbx:account-proof'))).toBeNull();
    } finally { await page.close(); }
  });
  test(`${type}: device-only fallback is visible and survives reload`, async () => {
    const page = await open(type, false);
    try {
      const status = page.locator('[data-answer-status]').last();
      expect(await status.textContent()).toContain('this device only');
      expect(await status.evaluate(el => { const r = el.getBoundingClientRect(); return r.width > 10 && r.height > 10 && getComputedStyle(el).display !== 'none'; })).toBe(true);
      if (type === 'decision-flow') { await page.locator('#df-view-toggle').click(); expect(await status.isVisible()).toBe(true); await page.locator('#df-story-exit').click(); }
      await page.locator(free).fill('Local answer');
      await page.reload();
      if (type === 'cinema') await page.locator('#cx-exit').click();
      expect(await page.locator(free).inputValue()).toBe('Local answer');
    } finally { await page.close(); }
  });
}

test('cinema scene notes use the account bridge and receive remote changes', async () => {
  const page = await open('cinema');
  try {
    const note = page.locator('.sec .note-area');
    expect(await note.inputValue()).toBe('Account scene note');
    await page.evaluate(() => window.remoteChange('_notes:s1', { text: 'Scene note from another device' }));
    expect(await note.inputValue()).toBe('Scene note from another device');
    await note.fill('A scene response');
    expect(await page.evaluate(() => window.saves.some(([field, value]) => field === '_notes:s1' && value.text === 'A scene response'))).toBe(true);
    const [request] = await Promise.all([page.waitForRequest(req => req.url().endsWith('/answers')), page.getByRole('button', { name: 'Send to fleet' }).click()]);
    expect(request.postDataJSON().answers).not.toHaveProperty('_notes:s1');
  } finally { await page.close(); }
});

test('a late account load cannot overwrite a new edit or a newer remote event', async () => {
  const page = await newPage();
  try {
    await page.addInitScript(() => {
      window.saves = [];
      window.__answerStore = {
        load: () => new Promise(resolve => { window.finishLoad = resolve; }),
        save: async (field, value) => { window.saves.push([field, value]); return { ok: true }; },
        onRemoteChange: cb => { window.remoteChange = cb; },
      onStatus: cb => { window.remoteStatus = cb; },
      };
    });
    await page.route('http://dashboard.test/**', route => route.fulfill({ contentType: 'text/html', body: fixture('decision-flow') }));
    await page.goto('http://dashboard.test/');
    await page.locator('.df-free').fill('Typed while loading');
    await page.evaluate(() => { window.remoteChange('choice', 'Keep'); window.finishLoad({ 'choice-free': 'Old answer', choice: 'Change' }); });
    await page.waitForFunction(() => window.saves.length === 1);
    expect(await page.locator('.df-free').inputValue()).toBe('Typed while loading');
    expect(await page.locator('input[value="Keep"]').isChecked()).toBe(true);
    await page.locator('.df-clear').click(); await page.locator('.df-clear-apply').click();
    expect(await page.evaluate(() => window.saves.some(([field, value]) => field === 'choice-free' && value === null))).toBe(true);
  } finally { await page.close(); }
});

test('account rejection stays visible and never writes a device-only copy', async () => {
  const page = await open('decision-flow');
  try {
    await page.evaluate(() => { window.__answerStore.save = async () => ({ ok: false, reason: 'offline' }); });
    await page.locator('.df-free').fill('Keep pending');
    await page.waitForFunction(() => document.querySelector('[data-answer-status]').textContent.includes('unavailable'));
    await page.evaluate(() => window.remoteChange('choice-free', 'Old answer'));
    expect(await page.locator('.df-free').inputValue()).toBe('Keep pending');
    expect(await page.evaluate(() => localStorage.length)).toBe(0);
  } finally { await page.close(); }
});

test('a same-origin frame uses the parent account bridge', async () => {
  const page = await newPage();
  try {
    await page.route('http://dashboard.test/**', route => route.fulfill({ contentType: 'text/html', body: route.request().url().endsWith('/frame') ? fixture('decision-flow') : `<script>window.saves=[];window.__answerStore={load:async()=>({'choice-free':'Parent answer'}),save:async(field,value)=>{window.saves.push([field,value]);return {ok:true}}};</script><iframe src="/frame"></iframe>` }));
    await page.goto('http://dashboard.test/');
    const free = page.frameLocator('iframe').locator('.df-free');
    await free.waitFor();
    expect(await free.inputValue()).toBe('Parent answer');
    await free.fill('Frame edit');
    expect(await page.evaluate(() => window.saves)).toEqual([['choice-free', 'Frame edit']]);
  } finally { await page.close(); }
});

test('failed account loads retry visibly, restore untouched answers and protect queued edits', async () => {
  const page = await newPage();
  try {
    await page.clock.install();
    await page.addInitScript(() => {
      window.saves = []; window.loads = 0;
      window.__answerStore = {
        load: async () => { if (++window.loads < 3) throw new Error('temporary failure'); return { choice: 'Change', 'choice-free': 'Old account answer' }; },
        save: async (field, value) => { window.saves.push([field, value]); return { ok: true }; },
      };
    });
    await page.route('http://dashboard.test/**', route => route.fulfill({ contentType: 'text/html', body: fixture('decision-flow') }));
    await page.goto('http://dashboard.test/');
    expect(await page.locator('[data-answer-status]').textContent()).toBe('Account answers unavailable · retrying…');
    await page.locator('.df-free').fill('Queued answer');
    await page.clock.runFor(3000); expect(await page.evaluate(() => window.loads)).toBe(2);
    expect(await page.locator('[data-answer-status]').textContent()).toBe('Account answers unavailable · retrying…');
    await page.clock.runFor(3000); expect(await page.evaluate(() => window.loads)).toBe(3);
    expect(await page.locator('input[value="Change"]').isChecked()).toBe(true);
    expect(await page.locator('.df-free').inputValue()).toBe('Queued answer');
    expect(await page.evaluate(() => window.saves)).toEqual([['choice-free', 'Queued answer']]);
    expect(await page.locator('[data-answer-status]').textContent()).toBe('Answers saved to your account.');
  } finally { await page.close(); }
});

test('device preferences ignore account changes and never enter account saves', async () => {
  const page = await open('decision-flow');
  try {
    await page.evaluate(() => localStorage.setItem('dbx:account-proof', JSON.stringify({ _prefs: { rate: 1.25, view: 'list' } })));
    await page.reload();
    expect(await page.locator('#df-speed').inputValue()).toBe('1.25');
    await page.evaluate(() => window.remoteChange('_prefs', { rate: 2, view: 'story' }));
    expect(await page.locator('body').getAttribute('data-view')).toBe('list');
    await page.locator('#df-speed').selectOption('1.75');
    await page.locator('#df-view-toggle').click();
    expect(await page.evaluate(() => window.saves.some(([field]) => field === '_prefs'))).toBe(false);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dbx:account-proof'))._prefs)).toEqual({ rate: 1.75, view: 'story' });
  } finally { await page.close(); }
});

test('failed field keeps its error after another field saves, then retries to saved', async () => {
  const page = await open('decision-flow');
  try {
    await page.clock.install();
    await page.evaluate(() => {
      window.recover = false;
      window.__answerStore.save = async field => ({ ok: field !== 'choice-free' || window.recover });
    });
    await page.locator('.df-free').fill('Retry this answer');
    await page.locator('input[value="Keep"]').check();
    await page.waitForFunction(() => document.querySelector('[data-answer-status]').textContent.includes('unavailable'));
    await page.evaluate(() => { window.recover = true; });
    await page.clock.runFor(3000);
    await page.waitForFunction(() => document.querySelector('[data-answer-status]').textContent === 'Answers saved to your account.', null, { timeout: 1500 });
    await page.evaluate(() => window.remoteStatus('choice-free', 'Saving…'));
    expect(await page.locator('[data-answer-status]').textContent()).toBe('Answers saved to your account.');
  } finally { await page.close(); }
});

for (const type of ['decision-flow', 'cinema']) test(`${type}: a custom device key restores existing answers`, async () => {
  const page = await newPage();
  try {
    await page.addInitScript(() => { if (!localStorage.getItem('dbx:legacy-key')) localStorage.setItem('dbx:legacy-key', JSON.stringify({ 'choice-free': 'Legacy answer' })); });
    await page.route('http://dashboard.test/**', route => route.fulfill({ contentType: 'text/html', body: fixture(type, 'dbx:legacy-key') }));
    await page.goto('http://dashboard.test/');
    if (type === 'cinema') await page.locator('#cx-exit').click();
    const free = page.locator(type === 'cinema' ? '.dbx-free' : '.df-free');
    expect(await free.inputValue()).toBe('Legacy answer'); await free.fill('Updated answer');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dbx:legacy-key'))['choice-free'])).toBe('Updated answer');
    expect(await page.locator('[data-answer-status]').last().textContent()).toBe('Answers saved on this device only.');
    expect(await page.locator('.dbx-lede, .df-scope').textContent()).not.toContain('sync to your account');
  } finally { await page.close(); }
});

for (const action of ['preferences', 'answers']) test(`a malformed device record does not block new ${action}`, async () => {
  const page = await open('decision-flow', false);
  try {
    await page.evaluate(() => localStorage.setItem('dbx:account-proof', '{broken'));
    if (action === 'preferences') await page.locator('#df-speed').selectOption('1.75');
    else await page.locator('.df-free').fill('Recovered answer');
    const stored = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('dbx:account-proof')); } catch { return null; } });
    expect(action === 'preferences' ? stored?._prefs?.rate : stored?.['choice-free']).toBe(action === 'preferences' ? 1.75 : 'Recovered answer');
  } finally { await page.close(); }
});
