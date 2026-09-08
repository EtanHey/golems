import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRunDashboard } from '../stalker-dashboard.mjs';

test('digest dashboard starts with topics and exposes timestamped excerpts and usable clips', () => {
  const item = { timestamp: '10:47', title: 'AI & creators', summary: 'A discussion <script>unsafe()</script>', excerpt: 'We use tools.', uncertain: false };
  const html = buildRunDashboard({ date: '2026-09-08', channel: 'theo', runName: 'theo-2026-09-08-030512',
    summary: { topics: [item], highlights: [item], claims: [{ timestamp: item.timestamp, excerpt: item.excerpt, uncertain: false, claim: 'An unverified assertion' }] },
    cardMedia: [{ timestamp: '10:47', clip: 'card-media/clips/clip-10m47s.mp4', frame: 'card-media/frames/frame-10m47s.jpg', startSeconds: 627, endSeconds: 692, evidenceSeconds: 647 }],
  });
  assert.match(html, /An unverified assertion/);
  assert.match(html, /What was discussed/);
  assert.match(html, /Claims worth checking/);
  assert.match(html, /AI &amp; creators/);
  assert.doesNotMatch(html, /<script>unsafe/);
  assert.match(html, /evidence\/theo-2026-09-08-030512\/card-media\/clips\/clip-10m47s.mp4/);
  assert.equal((html.match(/<video[^>]+controls/g) ?? []).length, 3);
  assert.match(html, /Context 10:27–11:32 · quoted segment at \+0:20/);
  assert.match(html, /aria-label="Close source excerpt"/);
  assert.match(html, /name="viewport"/);
});

test('digest dashboard fails instead of rendering a card without media', () => {
  const item = { timestamp: '1:00', title: 'Missing', summary: 'No silent fallback', excerpt: 'Source.', uncertain: false };
  assert.throws(() => buildRunDashboard({
    date: '2026-09-08', channel: 'theo', runName: 'run',
    summary: { topics: [item], highlights: [], claims: [] }, cardMedia: [],
  }), /missing card media for 1:00/);
});
