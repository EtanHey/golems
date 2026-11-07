import { test, expect } from 'bun:test';
import { createHash } from 'node:crypto';
import { ANSWER_ASSETS, ANSWER_RUNTIME, analyzeAnswerPersistence, extractAnswerRuntime } from '../src/answer-persistence.mjs';
test('runtime extraction trims exactly one embedded block for the handoff', () => {
  const block = extractAnswerRuntime('<html><script>\n  ' + ANSWER_RUNTIME + '  \n</script></html>');
  expect(block).toBe(ANSWER_RUNTIME.trim());
  expect(createHash('sha256').update(block).digest('hex')).toHaveLength(64);
});
for (const blocks of ['', ANSWER_ASSETS + ANSWER_ASSETS]) test(`runtime count ${blocks ? 2 : 0} refuses`, () => {
  expect(() => extractAnswerRuntime('<html>' + blocks + '</html>')).toThrow('ANSWER_RUNTIME_BLOCK_COUNT');
  expect(analyzeAnswerPersistence('<html>' + blocks + '<textarea></textarea></html>', 'demo').violations.map(v => v.metric)).toContain('ANSWER_RUNTIME_BLOCK_COUNT');
});
