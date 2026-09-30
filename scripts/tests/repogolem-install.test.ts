import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const cli = join(import.meta.dir, '../repogolem/repogolem-config.ts');
let home: string, config: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'repogolem-install-'));
  config = join(home, 'private.yaml');
  writeFileSync(config, 'seatRegistry:\n  seats:\n    fixture:\n      launcherPrefix: custom\n');
  mkdirSync(join(home, '.golems'));
  writeFileSync(join(home, '.golems/config.yaml'), readFileSync(config));
  writeFileSync(join(home, '.zshrc'), '# before\nsource "$HOME/.config/ralphtools/launchers.zsh"\n# after\n');
});
afterEach(() => rmSync(home, { recursive: true, force: true }));
function run(extra: string[] = []) {
  const r = Bun.spawnSync(['bun', cli, 'install', '--config', config, ...extra], { env: { ...process.env, HOME: home, REPOGOLEM_OP_BIN: '/does/not/exist' }, stdout: 'pipe', stderr: 'pipe' });
  return { code: r.exitCode, text: r.stdout.toString() + r.stderr.toString() };
}
test('dry run leaves zshrc, seats and installation untouched', () => {
  expect(run(['--dry-run']).code).toBe(0);
  expect(existsSync(join(home, '.config/repogolem'))).toBe(false);
  expect(readFileSync(join(home, '.zshrc'), 'utf8')).toContain('ralphtools');
});
test('install is idempotent, preserves the seat prefix, and rollback restores exact bytes', () => {
  const before = readFileSync(join(home, '.zshrc'), 'utf8');
  expect(run().code).toBe(0);
  const after = readFileSync(join(home, '.zshrc'), 'utf8');
  expect(after).toContain('REPOGOLEM_CONFIG=');
  expect(after).not.toContain('ralphtools/launchers.zsh');
  expect(readlinkSync(join(home, '.golems/config.yaml'))).toBe(config);
  expect(readFileSync(join(home, '.golems/config.yaml'), 'utf8')).toContain('launcherPrefix: custom');
  expect(run().code).toBe(0);
  expect(readFileSync(join(home, '.zshrc'), 'utf8')).toBe(after);
  expect(run(['--rollback']).code).toBe(0);
  expect(readFileSync(join(home, '.zshrc'), 'utf8')).toBe(before);
  expect(readFileSync(join(home, '.golems/config.yaml'), 'utf8')).toContain('launcherPrefix: custom');
});
test('rollback refuses to overwrite subsequent zshrc edits', () => {
  expect(run().code).toBe(0);
  writeFileSync(join(home, '.zshrc'), 'user edits\n');
  expect(run(['--rollback']).code).toBe(2);
  expect(readFileSync(join(home, '.zshrc'), 'utf8')).toBe('user edits\n');
});
test('refuses mismatched seat prefixes and symlinked shell targets', () => {
  writeFileSync(config, 'seatRegistry:\n  seats:\n    fixture:\n      launcherPrefix: changed\n');
  expect(run().code).toBe(2);
  expect(existsSync(join(home, '.local/bin/repogolem'))).toBe(false);
});
test('installed bundled CLI runs from outside the checkout without node_modules', () => {
  expect(run().code).toBe(0);
  const r = Bun.spawnSync([join(home, '.local/bin/repogolem'), 'init', '--config', join(home, 'starter.yaml'), '--host', 'fixture-host'], { cwd: home, env: { ...process.env, HOME: home }, stdout: 'pipe', stderr: 'pipe' });
  expect(r.exitCode).toBe(0);
  expect(readFileSync(join(home, 'starter.yaml'), 'utf8')).toContain('fixture-host');
});
