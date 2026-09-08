import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanTranscript, validateSummary } from '../stalker-digest-evidence.mjs';
import { validSummary } from './fixtures/stalker-digest-summary.mjs';

const transcript = `## [00:00] Segment 1 (10s)
load_backend: loaded CPU
main: processing 'audio.wav'
you you you you I I I I
whisper_print_timings: total time = 100ms
## [00:10] Segment 2 (20s)
Creators use AI privately but avoid discussing it publicly.
## [00:30] Segment 3 (30s)
He compared two coding models and preferred the second one's mergeable code.
`;

test('source cleaning keeps chronological speech and flags repetitive ASR', () => {
  const segments = cleanTranscript(transcript);
  assert.equal(segments.length, 3);
  assert.equal(segments[0].text, 'you you you you I I I I');
  assert.equal(segments[0].uncertain, true);
  assert.equal(segments[1].text, 'Creators use AI privately but avoid discussing it publicly.');
  assert.doesNotThrow(() => validateSummary(validSummary(), segments));
});

test('grounding restores source capitalization and rejects invented quotes', () => {
  const segments = cleanTranscript(transcript), summary = validSummary();
  summary.highlights[1].excerpt = 'creators use ai privately';
  validateSummary(summary, segments);
  assert.equal(summary.highlights[1].excerpt, 'Creators use AI privately');
  summary.highlights[1].excerpt = 'Invented wording';
  assert.throws(() => validateSummary(summary, segments), /not grounded/);
});

test('unavailable speech cannot provide digest evidence', () => {
  const segments = cleanTranscript(transcript.replace('you you you you I I I I', '[transcription unavailable; timeout]'));
  assert.equal(segments[0].usable, false);
  assert.throws(() => validateSummary(validSummary(), segments), /unavailable transcription/);
});

test('empty and diagnostic-only segments remain accounted for as unavailable speech', () => {
  const segments = cleanTranscript('## [00:00] Segment 1 (10s)\n\n## [00:10] Segment 2 (10s)\nmain: processing audio\nwhisper_print_timings: done\n');
  assert.equal(segments.length, 2);
  assert.deepEqual(segments.map(({ usable, uncertain, text }) => ({ usable, uncertain, text })), [
    { usable: false, uncertain: true, text: '' }, { usable: false, uncertain: true, text: '' },
  ]);
});
