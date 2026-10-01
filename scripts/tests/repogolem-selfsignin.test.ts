import { isOpCredential } from '../repogolem/repogolem-check-refs';
// Integration tests: only the shim runs; tokens and decrypted canaries stay private.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CLI = join(import.meta.dir, '../repogolem/repogolem-config.ts');
const OP = join(import.meta.dir, 'fixtures/repogolem-config/fake-op.sh');
let dir: string, out: string, log: string, config: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'selfsignin-')); out = join(dir, 'out'); log = join(dir, 'calls'); config = join(dir, 'config.yaml');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
function run(mode = 'generate', env: Record<string, string> = {}, ref: string | string[] = 'op://example-vault/example-item/token', backend: unknown = '1password', tty = true) {
  writeFileSync(config, JSON.stringify({ projects: { fixture: { path: '/home/fixture', clis: ['codex'], secrets: Object.fromEntries((Array.isArray(ref) ? ref : [ref]).map((value, index) => [`TOKEN_${index}`, value])) } }, ...(backend === null ? {} : { secrets: { backend } }) }));
  const base = { ...process.env };
  for (const key of Object.keys(base)) if (isOpCredential(key)) delete base[key];
  let argv = [process.execPath, CLI, 'generate', '--config', config, '--out-dir', out, ...(mode === 'generate' ? [] : mode.split(' '))];
  if (env.FAKE_OP_TERMINAL_LOG) argv = [process.execPath, '-e', `import {checkRefs} from ${JSON.stringify(process.env.FAKE_OP_CHECK_REFS_MODULE || join(import.meta.dir, '../repogolem/repogolem-check-refs.ts'))}; const code = checkRefs(['op://example-vault/example-item/token'], process.env.REPOGOLEM_OP_BIN); const terminal = Bun.spawnSync(['/bin/stty', '-a'], {env:{}, stdin:'inherit', stdout:'pipe', stderr:'ignore'}); require('node:fs').writeFileSync(process.env.FAKE_OP_TERMINAL_LOG, terminal.stdout); process.exit(code);`];
  const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
  const cmd = tty && (env.FAKE_OP_UNSIGNED || env.FAKE_OP_REQUIRE_DESKTOP) && !mode.includes('--no-prompt')
    ? (process.platform === 'darwin' ? ['script', '-q', '/dev/null', ...argv] : ['script', '-q', '-e', '-c', argv.map(quote).join(' '), '/dev/null']) : argv;
  const proc = Bun.spawnSync(cmd, {
    env: { ...base, REPOGOLEM_OP_BIN: OP, REPOGOLEM_SOURCE_SHA: '0'.repeat(40), FAKE_OP_LOG: log, FAKE_OP_STATE: join(dir, 'state'), FAKE_OP_CANARY: 'DECRYPTED_CANARY', FAKE_OP_TOKEN: 'SESSION_CANARY', ...env }, stdout: 'pipe', stderr: 'pipe',
  });
  const output = proc.stdout.toString() + proc.stderr.toString();
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
  const files = existsSync(out) ? readdirSync(out).map(name => readFileSync(join(out, name), 'utf8')).join('\n') : '';
  expect(output + files + calls.join('\n')).not.toContain('DECRYPTED_CANARY');
  expect(output + files + calls.join('\n')).not.toContain('SESSION_CANARY');
  return { code: proc.exitCode, output, calls };
}
for (const mode of ['generate', '--check-refs', '--check-refs --no-prompt']) {
  test(`${mode}: signed in, field present, no signin`, () => {
    const r = run(mode); expect(r.code).toBe(0); expect(r.calls.some(c => c.startsWith('signin'))).toBe(false);
    expect(r.calls.filter(c => c.startsWith('item get'))).toHaveLength(1);
  });
  for (const [env, message] of [
    [{ FAKE_OP_MISSING_FIELD: '1' }, 'missing field: example-vault/example-item/token'],
    [{ FAKE_OP_MISSING_ITEM: 'example-item' }, 'missing item:'],
    [{ FAKE_OP_MISSING_VAULT: 'example-vault' }, 'missing vault:'],
    [{ FAKE_OP_BAD_ITEM_JSON: '1' }, 'invalid 1Password field metadata'],
    [{ FAKE_OP_GET_FAIL: '1' }, 'cannot inspect 1Password fields'],
  ] as const) test(`${mode}: ${message} fails before run/write`, () => {
    const r = run(mode, env); expect(r.code).toBe(2); expect(r.output).toContain(message);
    expect(r.calls.some(c => c.startsWith('run '))).toBe(false); expect(existsSync(out)).toBe(false);
  });
  test(`${mode}: unknown backend fails before op`, () => {
    const r = run(mode, {}, undefined, 'unknown'); expect(r.code).toBe(2); expect(r.calls).toEqual([]); expect(existsSync(out)).toBe(false);
  });
}
for (const mode of ['generate', '--check-refs']) {
  for (const manual of [false, true]) test(`${mode}: ${manual ? 'account session' : 'desktop'} signin once, then success`, () => {
    const r = run(mode, { FAKE_OP_UNSIGNED: '1', ...(manual ? { FAKE_OP_MANUAL: '1', FAKE_OP_REQUIRE_SESSION: '1' } : {}) });
    expect(r.code).toBe(0); expect(r.calls.filter(c => c.startsWith('signin'))).toEqual(['signin']);
    expect(r.calls.filter(c => c.startsWith('whoami'))).toHaveLength(2);
  });
  for (const failure of ['fail', 'cancel', 'still-unsigned']) test(`${mode}: signin ${failure}, exit3 without writes`, () => {
    const r = run(mode, { FAKE_OP_UNSIGNED: '1', FAKE_OP_SIGNIN_FAILURE: failure });
    expect(r.code).toBe(3); expect(r.output).toContain('Nothing written'); expect(existsSync(out)).toBe(false);
    expect(r.calls.filter(c => c.startsWith('signin'))).toHaveLength(1);
  });
}
test('no-prompt: unsigned never attempts signin', () => {
  const r = run('--check-refs --no-prompt', { FAKE_OP_UNSIGNED: '1' }); expect(r.code).toBe(3);
  expect(r.calls).toEqual(['whoami --format json']); expect(r.output).toContain('desktop integration is disabled');
});
for (const ref of ['op://EXAMPLE-VAULT/EXAMPLE-ITEM/TOKEN', 'op://example-vault/example-item/credentials/token', 'op://example-vault/example-item/section-id/field-id']) {
  test(`case, label/id and section matching: ${ref}`, () => expect(run('--check-refs', {}, ref).code).toBe(0));
}
test('wrong section cannot match another field', () => {
  const r = run('generate', {}, 'op://example-vault/example-item/wrong/token'); expect(r.code).toBe(2); expect(r.output).toContain('missing field:');
});
test('omitted backend defaults once', () => {
  const r = run('generate', {}, undefined, null); expect(r.code).toBe(0);
  expect(r.output.match(/defaulting to 1password/g)).toHaveLength(1);
});
test('--check never invokes op or writes', () => {
  const r = run('--check'); expect(r.code).toBe(1); expect(r.calls).toEqual([]); expect(existsSync(out)).toBe(false);
});

