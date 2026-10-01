// Shapes from varlock@1.21.1 CLI load JSON and 1password-plugin@2.0.4
// local plugin bulk resolver: one op run --no-masking -- <Bun JSON emitter>.
// Installed op strings: `could not find field or file %s on item %s in vault %s`.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isOpCredential } from '../repogolem/repogolem-check-refs';
const root = join(import.meta.dir, '../..');
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'varlock-fixture-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
function generate(extra: Record<string, string> = {}) {
  const config = join(dir, 'config.yaml'), out = join(dir, 'out'), log = join(dir, 'op.log');
  writeFileSync(config, JSON.stringify({ secrets: { backend: '1password' }, projects: { fixture: { path: '/home/fixture', clis: ['codex'], secrets: { TOKEN: 'op://example-vault/example-item/token', OTHER: 'op://example-vault/example-item/api-key' } } } }));
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (isOpCredential(k)) delete env[k];
  const r = Bun.spawnSync([process.execPath, join(root, 'scripts/repogolem/repogolem-config.ts'), 'generate', '--config', config, '--out-dir', out, '--home', '/home/fixture'], {
    env: { ...env, REPOGOLEM_SOURCE_SHA: '0'.repeat(40), REPOGOLEM_OP_BIN: join(import.meta.dir, 'fixtures/repogolem-config/fake-op.sh'), FAKE_OP_LOG: log, FAKE_OP_CANARY: 'PROVIDER_ERROR_CANARY', FAKE_OP_SUFFIX: '\nSECRET_CANARY', ...extra }, stdout: 'pipe', stderr: 'pipe', timeout: 10000,
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf8') : '';
  const output = r.stdout.toString() + r.stderr.toString();
  expect(output + calls).not.toContain('SECRET_CANARY');
  expect(output + calls).not.toContain('PROVIDER_ERROR_CANARY');
  expect(output + calls).not.toContain('SESSION_CANARY');
  for (const name of readdirSync(dir)) if (name !== 'out') expect(readFileSync(join(dir, name), 'utf8')).not.toContain('SECRET_CANARY');
  if (existsSync(out)) for (const name of readdirSync(out)) {
    expect(statSync(join(out, name)).mode & 0o777).toBe(0o600);
    if (name !== 'secrets.env') expect(readFileSync(join(out, name), 'utf8')).not.toContain('SECRET_CANARY');
  }
  return { r, calls, output, out };
}
test('real pinned varlock under Bun resolves refs in one batch; cache remap and no leak', () => {
  const { r, calls, out } = generate();
  expect(r.exitCode).toBe(0);
  expect(calls.split('\n').filter(c => c.startsWith('run '))).toHaveLength(1);
  expect(calls).not.toContain('inject ');
  expect(readFileSync(join(out, 'secrets.env'), 'utf8')).toContain('SECRET_CANARY');
});
test('manual session survives upstream app-auth env filtering; provider sees noninteractive controls', () => {
  const { r, calls } = generate({ OP_SESSION_fixture: 'SESSION_CANARY', FAKE_OP_REQUIRE_NONINTERACTIVE: '1' });
  expect(r.exitCode).toBe(0);
  expect(calls.split('\n').filter(c => c.startsWith('run '))).toHaveLength(1);
});
test('batch error leaves previous cache untouched, suppresses raw diagnostics and never retries', () => {
  const ok = generate(); expect(ok.r.exitCode).toBe(0);
  const previous = readFileSync(join(ok.out, 'secrets.env'), 'utf8');
  const bad = generate({ FAKE_OP_FAIL: '1' });
  expect(bad.r.exitCode).toBe(2); expect(bad.output).toContain('nothing written');
  expect(readFileSync(join(bad.out, 'secrets.env'), 'utf8')).toBe(previous);
  expect(bad.calls.split('\n').filter(c => c.startsWith('run '))).toHaveLength(2); // one per invocation
});
for (const mode of ['bad', 'unreadable', 'extra', 'null']) test(`varlock ${mode} output fails closed without leaking or writing`, () => {
  const { r, output, out } = generate({ REPOGOLEM_VARLOCK_BIN: join(import.meta.dir, 'fixtures/repogolem-config/fake-varlock.ts'), FAKE_VARLOCK_MODE: mode });
  expect(r.exitCode).toBe(2); expect(output).toContain('nothing written');
  expect(output).not.toContain('PRIVATE_VARLOCK_CANARY'); expect(existsSync(out)).toBe(false);
  if (mode === 'bad') expect(output).toContain('missing field:');
});
test('quoted schema keeps spaces, newlines and equals signs in resolved strings', async () => {
  const { varlockResolver } = await import('../repogolem/repogolem-varlock');
  const ref = 'op://example-vault/item with spaces/token';
  const env = { ...process.env }; for (const k of Object.keys(env)) if (isOpCredential(k)) delete env[k];
  const values = varlockResolver(join(import.meta.dir, 'fixtures/repogolem-config/fake-op.sh'), { ...env, FAKE_OP_SUFFIX: '\nline=value' })([ref]);
  expect(values).toEqual([`resolved:${ref}\nline=value`]);
});
