import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { designTestCell } from './design-test-cell.mjs';
import { analyzeAnswerPersistence } from '../src/answer-persistence.mjs';
const cell = designTestCell(), skillRoot = fileURLToPath(new URL('../', import.meta.url));
for (const type of ['decision-flow', 'cinema']) for (const strip of ['none', 'meta', 'bridge', 'consumer']) {
  test(`${type} real BUILD: ${strip}`, () => {
    const root = mkdtempSync(path.join(cell.root, 'answers-'));
    const outputPath = path.join(root, 'docs.local/dashboards/stable-output.html');
    const segment = path.join(root, 'segments/s1'); mkdirSync(segment, { recursive: true });
    const words = [{ word: 'alpha', start: 0.05, end: 0.42 }, { word: 'beta', start: 0.45, end: 0.8 }];
    for (const name of ['words.json', 'words.raw.json']) writeFileSync(path.join(segment, name), JSON.stringify(words));
    copyFileSync(new URL('./fixtures/design-preservation/hardening-tone.wav', import.meta.url), path.join(segment, 's1.wav'));
    copyFileSync(new URL('../vendor/agent-html/templates/v4-story-mode/_placeholder.mp3', import.meta.url), path.join(segment, 's1.mp3'));
    const spec = path.join(root, 'spec.json');
    writeFileSync(spec, JSON.stringify({ type, series: path.basename(root), outputPath, scenes: [{ id: 's1', script: 'alpha beta', audioWav: 'fixture.wav' }], decisions: [{ id: 'choice', title: 'A neutral choice', options: ['Keep', 'Change'], sceneIds: ['s1'] }] }));
    const preload = path.join(root, 'strip.mjs');
    writeFileSync(preload, `import { mock } from 'bun:test';
const modulePath=${JSON.stringify(path.join(skillRoot, type === 'cinema' ? 'src/decision-surface.mjs' : 'src/decision-flow.mjs'))};
const actual=await import(modulePath), name=${JSON.stringify(type === 'cinema' ? 'injectDecisionSurfaceIntoHtml' : 'renderDecisionFlow')}, original=actual[name];
function strip(html){return ${strip === 'meta' ? 'html.replace(/<meta name="dashboard-id"[^>]*>/g, "")' : strip === 'bridge' ? 'html.replaceAll("__answerStore", "__missingStore")' : strip === 'consumer' ? 'html.replace(/data-answer-consumer="[^"]*"/g, "")' : 'html'};}
mock.module(modulePath,()=>({...actual,[name]:(...args)=>{const result=original(...args);return typeof result==='string'?strip(result):{...result,html:strip(result.html)};}}));`);
    const result = spawnSync(process.execPath, ['--preload', preload, ...cell.command(path.join(skillRoot, 'scripts/build-dashboard.mjs'), ['--spec', spec, '--job-dir', root, '--first-build', 'Isolated answer persistence fixture']).slice(1)], { cwd: skillRoot, encoding: 'utf8' });
    expect(existsSync(outputPath.replace(/\.html$/, '.receipts.json')), result.stderr).toBe(true);
    const receipts = JSON.parse(readFileSync(outputPath.replace(/\.html$/, '.receipts.json'), 'utf8'));
    expect(receipts.gates.find(row => row.gate === 'answer-persistence')?.verdict).toBe(strip === 'none' ? 'PASS' : 'REJECT');
    expect(result.status, result.stderr).toBe(strip === 'none' ? 0 : 1);
    expect(existsSync(outputPath)).toBe(strip === 'none');
    if (strip === 'none') expect(readFileSync(outputPath, 'utf8')).toContain('<meta name="dashboard-id" content="stable-output">');
  }, 15000);
}
test('gate ignores inert/commented declarations and allows pages without answers', () => {
  expect(analyzeAnswerPersistence('<html><head></head><body><!-- <meta name="dashboard-id" content="x"> --><textarea></textarea></body></html>').violations.map(v => v.metric)).toContain('DASHBOARD_ID_REQUIRED');
  expect(analyzeAnswerPersistence('<html><body>A listen-only page.</body></html>').verdict).toBe('PASS');
});
