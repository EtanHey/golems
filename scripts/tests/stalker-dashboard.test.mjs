import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRunDashboard } from '../stalker-dashboard.mjs';

test('digest dashboard starts with topics and exposes timestamped excerpts and usable clips', () => {
  const item = { timestamp: '10:47', title: 'AI & creators', summary: 'A discussion <script>unsafe()</script>', excerpt: 'We use tools.', uncertain: false };
  const html = buildRunDashboard({ date: '2026-09-08', channel: 'theo', runName: 'theo-2026-09-08-030512',
    summary: { topics: [item], highlights: [item], claims: [{ timestamp: item.timestamp, excerpt: item.excerpt, uncertain: false, claim: 'An unverified assertion' }] },
    gems: [{ timestamp: '10:47', clip: 'clips/clip-10m47s.mp4', frame: 'frames/frame-10m47s.jpg' }],
  });
  assert.match(html, /An unverified assertion/);
  assert.match(html, /What was discussed/);
  assert.match(html, /Claims worth checking/);
  assert.match(html, /AI &amp; creators/);
  assert.doesNotMatch(html, /<script>unsafe/);
  assert.match(html, /evidence\/theo-2026-09-08-030512\/clips\/clip-10m47s.mp4/);
  assert.match(html, /<video[^>]+controls/);
  assert.match(html, /aria-label="Close source excerpt"/);
  assert.match(html, /name="viewport"/);
});
