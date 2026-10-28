import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { lintCardFormat } from '../src/card-format.mjs';

const card = (extra = {}) => ({ id: 'comparison', visualization: false, ...extra });

test('rejects a text-only card with a View details expander', () => {
  expect(lintCardFormat(card({ detailAffordance: 'view-details' })))
    .toEqual(['TEXT_ONLY_VIEW_DETAILS']);
});

test('allows text-only cards without an expander and visual cards with details', () => {
  expect(lintCardFormat(card())).toEqual([]);
  expect(lintCardFormat(card({ visualization: true, detailAffordance: 'view-details' }))).toEqual([]);
});

test('Listen deeper requires an inner narrated section with read-along and word seek', () => {
  const deeper = card({ detailAffordance: 'listen-deeper', innerAudio: {
    sceneIds: ['comparison-deep'], readAlong: true, wordSeek: true,
  } });
  expect(lintCardFormat(deeper)).toEqual([]);
  expect(lintCardFormat({ ...deeper, innerAudio: undefined })).toEqual(['INVALID_INNER_AUDIO']);
  for (const field of ['readAlong', 'wordSeek']) {
    expect(lintCardFormat({ ...deeper, innerAudio: { ...deeper.innerAudio, [field]: false } }))
      .toEqual(['INVALID_INNER_AUDIO']);
  }
});

test('missing visualization declaration cannot silently allow details', () => {
  expect(lintCardFormat({ id: 'unknown', detailAffordance: 'view-details' }))
    .toEqual(['INVALID_CARD_FORMAT']);
});

test('skill links the format rule and authoring lint', () => {
  const skill = readFileSync(new URL('../SKILL.md', import.meta.url), 'utf8');
  expect(skill).toContain('references/card-format.md');
  expect(skill).toContain('scripts/lint-card-format.mjs');
});

test('CLI rejects a text-only template spec and accepts the documented example', () => {
  const reference = readFileSync(new URL('../references/card-format.md', import.meta.url), 'utf8');
  const example = JSON.parse(reference.match(/```json\n([\s\S]*?)\n```/)[1]);
  const run = spec => {
    const child = Bun.spawnSync(['bun', new URL('../scripts/lint-card-format.mjs', import.meta.url).pathname, '/dev/stdin'],
      { stdin: Buffer.from(JSON.stringify(spec)) });
    return { exit: child.exitCode, output: JSON.parse(child.stdout.toString()) };
  };
  expect(run(example)).toEqual({ exit: 0, output: { verdict: 'PASS', violations: [] } });
  expect(run({ cards: [card({ detailAffordance: 'view-details' })] })).toEqual({
    exit: 1, output: { verdict: 'REJECT', violations: [{ card: 0, code: 'TEXT_ONLY_VIEW_DETAILS' }] },
  });
});
