// Etan, 2026-11-10, via orc: "the full transcript repeated inside card details; letter/number options
// he couldn't decode; a single voice saying 'look below'". Each rejection: old shape fails by name,
// fixed shape passes. Plus the sheet render (ask once, body never) and a real BUILD rejection.
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { analyzeCardAuthoring, labelHasCode, SCREEN_REFERENCE_WORDS } from '../src/card-authoring-gate.mjs';
import { analyzeCardTextAudio } from '../src/card-text-audio-gate.mjs';
import { renderDecisionFlow } from '../src/decision-flow.mjs';
import { designTestCell } from './design-test-cell.mjs';

const QUESTION = 'Should the nightly report move to the private store?';
const ANSWER = 'It fills the free space by Friday. Moving it keeps every page and costs nothing, so keep it or move it.';
const BODY = `${QUESTION} ${ANSWER}`;

function words(script) {
  return script.split(/\s+/).map((word, i, all) => ({ word, start: i / all.length, end: (i + 1) / all.length }));
}
function job(decision = {}, sceneEdits = {}) {
  const scenes = [
    { id: 'q', role: 'host', reference: 'ben-c1', title: 'Report storage', script: QUESTION, ...sceneEdits.q },
    { id: 'a', role: 'expert', reference: 'theo-c4s', title: 'Report storage', script: ANSWER, ...sceneEdits.a },
  ].map(scene => ({ ...scene, words: words(scene.script), duration: 1, audioUrl: 'data:audio/mpeg;base64,SUQz' }));
  const decisions = [{ id: 'store', title: 'Report storage', body: BODY, ask: QUESTION, sceneIds: ['q', 'a'],
    options: [{ value: 'move', label: 'Move it' }, { value: 'keep', label: 'Keep it' }], ...decision }];
  return { scenes, decisions };
}
const metrics = data => analyzeCardAuthoring(data).violations.map(v => v.metric);

test('the fixed card shape passes every authoring rule', () => {
  expect(analyzeCardAuthoring(job()).verdict).toBe('PASS');
});

test('ASK_MISSING: a decision with options or a checklist must carry an ask', () => {
  expect(metrics(job({ ask: undefined }))).toEqual(['ASK_MISSING']);
  expect(metrics(job({ ask: '   ' }))).toEqual(['ASK_MISSING']);
  expect(metrics(job({ ask: undefined, options: undefined, checklist: ['Keep the nightly report'] }))).toEqual(['ASK_MISSING']);
  // An explainer card with nothing to answer needs no ask.
  expect(metrics(job({ ask: undefined, options: undefined }))).toEqual([]);
});

test('ASK_NOT_SPOKEN: the ask must be said, in order, by one of the card\'s own scenes', () => {
  expect(metrics(job({ ask: 'Should we delete the nightly report?' }))).toEqual(['ASK_NOT_SPOKEN']);
  expect(metrics(job({ ask: 'Private store the nightly report?' }))).toEqual(['ASK_NOT_SPOKEN']);
  // Words split across two scenes do not count: one scene must say it.
  expect(metrics(job({ ask: 'Private store? Keep it or move it.' }))).toEqual(['ASK_NOT_SPOKEN']);
  // Same token normalisation as the card-text gate: case and punctuation do not matter; skipped words may.
  expect(metrics(job({ ask: 'should the NIGHTLY report move?' }))).toEqual([]);
  expect(metrics(job({ ask: 'Keep it or move it.' }))).toEqual([]);
});

test('OPTION_LABEL_CODE: labels that begin with a bare code are rejected; ordinary words pass', () => {
  for (const label of ['A: move pages', 'B3→J6', 'R2 · Done means', 'T10 · Do offline', '1) Merge', '7 merges: B3→J6, C1→J2', 'C2+J14 into one']) {
    expect(labelHasCode(label), label).toBe(true);
  }
  for (const label of ['Keep all four', 'Use it', 'A new page', '3 merges and 2 splits', 'No', 'No.', 'Re-run the tests', '1.5x speed', '10:30 standup', 'Option A']) {
    expect(labelHasCode(label), label).toBe(false);
  }
  expect(metrics(job({ options: ['A: move pages', { value: 'b', label: 'B: keep as is' }] }))).toEqual(['OPTION_LABEL_CODE', 'OPTION_LABEL_CODE']);
  expect(metrics(job({ options: undefined, checklist: [{ title: 'T1 · Asks', items: ['R2 · Done means', 'Keep it'] }] })))
    .toEqual(['OPTION_LABEL_CODE', 'OPTION_LABEL_CODE']);
  // `value` stays free-form.
  expect(metrics(job({ options: [{ value: 'A1', label: 'Move it' }, { value: 'B2', label: 'Keep it' }] }))).toEqual([]);
});

