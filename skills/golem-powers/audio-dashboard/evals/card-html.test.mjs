import { expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateAudioDashboardEvidence } from '../src/audio-dashboard-evidence.mjs';

const dir = new URL('./fixtures/card-format/', import.meta.url);
for (const file of readdirSync(dir).filter(file => file.endsWith('.html'))) {
  test(file, () => {
    const html = readFileSync(new URL(file, dir), 'utf8');
    const outputPath = fileURLToPath(new URL(file, dir));
    const codes = validateAudioDashboardEvidence({ html, outputPath }).violations.map(v => v.code);
    expect(codes.includes('TEXT_ONLY_VIEW_DETAILS')).toBe(file.startsWith('red-'));
  });
}

test('violation identifies the card by id and title', () => {
  const html = readFileSync(new URL('red-named-card.html', dir), 'utf8');
  const violation = validateAudioDashboardEvidence({ html }).violations.find(v => v.code === 'TEXT_ONLY_VIEW_DETAILS');
  expect(violation.evidence).toContain('synthetic-review');
  expect(violation.evidence).toContain('Synthetic review');
});

test('3,000-word narrated card finishes within one second', () => {
  const words = Array.from({ length: 3000 }, (_, i) => `<span data-word-start="${i}">word</span>`).join(' ');
  const html = `<article class="card"><details><summary>Listen deeper</summary><audio src="deep.mp3"></audio><p>${words}</p></details></article>`;
  const start = performance.now();
  const result = validateAudioDashboardEvidence({ html });
  expect(performance.now() - start).toBeLessThan(1000);
  expect(result.violations.some(v => v.code === 'TEXT_ONLY_VIEW_DETAILS')).toBe(false);
});

test.each([
  ['fragment id', '<button data-open-visual="#target">View details</button>', '<section id="target"><canvas></canvas></section>', false],
  ['role dialog video', '<button data-open-visual="target">View details</button>', '<div id="target" role="dialog"><video src="clip.mp4"></video></div>', false],
  ['figure target', '<button data-open-visual="target">View details</button>', '<figure id="target"><img src="chart.png"></figure>', false],
  ['aria-controls with bare marker', '<button data-open-visual aria-controls="target">View details</button>', '<dialog id="target"><svg></svg></dialog>', false],
  ['dialog control icon', '<button data-open-visual="target">View details</button>', '<dialog id="target"><button><svg></svg>Close</button></dialog>', true],
  ['summary control icon', '<button data-open-visual="target">View details</button>', '<dialog id="target"><details><summary><svg></svg>Text</summary>Text</details></dialog>', true],
  ['missing id', '<button data-open-visual="#missing">View details</button>', '', true],
  ['uninspected iframe in dialog', '<button data-open-visual="target">View details</button>', '<dialog id="target"><iframe src="targets/visual.html"></iframe></dialog>', true],
  ['local page with query and fragment', '<button data-open-visual="targets/visual.html?mode=wide#chart">View details</button>', '', false],
  ['empty page fragment', '<button data-open-visual="targets/page.html#">View details</button>', '', true],
  ['missing page fragment', '<button data-open-visual="targets/page.html#missing">View details</button>', '', true],
  ['resolved text page wins over another aria target', '<button data-open-visual="text" aria-controls="other">View details</button>', '<dialog id="other"><svg></svg></dialog>', true],
  ['directory escape', '<button data-open-visual="../../../../references/card-format.md">View details</button>', '', true],
  ['protocol relative URL', '<button data-open-visual="//example.test/visual.html">View details</button>', '', true],
  ['normalized path within directory', '<button data-open-visual="../card-format/targets/visual.html">View details</button>', '', false],
])('%s', (_name, control, target, flagged) => {
  const html = `<article class="card">${control}</article>${target}`;
  const outputPath = fileURLToPath(new URL('green-open-visual.html', dir));
  expect(validateAudioDashboardEvidence({ html, outputPath }).violations.some(v => v.code === 'TEXT_ONLY_VIEW_DETAILS')).toBe(flagged);
});

test.each([
  ['index.html', true],
  ['./index.html', true],
  ['index.html#text', true],
  ['index.html#missing', true],
  ['index.html#chart', false],
])('self-reference %s', (marker, flagged) => {
  const outputPath = fileURLToPath(new URL('targets/self/index.html', dir));
  const html = readFileSync(outputPath, 'utf8').replace('data-open-visual="index.html"', `data-open-visual="${marker}"`);
  expect(validateAudioDashboardEvidence({ html, outputPath }).violations.some(v => v.code === 'TEXT_ONLY_VIEW_DETAILS')).toBe(flagged);
});

test('local visual needs a dashboard file path', () => {
  const html = '<article class="card"><button data-open-visual="targets/visual.html">View details</button></article>';
  expect(validateAudioDashboardEvidence({ html }).violations.some(v => v.code === 'TEXT_ONLY_VIEW_DETAILS')).toBe(true);
});
