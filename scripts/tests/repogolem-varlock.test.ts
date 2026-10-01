// Shapes from varlock@1.21.1 CLI load JSON and the repo-local plugin
// local plugin bulk resolver: one op run --no-masking -- <Bun JSON emitter>.
// Installed op strings: `could not find field or file %s on item %s in vault %s`.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, mkdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
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
    env: { ...env, REPOGOLEM_TEST_MODE: '1', REPOGOLEM_SOURCE_SHA: '0'.repeat(40), REPOGOLEM_OP_BIN: join(import.meta.dir, 'fixtures/repogolem-config/fake-op.sh'), FAKE_OP_LOG: log, FAKE_OP_CANARY: 'PROVIDER_ERROR_CANARY', FAKE_OP_SUFFIX: '\nSECRET_CANARY', ...extra }, stdout: 'pipe', stderr: 'pipe', timeout: 10000,
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf8') : '';
  const output = r.stdout.toString() + r.stderr.toString();
  expect(output + calls).not.toContain('SECRET_CANARY');
  expect(output + calls).not.toContain('PROVIDER_ERROR_CANARY');
  expect(output + calls).not.toContain('SESSION_CANARY');
  for (const name of readdirSync(dir)) if (name !== 'out' && statSync(join(dir, name)).isFile()) expect(readFileSync(join(dir, name), 'utf8')).not.toContain('SECRET_CANARY');
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
  const state = join(dir, 'state'); writeFileSync(state, '');
  const { r, calls } = generate({ OP_SESSION_fixture: 'SESSION_CANARY', FAKE_OP_REQUIRE_SESSION: '1', FAKE_OP_TOKEN: 'SESSION_CANARY', FAKE_OP_STATE: state, FAKE_OP_REQUIRE_NONINTERACTIVE: '1' });
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
for (const mode of ['unreadable', 'extra', 'null']) test(`varlock ${mode} output fails closed without leaking or writing`, () => {
  const { r, output, out } = generate({ REPOGOLEM_VARLOCK_BIN: join(import.meta.dir, 'fixtures/repogolem-config/fake-varlock.ts'), FAKE_VARLOCK_MODE: mode });
  expect(r.exitCode).toBe(2); expect(output).toContain('nothing written');
  expect(output).not.toContain('PRIVATE_VARLOCK_CANARY'); expect(existsSync(out)).toBe(false);
});
test('quoted schema keeps spaces, newlines and equals signs in resolved strings', async () => {
  const { varlockResolver } = await import('../repogolem/repogolem-varlock');
  const ref = 'op://example-vault/item with spaces/token';
  const env = { ...process.env }; for (const k of Object.keys(env)) if (isOpCredential(k)) delete env[k];
  const values = varlockResolver(join(import.meta.dir, 'fixtures/repogolem-config/fake-op.sh'), { ...env, FAKE_OP_SUFFIX: '\nline=value' })([ref]);
  expect(values).toEqual([`resolved:${ref}\nline=value`]);
});

test('telemetry creates no config or network request in scratch HOME', () => {
  const home = join(dir, 'home'), xdg = join(home, '.config'), log = join(dir, 'network.log');
  mkdirSync(xdg, { recursive: true, mode: 0o700 });
  const wrapper = join(dir, 'fetch-guard.ts');
  const cli = join(root, 'node_modules/varlock/bin/cli.js');
  writeFileSync(wrapper, `globalThis.fetch = async () => { require('node:fs').appendFileSync(${JSON.stringify(log)}, 'network-attempt\\n'); throw new Error('network blocked'); }; await import(${JSON.stringify(cli)});`);
  const { r } = generate({ HOME: home, XDG_CONFIG_HOME: xdg, REPOGOLEM_VARLOCK_BIN: wrapper, VARLOCK_TELEMETRY_DISABLED: '0', DO_NOT_TRACK: '0' });
  expect(r.exitCode).toBe(0);
  expect(existsSync(join(xdg, 'varlock/config.json'))).toBe(false);
  expect(existsSync(log)).toBe(false);
});
test('parent varlock injection and proxy state cannot change generate', () => {
  expect(generate({ __VARLOCK_PROXY_CHILD: '1', __VARLOCK_ENV: 'x', VARLOCK_ENV: 'hostile' }).r.exitCode).toBe(0);
});
test('decorator payload round-trips hostile reference bytes', async () => {
  const { varlockResolver } = await import('../repogolem/repogolem-varlock');
  const ref = 'op://example-vault/item "quote" \\ ${literal}/token';
  const env = { ...process.env }; for (const k of Object.keys(env)) if (isOpCredential(k)) delete env[k];
  expect(varlockResolver(join(import.meta.dir, 'fixtures/repogolem-config/fake-op.sh'), env)([ref])).toEqual([`resolved:${ref}`]);
});

test('op children retain the original TMPDIR for the daemon socket', () => {
  const original = join(dir, 'original-tmp'); mkdirSync(original);
  expect(generate({ TMPDIR: original, FAKE_OP_EXPECT_TMPDIR: original, FAKE_OP_BEFORE: '[[ "$TMPDIR" == "$FAKE_OP_EXPECT_TMPDIR" ]]' }).r.exitCode).toBe(0);
});
test('production ignores the varlock binary override', () => {
  expect(generate({ REPOGOLEM_TEST_MODE: '0', REPOGOLEM_VARLOCK_BIN: '/does/not/exist' }).r.exitCode).toBe(0);
});

test('varlock child disables Bun automatic package installation', () => {
  expect(generate({ REPOGOLEM_VARLOCK_BIN: join(import.meta.dir, 'fixtures/repogolem-config/fake-varlock.ts'), FAKE_VARLOCK_MODE: 'no-install' }).r.exitCode).toBe(0);
});
