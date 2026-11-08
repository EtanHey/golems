import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { renderDecisionFlow } from '../src/decision-flow.mjs';
import { designTestCell } from './design-test-cell.mjs';

const cell = designTestCell(), skill = fileURLToPath(new URL('../', import.meta.url));
const short = 'The local build is ready for review.';
const long = short + ' The release still needs account verification. The operator must compare the retained evidence before publishing. A successful build alone does not prove delivery.';
const label = 'Audio is a summary of this card';
function fixture(body, scripts = [short], extra = {}) {
  const scenes = scripts.map((script, i) => ({ id: `s${i}`, role: `fixture-${i}`, title: 'Narration', script, audioWav: 'fixture.wav', duration: 1,
    words: script.split(/\s+/).map((word, j, all) => ({ word, start: j / all.length, end: (j + 1) / all.length })) }));
  const decisions = [{ id: 'card', title: 'Review this card', body, sceneIds: scenes.map(s => s.id), ...extra }];
  return { scenes, decisions };
}
function build(body, scripts, extra) {
  const root = mkdtempSync(path.join(cell.root, 'card-audio-')), job = path.join(root, 'job'), bin = path.join(root, 'bin');
  const data = fixture(body, scripts, extra), outputPath = path.join(root, 'docs.local/dashboards/card.html');
  mkdirSync(bin); writeFileSync(path.join(bin, 'ffprobe'), "#!/bin/sh\nprintf '1.000000\\n'\n", { mode: 0o755 });
  for (const scene of data.scenes) {
    const dir = path.join(job, 'segments', scene.id); mkdirSync(dir, { recursive: true });
    copyFileSync(new URL('./fixtures/design-preservation/hardening-tone.wav', import.meta.url), path.join(dir, `${scene.id}.wav`));
    copyFileSync(new URL('../vendor/agent-html/templates/v4-story-mode/_placeholder.mp3', import.meta.url), path.join(dir, `${scene.id}.mp3`));
    for (const name of ['words.json', 'words.raw.json']) writeFileSync(path.join(dir, name), JSON.stringify(scene.words));
  }
  const spec = path.join(root, 'job.json');
  writeFileSync(spec, JSON.stringify({ id: 'card-audio', design: { firstInLineage: { reason: 'Isolated fixture', approvedBy: 'fixture-owner' } }, series: path.basename(root), type: 'decision-flow', outputPath, ...data }));
  const result = spawnSync(process.execPath, cell.command(path.join(skill, 'scripts/build-dashboard.mjs'), ['--spec', spec, '--job-dir', job, '--first-build', 'Isolated card audio fixture']).slice(1),
    { cwd: skill, encoding: 'utf8', env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH } });
  const receipts = JSON.parse(readFileSync(outputPath.replace('.html', '.receipts.json'), 'utf8'));
  return { result, outputPath, row: receipts.gates.find(r => r.gate === 'card-text-audio') };
}
for (const [name, body, scripts] of [['card longer than audio', long, [short]], ['audio longer than card', short, [long]], ['empty card with audio', '', [short]]]) {
  test(`BUILD rejects ${name}`, () => {
    const { result, outputPath, row } = build(body, scripts);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('CARD_TEXT_AUDIO_MISMATCH');
    expect(row?.verdict).toBe('REJECT');
    expect(row?.violations[0].metric).toBe('CARD_TEXT_AUDIO_MISMATCH');
    expect(existsSync(outputPath)).toBe(false);
  });
}
for (const [name, body, scripts, extra] of [
  ['identical prose', short, [short], {}],
  ['case punctuation and whitespace', 'THE local BUILD is ready, for REVIEW!', [short], {}],
  ['owned scripts in order', long, [short, long.slice(short.length).trim()], {}],
  ['explicit summary', long, [short], { audioSummary: true }],
  ['summary field', long, [short], { summary: 'Build review overview.' }],
  ['excluded title sources controls options and code', short + '\n```sh\ngit status\n```', [short], { options: ['Approve', 'Wait'], sources: [{ label: 'Full evidence', url: 'https://example.com/evidence' }], copyPrompt: { label: 'Research', text: 'Find more context.' } }],
]) {
  test(`BUILD passes ${name}`, () => {
    const { result, outputPath, row } = build(body, scripts, extra);
    expect(result.status, result.stderr).toBe(0);
    expect(row?.verdict).toBe('PASS');
    expect(existsSync(outputPath)).toBe(true);
    if (extra.audioSummary || extra.summary) {
      const window = new Window();
      try {
        window.document.write(readFileSync(outputPath, 'utf8'));
        const notice = window.document.querySelector('.df-audio-summary');
        expect(notice?.textContent).toBe(label);
        expect(notice?.closest('[hidden],details,.df-sheet,.df-teleprompter')).toBeNull();
      } finally { window.close(); }
    }
  });
}
test('summary opt-in is literal: false, blank summary and string true do not label a card', () => {
  for (const extra of [{ audioSummary: false }, { audioSummary: 'true' }, { summary: ' ' }]) {
    expect(renderDecisionFlow(fixture(long, [short], extra))).not.toContain(`class="df-audio-summary"`);
  }
});
