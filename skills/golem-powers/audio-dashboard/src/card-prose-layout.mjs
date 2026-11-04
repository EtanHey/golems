import { chromium } from 'playwright';

// Measure the canonical rendered artifact, never a second approximation of its typography.
export async function analyzeCardProseLayout(html, { browser } = {}) {
  const owned = !browser, stats = [], violations = [];
  try {
    browser ||= await chromium.launch({ args: ['--mute-audio'] });
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block' });
      try {
        const page = await context.newPage();
        await page.route('**/*', route => route.abort());
        await page.setContent(html, { waitUntil: 'domcontentloaded' });
        await page.evaluate(() => document.fonts.ready);
        const rows = await page.evaluate(() => [...document.querySelectorAll('.df-card')].map(card => {
          const blocks = [...card.querySelectorAll('.df-summary,.df-question > p')].filter(el => el.textContent.trim());
          return { segment: card.dataset.decision, blocks: blocks.map(el => {
            const css = getComputedStyle(el), range = document.createRange(); range.selectNodeContents(el);
            const rects = [...range.getClientRects()].filter(r => r.width && r.height);
            return { lines: new Set(rects.map(r => Math.round(r.top))).size,
              readable: parseFloat(css.fontSize) >= 15 && css.overflow === 'visible' && css.webkitLineClamp === 'none' &&
                css.textOverflow !== 'ellipsis' && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
              overflow: el.scrollWidth > el.clientWidth + 1 };
          }) };
        }));
        for (const row of rows) {
          const lines = row.blocks.reduce((n, block) => n + block.lines, 0);
          stats.push({ ...row, width, lines });
          if (lines > 2 || row.blocks.some(block => !block.readable || block.overflow)) {
            violations.push({ segment: row.segment, metric: 'CARD_PROSE_LAYOUT', value: lines, threshold: 2,
              evidence: `Rendered prose at ${width}px must fit two lines with readable, unclipped text.` });
          }
        }
      } finally { await context.close(); }
    }
  } catch {
    violations.push({ segment: 'dashboard', metric: 'CARD_PROSE_LAYOUT_UNAVAILABLE', value: 0, threshold: 1,
      evidence: 'Real browser prose measurement failed; restore Chromium and rerun BUILD.' });
  } finally { if (owned && browser) await browser.close(); }
  return { verdict: violations.length ? 'REJECTED' : 'PASS', violations, stats };
}