test('DECISION_SINGLE_VOICE: a decision card needs a host scene and an expert scene', () => {
  const single = job({}, { q: { role: 'expert', reference: 'theo-c4s' } });
  expect(metrics(single)).toEqual(['DECISION_SINGLE_VOICE']);
  const hostOnly = job({}, { a: { role: 'host', reference: 'ben-c1' } });
  expect(metrics(hostOnly)).toEqual(['DECISION_SINGLE_VOICE']);
  // A one-scene explainer with nothing to answer is not a decision card.
  const info = job({ ask: undefined, options: undefined, sceneIds: ['a'] });
  info.scenes = info.scenes.filter(scene => scene.id === 'a');
  info.decisions[0].body = ANSWER;
  expect(metrics(info)).toEqual([]);
});

test('SCREEN_REFERENCE: narration never points at the screen, unless the scene opts out', () => {
  expect(SCREEN_REFERENCE_WORDS).toEqual(['below', 'above', 'tick', 'ticked', 'scroll', 'on screen', 'on this card']);
  const pointing = job({}, { a: { script: `${ANSWER} Five more guesses are below; tick any that is wrong.` } });
  const found = analyzeCardAuthoring(pointing).violations;
  expect(found.map(v => [v.metric, v.segment])).toEqual([['SCREEN_REFERENCE', 'a'], ['SCREEN_REFERENCE', 'a']]);
  expect(found.map(v => v.detail).join(' ')).toContain('"below"');
  expect(found.map(v => v.detail).join(' ')).toContain('"tick"');
  for (const phrase of ['Scroll down.', 'As shown above.', 'It is on screen now.', 'Everything on this card.', 'Once ticked, it saves.']) {
    expect(metrics(job({}, { a: { script: `${ANSWER} ${phrase}` } })), phrase).toEqual(['SCREEN_REFERENCE']);
  }
  expect(metrics(job({}, { a: { script: `${ANSWER} Spend stays below the limit.`, screenWordsOk: true } }))).toEqual([]);
  // Whole words only.
  expect(metrics(job({}, { a: { script: `${ANSWER} The clock ticks while scrolling stays aboveboard.` } }))).toEqual([]);
});

test('the answer sheet shows the ask once and never the narration body; code blocks stay', () => {
  const data = job({ body: `${BODY}\n\`\`\`sh\ngit status\n\`\`\`` });
  const html = renderDecisionFlow(data);
  const window = new Window();
  try {
    window.document.write(html);
    const sheet = window.document.querySelector('.df-sheet');
    expect(sheet.querySelectorAll('.df-ask').length).toBe(1);
    expect(sheet.querySelector('.df-ask').textContent).toBe(QUESTION);
    expect(sheet.textContent.split(QUESTION).length - 1).toBe(1);
    expect(sheet.textContent).not.toContain(ANSWER);
    expect(sheet.querySelector('.df-question .ad-copy-block code').textContent).toBe('git status');
    // Nowhere outside the teleprompter repeats the narration either.
    const outside = [...window.document.querySelectorAll('.df-card > :not(.df-teleprompter)')].map(node => node.textContent).join(' ');
    expect(outside).not.toContain(ANSWER);
  } finally { window.close(); }
  // Without an ask the sheet shows nothing in place of the body.
  const bare = new Window();
  try {
    bare.document.write(renderDecisionFlow(job({ ask: undefined })));
    expect(bare.document.querySelector('.df-question').textContent).toBe('');
    expect(bare.document.querySelector('.df-sheet').textContent).not.toContain(ANSWER);
  } finally { bare.close(); }
});

