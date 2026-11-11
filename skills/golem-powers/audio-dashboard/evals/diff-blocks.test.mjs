import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { chromium } from 'playwright';
import { COPY_BLOCK_ASSETS, renderCardBody } from '../src/copy-blocks.mjs';

const raw = '\n@@ -1,2 +1,2 @@\n-old <script>alert("x")</script>\n+new & safe\n context\n';
test('diff lines classify, escape markup, and retain every raw character', () => {
  const window = new Window();
  try {
    window.document.body.innerHTML = renderCardBody('```diff\n' + raw + '\n```');
    const code = window.document.querySelector('code');
    for (const kind of ['added', 'removed', 'hunk', 'context']) expect(code.querySelector('.ad-diff-' + kind)).not.toBeNull();
    expect(code.querySelector('script')).toBeNull();
    expect(code.textContent).toBe(raw);
  } finally { window.close(); }
});
test('non-diff fence snapshot remains identical to master', () => {
  const expected = '<div class="ad-copy-block"><pre><code>  a &lt;b&gt;\n\n+unchanged</code></pre><button type="button" data-copy-block aria-label="Copy code block">Copy</button><span role="status" aria-live="polite"></span></div>';
  for (const info of ['', 'sh', 'Diff', 'diff extra']) expect(renderCardBody('```' + info + '\n\n  a <b>\n\n+unchanged\n\n```')).toBe(expected);
});
test('real browser copy preserves diff raw text in both system themes with AA colors', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.copied = text; } } }));
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme });
      await page.goto('data:text/html,' + encodeURIComponent(renderCardBody('```diff\n' + raw + '\n```') + COPY_BLOCK_ASSETS));
      await page.locator('button').click();
      expect(await page.evaluate(() => window.copied)).toBe(raw);
      const ratios = await page.locator('code span').evaluateAll(lines => {
        const lum = rgb => {
          const vals = rgb.match(/[\d.]+/g).slice(0, 3).map(n => { const v = Number(n) / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
          return vals[0] * .2126 + vals[1] * .7152 + vals[2] * .0722;
        };
        return lines.map(line => {
          const style = getComputedStyle(line), fg = lum(style.color);
          const bg = lum(style.backgroundColor === 'rgba(0, 0, 0, 0)' ? getComputedStyle(line.closest('.ad-copy-block')).backgroundColor : style.backgroundColor);
          return (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05);
        });
      });
      expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
    }
  } finally { await browser.close(); }
});
