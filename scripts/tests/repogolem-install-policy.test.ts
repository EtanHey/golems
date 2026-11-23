import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isolatedBunTestEnv } from './fixtures/bun-test-env';

const cli = join(import.meta.dir, '../repogolem/repogolem-config.ts');
const seat = 'seatRegistry:\n  seats:\n    fixture:\n      launcherPrefix: custom\n';
const wanted = seat + 'contextProfiles:\n  fixture:\n    mcps:\n      allow:\n        - brainlayer\n      block: []\n';
const normalized = wanted.replace('block: []', 'block:\n        - cmuxlayer');
function fixture(body: (f: { run: (dry?: boolean) => { code: number; text: string }; target: string; journal: string; config: string }) => void) {
  const root = join(import.meta.dir, '../../docs.local/install-seat-policy');
  mkdirSync(root, { recursive: true });
  const home = mkdtempSync(join(root, 'fixture-'));
  try {
    const config = join(home, 'source.yaml');
    writeFileSync(config, seat + 'machineSeatConfigs:\n  fixture-host: |\n' + wanted.trimEnd().split('\n').map(line => '    ' + line).join('\n') + '\n');
    mkdirSync(join(home, '.golems'));
    writeFileSync(join(home, '.golems/config.yaml'), seat);
    const run = (dry = false) => {
      const r = Bun.spawnSync([process.execPath, cli, 'install', '--config', config, '--host', 'fixture-host', dry ? '--dry-run' : '--apply'], {
        env: isolatedBunTestEnv({ ...process.env, HOME: home }), stdout: 'pipe', stderr: 'pipe',
      });
      return { code: r.exitCode, text: r.stdout.toString() + r.stderr.toString() };
    };
    const initial = run();
    expect(initial.text).toContain('installed cache-only runtime');
    expect(initial.code).toBe(0);
    const target = join(home, '.config/repogolem/machine-config.yaml');
    const journal = join(home, '.config/repogolem/install-state.json');
    // Model the older installer journal followed by the policy writer. No real config.
    const state = JSON.parse(readFileSync(journal, 'utf8'));
    state.machineDigest = createHash('sha256').update(wanted).digest('hex');
    writeFileSync(journal, JSON.stringify(state) + '\n');
    body({ run, target, journal, config });
  } finally { rmSync(home, { recursive: true, force: true }); }
}
for (const dry of [false, true]) test(`policy-only machine drift reconciles (${dry ? 'dry-run' : 'apply'})`, () => fixture(({ run, target, journal, config }) => {
  writeFileSync(target, normalized);
  const before = readFileSync(journal, 'utf8'), source = readFileSync(config, 'utf8');
  const result = run(dry);
  expect(result.text).not.toContain('installed machine seat view changed');
  expect(result.code).toBe(0);
  expect(result.text).toContain('machine view reconciled: matches current render');
  expect(readFileSync(target, 'utf8')).toBe(normalized);
  expect(readFileSync(config, 'utf8')).toBe(source);
  if (dry) expect(readFileSync(journal, 'utf8')).toBe(before);
  else expect(JSON.parse(readFileSync(journal, 'utf8')).machineDigest).toBe(createHash('sha256').update(normalized).digest('hex'));
}));
for (const [name, edited] of [
  ['extra allow', normalized.replace('- brainlayer', '- brainlayer\n        - unexpected')],
  ['removed profile', seat + 'contextProfiles: {}\n'],
  ['changed key', normalized + 'machineRole: altered\n'],
  ['format-only edit', normalized + '# hand edit\n'],
  // Normalizing the observed text would erase this edit and wrongly accept it.
  ['denied allow', normalized.replace('- brainlayer', '- brainlayer\n        - cmuxlayer')],
]) test(`policy normalization still refuses ${name}`, () => fixture(({ run, target, journal }) => {
  writeFileSync(target, edited);
  const before = readFileSync(journal, 'utf8');
  const result = run();
  expect(result.code).toBe(2);
  expect(result.text).toContain('installed machine seat view changed; install refused');
  expect(result.text).toContain(name === 'format-only edit' ? 'bytes differ; parsed keys match' : 'changed top-level keys:');
  expect(readFileSync(target, 'utf8')).toBe(edited);
  expect(readFileSync(journal, 'utf8')).toBe(before);
}));
test('installer writes policy-normalized wanted view', () => fixture(({ target }) => {
  expect(readFileSync(target, 'utf8')).toBe(normalized);
}));
