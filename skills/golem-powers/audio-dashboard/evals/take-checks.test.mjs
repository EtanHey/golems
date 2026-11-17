import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { takeCheckArgs, rejectedTakeChecks, readTakeChecks } from '../src/take-checks.mjs';
import { prepareSpeechChannels } from '../src/spoken-form.mjs';
import { splitForBreathing } from '../vendor/narrationlayer/local-tts-runner.ts';
import { wordMismatches } from '../vendor/narrationlayer/src/quality/take-checks.ts';

test('vendored colon, shadcn and numeric-equivalence behavior', () => {
  expect(splitForBreathing('Here is the plan: ship tomorrow.', .55, .22)[0].padAfterSeconds).toBe(.35);
  expect(prepareSpeechChannels('We use shadcn.').synthInput).toContain('shad C N');
  const words = ['400', 'dollars'].map((word, i) => ({ word, start: i, end: i + 1 }));
  expect(wordMismatches('four hundred dollars', words, { setting: 'a' }).pass).toBe(true);
});

test('kept-best never passes selection even if a caller labels its word check pass', () => {
  expect(rejectedTakeChecks({ wordMatch: { pass: true, keptBest: true } })).toBe(true);
  expect(rejectedTakeChecks({ gaveUp: true })).toBe(true);
  expect(rejectedTakeChecks({ wordMatch: { pass: false } })).toBe(true);
  expect(rejectedTakeChecks({ gaveUp: false, wordMatch: { pass: true } })).toBe(false);
});

test('BUILD withholds HTML and writes a reject receipt for a kept-best take', () => {
  const root = mkdtempSync(path.resolve(import.meta.dir, '../../../../docs.local/revendor-check-'));
  try {
    const spec = path.join(root, 'spec.json');
    const out = path.join(root, 'page.html');
    const seg = path.join(root, 'segments', 'colon');
    mkdirSync(seg, { recursive: true });
    writeFileSync(spec, JSON.stringify({ id: 'fixture', type: 'cinema', scenes: [{ id: 'colon', script: 'Here is the plan: ship tomorrow.', reference: 'theo-c4s' }] }));
    const wav = path.join(seg, 'colon.wav');
    const checks = { attempts: 3, gaveUp: false, wordMatch: { pass: false, keptBest: true } };
    writeFileSync(`${wav}.cache.json`, JSON.stringify({ takeChecks: checks }));
    expect(readTakeChecks(wav, { required: true })).toEqual(checks);
    writeFileSync(out, 'stale passing HTML');
    const result = spawnSync(process.execPath, [path.resolve(import.meta.dir, '../scripts/build-dashboard.mjs'), '--spec', spec, '--job-dir', root, '--out', out], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('TAKE_CHECK_FAILED');
    expect(existsSync(out)).toBe(false);
    const receipt = JSON.parse(readFileSync(path.join(root, 'page.receipts.json'), 'utf8'));
    expect(receipt.gates.find(row => row.gate === 'take-checks').verdict).toBe('REJECT');
    expect(receipt.takeChecks[0].checks.wordMatch.keptBest).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('synth ceilings are profile-specific and missing Whisper fails before rendering', () => {
  const root = mkdtempSync(path.resolve(import.meta.dir, '../../../../docs.local/model-check-'));
  try {
    const module = new URL('../src/take-checks.mjs', import.meta.url).href;
    const code = `const { takeCheckArgs } = await import(${JSON.stringify(module)}); console.log(JSON.stringify(takeCheckArgs(process.argv[1])));`;
    const run = ref => spawnSync(process.execPath, ['-e', code, ref], { encoding: 'utf8', env: { ...process.env, HOME: root } });
    expect(run('theo-c4s').stderr).toContain('Take checks require Whisper model');
    mkdirSync(path.join(root, '.cache/whisper'), { recursive: true });
    writeFileSync(path.join(root, '.cache/whisper/ggml-large-v3-turbo.bin'), 'existence-only fixture');
    expect(JSON.parse(run('theo-c4s').stdout)).toEqual(['--take-checks', '--take-retries', '2', '--word-check-setting', 'a', '--pitch-ceiling', '340']);
    expect(JSON.parse(run('ben-c1').stdout).at(-1)).toBe('260');
    expect(() => takeCheckArgs('unknown-profile')).toThrow('No take-check pitch ceiling');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
