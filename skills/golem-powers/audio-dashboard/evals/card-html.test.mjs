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
