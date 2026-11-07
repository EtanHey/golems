import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium } from 'playwright';
import { renderDecisionFlow } from '../src/decision-flow.mjs';
import { scene } from './decision-flow-harness.mjs';
let browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); });
for (const id of ['info-synthetic', 'decision-synthetic']) for (const action of ['input', 'Clear']) {
  test(`native Chromium ${id} ${action}: empty account answer survives reload during a typing hold`, async () => {
    const account = { [id + '-free']: 'Synthetic prior note' }, page = await browser.newPage();
    try {
      await page.clock.install();
      await page.exposeFunction('loadSynthetic', () => ({ ...account }));
      await page.exposeFunction('saveSynthetic', entries => { for (const [key, value] of entries) { if (value === null) delete account[key]; else account[key] = value; } });
      await page.addInitScript(() => {
        const pending = new Map();
        window.__answerStore = {
          load: () => window.loadSynthetic(), status: () => pending.size ? 'Saving…' : 'Saved',
          save: async (key, value) => { pending.set(key, value); setTimeout(() => window.__answerStore.flush(), 60000); return { ok: true, queued: true }; },
          flush: async () => { await window.saveSynthetic([...pending]); pending.clear(); },
        };
      });
      const html = renderDecisionFlow({ id: 'native-clear', scenes: [scene('s')], decisions: [{ id, title: 'Synthetic card', options: id.startsWith('info-') ? [] : ['Keep', 'Change'], sceneIds: ['s'] }] });
      await page.route('http://dashboard.test/**', route => route.fulfill({ contentType: 'text/html', body: html }));
      await page.goto('http://dashboard.test/');
      await page.waitForFunction(() => document.querySelector('.df-free').value === 'Synthetic prior note');
      if (action === 'input') await page.locator('.df-free').fill('');
      else { await page.locator('.df-clear').click(); await page.locator('.df-clear-apply').click(); }
      await page.clock.runFor(11000);
      await page.waitForFunction(() => document.querySelector('[data-answer-status]').textContent === 'Answers saved to your account.', null, { timeout: 1000 });
      expect(account[id + '-free'] ?? '').toBe('');
      await page.reload();
      await page.waitForFunction(() => document.querySelector('[data-answer-status]').textContent === 'Answers saved to your account.');
      expect(await page.locator('.df-free').inputValue()).toBe('');
    } finally { await page.close(); }
  });
}