test('item aliases share one item get and one vault list', () => {
  const r = run('--check-refs', {}, ['op://example-vault/example-item/token', 'op://synthetic-vault/synthetic-item/api-key']);
  expect(r.code).toBe(0); expect(r.calls.filter(c => c.startsWith('item get'))).toHaveLength(1);
  expect(r.calls.filter(c => c.startsWith('item list'))).toHaveLength(1);
});
test('field projection reads names and section only, never secret properties', async () => {
  const { fieldNames } = await import('../repogolem/repogolem-check-refs');
  const field = new Proxy({ id: 'field', label: 'Token', section: { id: 'section', label: 'Credentials' } }, {
    get(target, key) { if (!['id', 'label', 'section'].includes(String(key))) throw new Error('value access'); return Reflect.get(target, key); },
  });
  expect(fieldNames({ fields: [field] }).has('credentials/token')).toBe(true);
});
test('failed implicit preflight preserves existing generated bytes', () => {
  expect(run().code).toBe(0); const before = readdirSync(out).map(name => readFileSync(join(out, name), 'utf8'));
  expect(run('generate', { FAKE_OP_MISSING_FIELD: '1' }).code).toBe(2);
  expect(readdirSync(out).map(name => readFileSync(join(out, name), 'utf8'))).toEqual(before);
});

test('manual signin succeeds without an account-list probe', () => {
  const r = run('generate', { FAKE_OP_UNSIGNED: '1', FAKE_OP_ACCOUNTS: 'invalid', FAKE_OP_REQUIRE_SESSION: '1' });
  expect(r.code).toBe(0); expect(r.calls.filter(c => c.startsWith('signin'))).toEqual(['signin']); expect(r.calls.some(c => c.startsWith('account list'))).toBe(false);
});
test('resolver errors containing decrypted data stay value-free', () => {
  const r = run('generate', { FAKE_OP_FAIL: '1' }); expect(r.code).toBe(2); expect(existsSync(out)).toBe(false);
});

