import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readableSummary} from '../stalker-digest-text.mjs';

test('capped generated descriptions display their complete sentences without altering source text', () => {
  const first = 'Fable 5.1 needed two follow-ups, while Astra needed six.';
  const original = first + ' ' + 'This unfinished qualification '.repeat(12) + 'un\u00ad';
  assert.equal(readableSummary(original), first);
  assert.ok(original.endsWith('un\u00ad'));
  assert.equal(readableSummary('A short complete summary.'), 'A short complete summary.');
  const complete = 'A complete sentence. '.repeat(25).trim();
  assert.equal(readableSummary(complete), complete);
});
