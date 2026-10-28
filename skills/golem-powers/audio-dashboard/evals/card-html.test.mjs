import { expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { validateAudioDashboardEvidence } from '../src/audio-dashboard-evidence.mjs';

const dir = new URL('./fixtures/card-format/', import.meta.url);
for (const file of readdirSync(dir)) {
  test(file, () => {
    const html = readFileSync(new URL(file, dir), 'utf8');
    const codes = validateAudioDashboardEvidence({ html }).violations.map(v => v.code);
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