test('existing manual session bypasses desktop integration without signing in again', () => {
  const r = run('generate', { OP_SESSION_fixture: 'SESSION_CANARY', FAKE_OP_REQUIRE_NONINTERACTIVE: '1' });
  expect(r.code).toBe(0); expect(r.calls.some(c => c.startsWith('signin'))).toBe(false);
});
test('OP_SESSION_TIMEOUT is configuration, not an authentication token', () => {
  expect(run('--check-refs', { OP_SESSION_TIMEOUT: '45', FAKE_OP_REQUIRE_DESKTOP: '1' }).code).toBe(0);
});

test('unsigned without TTY never attempts signin', () => {
  const r = run('generate', { FAKE_OP_UNSIGNED: '1', FAKE_OP_REQUIRE_NONINTERACTIVE: '1' }, undefined, '1password', false);
  expect(r.code).toBe(3); expect(r.calls).toEqual(['whoami --format json']); expect(r.output).toContain('interactive terminal');
});
test('desktop-classified export is captured and replaces a stale account session', () => {
  expect(run('generate', { FAKE_OP_UNSIGNED: '1', FAKE_OP_EXPORT: '1', FAKE_OP_REQUIRE_SESSION: '1', OP_SESSION_fixture: 'stale' }).code).toBe(0);
});
test('signin hangs only until its test deadline', () => {
  const r = run('generate', { FAKE_OP_UNSIGNED: '1', FAKE_OP_SIGNIN_HANG: '1', REPOGOLEM_TEST_SIGNIN_TIMEOUT_MS: '50' });
  expect(r.code).toBe(3); expect(r.calls.filter(c => c === 'signin')).toHaveLength(1); expect(existsSync(out)).toBe(false);
});
test('session delegation setting is configuration', () => {
  expect(run('--check-refs', { OP_SESSION_DELEGATION_ENABLED: '1', FAKE_OP_REQUIRE_DESKTOP: '1' }).code).toBe(0);
});
for (const ref of ['op://example-vault/example-item/token?attribute=otp', 'op://example-vault/example-item/token?ssh-format=openssh', 'op://example-vault/example-item/add more/token']) {
  test(`optional labels and query matching: ${ref}`, () => expect(run('--check-refs', { FAKE_OP_FIELDS: '{"fields":[{"id":"token","section":{"id":"add more"}}]}' }, ref).code).toBe(0));
}
test('auth failure preserves existing generated files', () => {
  expect(run().code).toBe(0); const before = readdirSync(out).map(name => readFileSync(join(out, name), 'utf8'));
  expect(run('generate', { FAKE_OP_UNSIGNED: '1', FAKE_OP_REQUIRE_NONINTERACTIVE: '1' }, undefined, '1password', false).code).toBe(3);
  expect(readdirSync(out).map(name => readFileSync(join(out, name), 'utf8'))).toEqual(before);
});

for (const output of ['garbage', 'export OP_SESSION_fixture="SESSION_CANARY"\nnot-a-comment', 'export OP_SESSION_TIMEOUT="bad"', 'export OP_SESSION_fixture="SESSION_CANARY"\nexport OP_SESSION_other="other"']) {
  test('unexpected signin output fails closed', () => {
    const r = run('generate', { FAKE_OP_UNSIGNED: '1', FAKE_OP_SIGNIN_OUTPUT: output });
    expect(r.code).toBe(3); expect(existsSync(out)).toBe(false);
  });
}

test('real four-line manual export succeeds without exposing its token', () => {
  const r = run('generate', { FAKE_OP_UNSIGNED: '1', FAKE_OP_MANUAL: '1', FAKE_OP_REQUIRE_SESSION: '1' });
  expect(r.code).toBe(0); expect(r.calls.filter(c => c.startsWith('signin'))).toEqual(['signin']);
});
for (const failure of ['timeout', 'signal']) test(`signin ${failure} restores terminal echo`, () => {
  const terminal = join(dir, 'terminal');
  const r = run('generate', { FAKE_OP_UNSIGNED: '1', FAKE_OP_NO_ECHO: '1', FAKE_OP_TERMINAL_LOG: terminal, ...(failure === 'timeout' ? { FAKE_OP_SIGNIN_HANG: '1', REPOGOLEM_TEST_SIGNIN_TIMEOUT_MS: '50' } : { FAKE_OP_SIGNIN_SIGNAL: '1' }) });
  expect(r.code).toBe(3); expect(existsSync(out)).toBe(false);
  expect(readFileSync(terminal + '.before', 'utf8')).toMatch(/(?:^|[\s;])-echo(?:[\s;]|$)/);
  expect(readFileSync(terminal, 'utf8')).not.toMatch(/(?:^|[\s;])-echo(?:[\s;]|$)/);
});
