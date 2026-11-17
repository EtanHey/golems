import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

// Historical bug, kept only here: inflections were silently waived as spelling.
function finalSFixture(clip) {
  const base = word => word.length > 3 ? word.toLowerCase().replace(/s$/, '') : word.toLowerCase();
  const waived = clip.takeCheck.edits.every(e => base(e.sent.join('')) === base(e.recognised.join('')));
  return { status: waived ? 'waived' : 'failed' };
}
const classifyClip = process.env.CLASSIFY_FINAL_S_FIXTURE === '1'
  ? finalSFixture : (await import('../scripts/classify-takes.mjs')).classifyClip;
const clip = (sent, recognised, tokenClass) => ({
  id: 'answer-one', takeCheck: { edits: [{ sent: sent.split(' ').filter(Boolean),
    recognised: recognised.split(' ').filter(Boolean), sentIndex: 0, recognisedIndex: 0, tokenClass }] },
});

test.each(['opens', 'pulls'])('%s losing its final s is a real miss', word => {
  expect(classifyClip(clip(word, word.slice(0, -1))).status).toBe('failed');
});

if (process.env.CLASSIFY_FINAL_S_FIXTURE !== '1') {
  test.each([['colour', 'color'], ['organise', 'organize'], ['analyse', 'analyze'],
    ['organisation', 'organization'], ['centre', 'center'], ['dialogue', 'dialog']])(
    '%s / %s is a spelling waiver', (sent, heard) => {
      const result = classifyClip(clip(sent, heard));
      expect(result.waived[0].reason).toBe('spelling');
      expect(result.notices[0]).toContain('passed its check only as a spelling difference');
    });
  test.each([['twenty three', '23'], ['twenty-three', '23'], ['twenty three dollars', '$23'],
    ['twenty three percent', '23%']])('digits preserve %s / %s', (sent, heard) => {
      expect(classifyClip(clip(sent, heard)).waived[0].reason).toBe('digits');
    });
  test.each([['twenty three', '24'], ['twenty three', '-23'], ['dollar', ''], ["cat's", 'cats'], ['cats', 'cat'],
    ['course', 'corse'], ['any thing', 'anything'], ['word', ''], ['', 'um']])(
    '%s / %s stays real', (sent, heard) => expect(classifyClip(clip(sent, heard)).status).toBe('failed'));
  test('explicit jargon allows split near spelling', () => {
    expect(classifyClip(clip('BrainBar', 'brain bar', 'jargon')).waived[0].reason).toBe('name');
    expect(classifyClip(clip('BrainBar', 'brain bar'), { names: ['BrainBar'] }).status).toBe('waived');
    expect(classifyClip(clip('BrainBar', 'brain bar')).status).toBe('failed');
    expect(classifyClip(clip('BrainBar', 'other words', 'jargon')).status).toBe('failed');
  });
  test('a mixed clip emits a failure line for each miss and a waiver notice', () => {
    const input = clip('opens', 'open');
    input.takeCheck.edits.push({ sent: ['colour'], recognised: ['color'], sentIndex: 1, recognisedIndex: 1 });
    const result = classifyClip(input);
    expect(result.real).toHaveLength(1);
    expect(result.waived).toHaveLength(1);
    expect(result.notices).toEqual([
      'This answer clip failed its check: heard "open" for "opens".',
      'This answer clip also has a waived spelling difference: heard "color" for "colour".',
    ]);
  });
  test('digit and unit alignment edits are classified as one phrase', () => {
    const input = clip('twenty', '23');
    input.takeCheck.edits.push({ sent: ['three', 'dollars'], recognised: ['dollars'], sentIndex: 1, recognisedIndex: 1 });
    expect(classifyClip(input).waived[0].reason).toBe('digits');
  });
  test('pitch and omitted-first-word failures cannot be waived', () => {
    const input = clip('colour', 'color');
    input.takeCheck.pitchFailed = true;
    input.takeCheck.firstWordOmitted = true;
    expect(classifyClip(input).real.map(item => item.reason)).toEqual(['pitch', 'first-word']);
    expect(classifyClip(input).status).toBe('failed');
  });
  test('a flagged check without explainable edits fails closed', () => {
    expect(classifyClip({ id: 'unknown', flagged: true, takeCheck: { edits: [] } }).status).toBe('failed');
    expect(() => classifyClip({ id: 'missing' })).toThrow();
  });
  test('the real CLI reads clips and returns notices', () => {
    const result = spawnSync(process.execPath, ['scripts/classify-takes.mjs'], {
      cwd: new URL('..', import.meta.url), input: JSON.stringify({ clips: [clip('opens', 'open')] }), encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).clips[0].notices[0]).toContain('failed its check');
  });
}
