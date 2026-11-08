import { test, expect } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { designTestCell } from './design-test-cell.mjs';
import { buildReceiptsPath } from '../src/build-receipts.mjs';
import { sha256 } from '../src/hosted-delivery.mjs';
const cell = designTestCell(), skillRoot = fileURLToPath(new URL('../', import.meta.url));
const fixture = JSON.parse(readFileSync(new URL('./fixtures/green/01-canonical-readalong.json', import.meta.url))).evidence;
function setup() {
  const root = mkdtempSync(path.join(cell.root, 'segments-')), jobDir = path.join(root, 'alternate-job');
  const segmentsDir = path.join(jobDir, 'segments'), scene = path.join(segmentsDir, 'new-scene');
  mkdirSync(scene, { recursive: true });
  writeFileSync(path.join(scene, 'words.json'), JSON.stringify(fixture.wordsJson));
  const outputPath = path.join(root, 'docs.local/dashboards/example.html');
  mkdirSync(path.dirname(outputPath), { recursive: true }); writeFileSync(outputPath, fixture.html);
  const specPath = path.join(root, 'job.json'), spec = { id: path.basename(root), outputPath,
    scenes: [{ id: 'new-scene', script: 'Tonight we trace decisions' }] };
  const deliveryPath = path.join(root, 'delivery.json'); writeFileSync(deliveryPath, '{"backfilled":true}');
  const run = (fields = {}, flags = [], env = {}) => {
    writeFileSync(specPath, JSON.stringify({ ...spec, ...fields }));
    return spawnSync('bun', cell.command('scripts/validate-evidence.mjs', ['--spec', specPath, '--delivery', deliveryPath, '--json', ...flags]).slice(1),
      { cwd: skillRoot, encoding: 'utf8', env: { ...process.env, ...env } });
  };
  const record = hash => writeFileSync(buildReceiptsPath(outputPath), JSON.stringify({ artifactSha256: hash,
    segmentsDir: path.relative(path.dirname(outputPath), segmentsDir) }));
  return { root, jobDir, segmentsDir, scene, outputPath, specPath, spec, run, record };
}
function expectWords(result) {
  expect(result.stdout, result.stderr).not.toContain('MISSING_REAL_WORDS_JSON');
  expect(result.stdout).not.toContain('ESTIMATED_OR_WPM_TIMING');
  expect(JSON.parse(result.stdout).realWordTiming).toBe(true);
}
test('evidence uses spec segmentsDir and jobDir relative to the spec, from another cwd', () => {
  const f = setup();
  expectWords(f.run({ segmentsDir: 'alternate-job/segments', jobDir: 'wrong-job' }));
  expectWords(f.run({ jobDir: 'alternate-job' }));
  expectWords(f.run({ segmentsDir: f.segmentsDir }));
});
test('evidence uses only a BUILD record bound to the current HTML hash', () => {
  const f = setup(); f.record(sha256(fixture.html)); expectWords(f.run());
  f.record('0'.repeat(64));
  const stale = f.run(); expect(stale.status).not.toBe(0);
  expect(stale.stderr).toContain('JOB_DIR_SCENE_MISMATCH');
  f.record(sha256(fixture.html)); writeFileSync(f.outputPath, fixture.html + 'changed');
  expect(f.run().stderr).toContain('JOB_DIR_SCENE_MISMATCH');
});
test('CLI and spec paths take precedence without searching lower-priority dirs', () => {
  const f = setup(); f.record(sha256(fixture.html));
  mkdirSync(path.join(f.root, 'wrong/segments/old-scene'), { recursive: true });
  expectWords(f.run({ segmentsDir: 'wrong' }, ['--job-dir', f.jobDir]));
  expect(f.run({ segmentsDir: 'wrong' }).stderr).toContain('JOB_DIR_SCENE_MISMATCH');
  expect(f.run({}, ['--job-dir', path.join(f.root, 'wrong')]).stderr).toContain('JOB_DIR_SCENE_MISMATCH');
});
test('legacy jobs still resolve the default directory when no BUILD location is recorded', () => {
  const f = setup(), home = path.join(f.root, 'home');
  cpSync(f.segmentsDir, path.join(home, '.narrationlayer/jobs', f.spec.id, 'segments'), { recursive: true });
  writeFileSync(buildReceiptsPath(f.outputPath), JSON.stringify({ artifactSha256: sha256(fixture.html) }));
  expectWords(f.run({}, [], { HOME: home }));
});
test('zero matching scene ids names the directory mismatch rather than estimated timing', () => {
  const f = setup(), result = f.run();
  expect(result.status).not.toBe(0); expect(result.stderr).toContain('JOB_DIR_SCENE_MISMATCH');
  expect(result.stderr).toContain('0 of 1 scene ids; pass --job-dir');
  expect(result.stdout + result.stderr).not.toContain('ESTIMATED_OR_WPM_TIMING');
});
test('a matching scene with missing words retains the actual timing rejection', () => {
  const f = setup(); writeFileSync(path.join(f.scene, 'words.json'), '[]');
  const result = f.run({ segmentsDir: f.segmentsDir });
  expect(result.stderr).not.toContain('JOB_DIR_SCENE_MISMATCH');
  expect(result.stdout).toContain('MISSING_REAL_WORDS_JSON');
});
const mediaTools = ['ffmpeg', 'ffprobe'].every(bin => spawnSync(bin, ['-version']).status === 0);
(mediaTools ? test : test.skip)('real BUILD records a portable segments dir bound to its HTML; evidence and prepare use it', () => {
  const f = setup(), wav = path.join(f.scene, 'new-scene.wav');
  expect(spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=140:duration=1.8', wav]).status).toBe(0);
  expect(spawnSync('ffmpeg', ['-v', 'error', '-i', wav, path.join(f.scene, 'new-scene.mp3')]).status).toBe(0);
  writeFileSync(path.join(f.scene, 'words.raw.json'), JSON.stringify(fixture.wordsJson));
  const accepted = path.join(f.root, 'accepted.json'); writeFileSync(accepted, '{}');
  writeFileSync(f.specPath, JSON.stringify({ ...f.spec, type: 'cinema',
    acceptedBaseline: { path: accepted, sha256: sha256('{}') },
    design: { firstInLineage: { reason: 'Isolated synthetic fixture', approvedBy: 'fixture-owner' } },
    scenes: [{ ...f.spec.scenes[0], audioWav: wav }] }));
  const run = (script, flags) => spawnSync('bun', cell.command(`scripts/${script}.mjs`, ['--spec', f.specPath, '--first-build', 'Isolated synthetic fixture', ...flags]).slice(1),
    { cwd: skillRoot, encoding: 'utf8' });
  const built = run('build-dashboard', ['--job-dir', f.jobDir]); expect(built.status, built.stderr).toBe(0);
  const receipts = JSON.parse(readFileSync(buildReceiptsPath(f.outputPath)));
  expect(receipts.segmentsDir).toBe(path.relative(path.dirname(f.outputPath), f.segmentsDir));
  expect(path.isAbsolute(receipts.segmentsDir)).toBe(false);
  expect(receipts.artifactSha256).toBe(sha256(readFileSync(f.outputPath)));
  const result = run('validate-evidence', ['--prepare-publish', '--json']);
  expect(result.status, result.stderr + result.stdout).toBe(0);
  expect(JSON.parse(result.stdout).realWordTiming).toBe(true);
}, 30000);
