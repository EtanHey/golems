import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDecisionFlow } from '../src/decision-flow.mjs';
import { persistedAnswerKeys } from '../src/prepare-hosted.mjs';
import { designTestCell } from './design-test-cell.mjs';

const cell = designTestCell(), skill = fileURLToPath(new URL('../', import.meta.url));
const card = (id, extra = {}) => ({ id, title: id, sceneIds: [id], ...extra });
const explainers = ['rune', 'sync', 'release'].map(id => card(id, { status: 'INFO', topic: id }));
const choices = explainers.map(({ id }) => card(id + '-pick', { after: id, topic: id, options: ['Keep', 'Change'], checklist: ['Check'] }));
const batched = [...explainers, ...choices];
const render = decisions => renderDecisionFlow({ id: 'order-proof', decisions, scenes: decisions.map(({ id }) => ({
  id, script: 'alpha beta', words: [{ word: 'alpha', start: 0.05, end: 0.42 }, { word: 'beta', start: 0.45, end: 0.8 }],
  duration: 1, audioUrl: 'data:audio/mpeg;base64,AA=='
})) });
const order = (html, pattern = /<article\b[^>]*data-decision="([^"]+)"/g) => [...html.matchAll(pattern)].map(m => m[1]);

test('three batched decisions follow their explainers in cards, chips and index without mutating the job', () => {
  const before = JSON.stringify(batched), html = render(batched);
  const expected = ['rune', 'rune-pick', 'sync', 'sync-pick', 'release', 'release-pick'];
  expect(order(html)).toEqual(expected);
  expect(order(html, /<button\b[^>]*data-chip-for="([^"]+)"/g)).toEqual(expected);
  expect(order(html, /<a\b[^>]*data-index-for="([^"]+)"/g)).toEqual(expected);
  expect(JSON.stringify(batched)).toBe(before);
});
test('two decisions attached to one explainer retain authored relative order, including forward references', () => {
  expect(order(render([choices[0], ...explainers, card('second', { after: 'rune' })])))
    .toEqual(['rune', 'rune-pick', 'second', 'sync', 'release']);
});
test('legacy numeric IDs retain their rendered string identity', () => {
  expect(order(render([card(1), card(2)]))).toEqual(['1', '2']);
  expect(order(render([card(2, { after: '1' }), card(1)]))).toEqual(['1', '2']);
});
test('unknown, empty, self and cyclic after references refuse with the named code', () => {
  for (const decisions of [[...explainers, card('pick', { after: 'absent' })], [card('pick', { after: '' })],
    [card('pick', { after: 'pick' })], [card('a', { after: 'b' }), card('b', { after: 'a' })]]) {
    expect(() => { render(decisions); }).toThrow('DECISION_SEPARATED_FROM_EXPLAINER');
  }
});
test('final order refuses a nested attachment separating siblings from their explainer', () => {
  expect(() => { render([card('info'), card('a', { after: 'info' }), card('b', { after: 'info' }), card('nested', { after: 'a' })]); })
    .toThrow('DECISION_SEPARATED_FROM_EXPLAINER');
});
test('only an exact explicit topic match to an earlier INFO card requires after', () => {
  expect(() => { render([...explainers, card('pick', { topic: 'rune' })]); }).toThrow('DECISION_AFTER_REQUIRED');
  for (const extra of [{ title: 'Rune decision' }, { topic: 'Rune' }, { topic: 'runes' }, { topic: '' }]) {
    expect(order(render([...explainers, card('pick', extra)]))).toEqual(['rune', 'sync', 'release', 'pick']);
  }
  expect(order(render([card('pick', { topic: 'rune' }), ...explainers]))[0]).toBe('pick');
});
test('after changes no persisted answer key, kind or option', () => {
  const keys = decisions => persistedAnswerKeys(render(decisions)).sort((a, b) => a.key.localeCompare(b.key));
  expect(keys(batched)).toEqual(keys(batched.map(({ after, topic, ...rest }) => rest)));
  expect(keys(batched).length).toBe(18);
});
test('real BUILD refuses unknown after with the named code and withholds replacement HTML', () => {
  const root = path.join(cell.root, 'build'); mkdirSync(root);
  const bin = path.join(root, 'bin'); mkdirSync(bin);
  writeFileSync(path.join(bin, 'ffprobe'), "#!/bin/sh\nprintf '1.000000\\n'\n", { mode: 0o755 });
  const segment = path.join(root, 'segments/pick'); mkdirSync(segment, { recursive: true });
  const words = [{ word: 'alpha', start: 0.05, end: 0.42 }, { word: 'beta', start: 0.45, end: 0.8 }];
  for (const name of ['words.json', 'words.raw.json']) writeFileSync(path.join(segment, name), JSON.stringify(words));
  copyFileSync(new URL('./fixtures/design-preservation/hardening-tone.wav', import.meta.url), path.join(segment, 'pick.wav'));
  copyFileSync(new URL('../vendor/agent-html/templates/v4-story-mode/_placeholder.mp3', import.meta.url), path.join(segment, 'pick.mp3'));
  const outputPath = path.join(root, 'docs.local/dashboards/order.html'); mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, 'stale dashboard');
  const specPath = path.join(root, 'job.json');
  writeFileSync(specPath, JSON.stringify({ id: 'build-order', type: 'decision-flow', outputPath,
    scenes: [{ id: 'pick', script: 'alpha beta', audioWav: 'fixture.wav' }], decisions: [card('pick', { after: 'absent' })] }));
  const result = spawnSync(process.execPath, [path.join(skill, 'scripts/build-dashboard.mjs'), '--spec', specPath, '--job-dir', root],
    { encoding: 'utf8', env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH } });
  expect(result.status, result.stderr).toBe(1);
  expect(result.stderr).toContain('DECISION_SEPARATED_FROM_EXPLAINER');
  expect(existsSync(outputPath)).toBe(false);
});