test('the card-text gate still checks body against the audio after the sheet stopped rendering it', () => {
  const data = job();
  expect(analyzeCardTextAudio({ ...data, html: renderDecisionFlow(data) }).verdict).toBe('PASS');
  const drifted = job({ body: `${BODY} It also deletes the archive and resets every account on the team server tonight.` });
  const result = analyzeCardTextAudio({ ...drifted, html: renderDecisionFlow(drifted) });
  expect(result.violations.map(v => v.metric)).toEqual(['CARD_TEXT_AUDIO_MISMATCH']);
});

const cell = designTestCell(), skill = fileURLToPath(new URL('../', import.meta.url));
function build(data) {
  const root = mkdtempSync(path.join(cell.root, 'card-authoring-')), jobDir = path.join(root, 'job'), bin = path.join(root, 'bin');
  const outputPath = path.join(root, 'docs.local/dashboards/card.html');
  mkdirSync(bin); writeFileSync(path.join(bin, 'ffprobe'), "#!/bin/sh\nprintf '1.000000\\n'\n", { mode: 0o755 });
  for (const scene of data.scenes) {
    const dir = path.join(jobDir, 'segments', scene.id); mkdirSync(dir, { recursive: true });
    copyFileSync(new URL('./fixtures/design-preservation/hardening-tone.wav', import.meta.url), path.join(dir, `${scene.id}.wav`));
    copyFileSync(new URL('../vendor/agent-html/templates/v4-story-mode/_placeholder.mp3', import.meta.url), path.join(dir, `${scene.id}.mp3`));
    for (const name of ['words.json', 'words.raw.json']) writeFileSync(path.join(dir, name), JSON.stringify(scene.words));
  }
  const scenes = data.scenes.map(({ audioUrl, duration, words: _, ...scene }) => ({ ...scene, audioWav: 'fixture.wav' }));
  const spec = path.join(root, 'job.json');
  writeFileSync(spec, JSON.stringify({ id: 'card-authoring', design: { firstInLineage: { reason: 'Isolated fixture', approvedBy: 'fixture-owner' } },
    series: path.basename(root), type: 'decision-flow', outputPath, scenes, decisions: data.decisions }));
  const result = spawnSync(process.execPath, cell.command(path.join(skill, 'scripts/build-dashboard.mjs'), ['--spec', spec, '--job-dir', jobDir, '--first-build', 'Isolated card authoring fixture']).slice(1),
    { cwd: skill, encoding: 'utf8', env: { ...process.env, GOLEMS_EXPERT_VOICE: 'theo', PATH: bin + path.delimiter + process.env.PATH } });
  const receipts = JSON.parse(readFileSync(outputPath.replace('.html', '.receipts.json'), 'utf8'));
  return { result, outputPath, row: receipts.gates.find(r => r.gate === 'card-authoring') };
}

test('BUILD rejects the 03:00 card shape by name before synthesis, and passes the fixed shape', () => {
  const old = job({ ask: undefined, options: ['A: move pages', 'B: keep as is'] },
    { q: { role: 'expert', reference: 'theo-c4s' }, a: { script: `${ANSWER} Five more guesses are below.` } });
  // The job as a whole has both voices (so the older job-level SINGLE_VOICE_BUILD passes); the card does not.
  const pair = job();
  old.scenes.push(...pair.scenes.map(scene => ({ ...scene, id: `intro-${scene.id}` })));
  old.decisions.unshift({ ...pair.decisions[0], id: 'intro', status: 'INFO', ask: undefined, options: undefined, sceneIds: ['intro-q', 'intro-a'] });
  const rejected = build(old);
  expect(rejected.result.status, rejected.result.stderr).toBe(1);
  for (const name of ['ASK_MISSING', 'OPTION_LABEL_CODE', 'DECISION_SINGLE_VOICE', 'SCREEN_REFERENCE']) expect(rejected.result.stderr).toContain(name);
  expect(rejected.row?.verdict).toBe('REJECT');
  expect(existsSync(rejected.outputPath)).toBe(false);
  const fixed = build(job());
  expect(fixed.result.status, fixed.result.stderr).toBe(0);
  expect(fixed.row?.verdict).toBe('PASS');
});
