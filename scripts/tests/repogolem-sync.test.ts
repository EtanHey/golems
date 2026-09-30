import { afterEach, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const cli = join(import.meta.dir, '../repogolem/repogolem-config.ts');
const fixture = join(import.meta.dir, '../repogolem/config.example.yaml');
const fakeOp = join(import.meta.dir, 'fixtures/repogolem-config/fake-op.sh');
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'repogolem-sync-')); dirs.push(dir);
  const ssh = join(dir, 'ssh'), log = join(dir, 'log'), opLog = join(dir, 'op-log');
  writeFileSync(ssh, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\ncase "$*" in *scutil*) printf 'example-host\\n/home/fixture\\n';; *'cat >'*) cat > '${dir}/stream';; esac\n`, { mode: 0o700 });
  const run = (extra: string[] = []) => Bun.spawnSync(['bun', cli, 'sync', 'm1', '--config', fixture, '--remote-repo', '~/private-fixture', ...extra], { env: { ...process.env, REPOGOLEM_SSH_BIN: ssh, REPOGOLEM_OP_BIN: fakeOp, FAKE_OP_LOG: opLog }, stdout: 'pipe', stderr: 'pipe' });
  return { run, dir, log, opLog };
}
test('sync dry run performs no SSH and no secret resolution', () => {
  const { run, log, opLog } = setup();
  const r = run(['--dry-run']);
  expect(r.exitCode).toBe(0);
  expect(Bun.file(log).size).toBe(0);
  expect(Bun.file(opLog).size).toBe(0);
  expect(r.stdout.toString()).toContain('umask 077');
});
test('resolves remote host once on MBP, streams cache through stdin, remote never calls op', () => {
  const { run, dir, log, opLog } = setup();
  const r = run();
  expect(r.exitCode).toBe(0);
  expect(readFileSync(opLog, 'utf8').trim().split('\n')).toHaveLength(1);
  const commands = readFileSync(log, 'utf8');
  expect(commands).toContain('pull --ff-only');
  expect(commands).toContain('umask 077');
  expect(commands).toContain('--secrets-from');
  expect(commands).not.toContain('resolved:');
  const stream = readFileSync(join(dir, 'stream'), 'utf8');
  expect(stream).toContain('# machine: example-host');
  expect(stream).toContain('REPOGOLEM_SECRET_');
  expect(r.stdout.toString() + r.stderr.toString()).not.toContain('resolved:');
});

// Exercise the actual SSH command under both possible login shells, not a log-only stub.
function executingRemote(shell: string, mode: number, fault = '', symlinkParent = false) {
  const dir = mkdtempSync(join(tmpdir(), 'repogolem-remote-')); dirs.push(dir);
  const home = join(dir, 'home'), bin = join(dir, 'bin');
  mkdirSync(join(home, '.config'), { recursive: true }); mkdirSync(bin);
  chmodSync(home, 0o700); chmodSync(join(home, '.config'), mode);
  const repo = join(home, 'private-fixture'); mkdirSync(join(repo, 'repogolem'), { recursive: true });
  writeFileSync(join(repo, 'repogolem/config.yaml'), readFileSync(fixture));
  if (symlinkParent) {
    const actual = join(dir, 'other'); mkdirSync(actual, { mode: 0o700 });
    symlinkSync(actual, join(home, '.config/repogolem'));
  }
  for (const [name, script] of Object.entries({
    git: 'exit 0', scutil: "printf 'example-host\\n'",
    repogolem: `printf invoked > "$HOME/generator-called"; exec bun '${cli}' "$@"`,
    ...(fault ? { cat: 'printf partial; exit 77' } : {}),
  })) writeFileSync(join(bin, name), `#!/bin/sh\n${script}\n`, { mode: 0o700 });
  const ssh = join(bin, 'ssh');
  writeFileSync(ssh, `#!/bin/sh\nfor arg; do command=$arg; done\nexport HOME='${home}' PATH='${bin}':"$PATH"\nexec '${shell}' -c "$command"\n`, { mode: 0o700 });
  const result = Bun.spawnSync(['bun', cli, 'sync', 'm1', '--config', fixture, '--remote-repo', '~/private-fixture'], {
    env: { ...process.env, REPOGOLEM_SSH_BIN: ssh, REPOGOLEM_OP_BIN: fakeOp }, stdout: 'pipe', stderr: 'pipe',
  });
  return { result, home };
}
for (const shell of ['bash', 'zsh']) {
  for (const mode of [0o700, 0o750, 0o755, 0o777]) test(`remote directory policy executes under ${shell}, mode ${mode.toString(8)}`, () => {
    const { result, home } = executingRemote(shell, mode);
    expect(result.exitCode).toBe(mode === 0o777 ? 2 : 0);
    expect(existsSync(join(home, '.config/repogolem/generated/secrets.env'))).toBe(mode !== 0o777);
    expect(existsSync(join(home, 'generator-called'))).toBe(mode !== 0o777);
  });
  test(`remote parent symlink is refused under ${shell}`, () => {
    const { result, home } = executingRemote(shell, 0o700, '', true);
    expect(result.exitCode).toBe(2);
    expect(existsSync(join(home, 'generator-called'))).toBe(false);
  });
  test(`failed stream is cleaned under ${shell}`, () => {
    const { result, home } = executingRemote(shell, 0o700, 'cat');
    expect(result.exitCode).toBe(2);
    const generated = join(home, '.config/repogolem/generated');
    expect(readdirSync(generated).filter(name => name.startsWith('.incoming-'))).toEqual([]);
  });
}
test('invalid remote repo paths are refused before SSH', () => {
  const { run, log, opLog } = setup();
  for (const path of ['relative', '/line\nnext', '~']) {
    const r = run(['--remote-repo', path]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr.toString()).toContain('remote repo');
  }
  expect(existsSync(log)).toBe(false); expect(existsSync(opLog)).toBe(false);
});
test('invalid remote host/home identity is refused before resolution', () => {
  const { run, dir, opLog } = setup();
  for (const identity of ['bad host\n/home/test', 'example-host\nrelative', 'example-host\n/home/test\nextra']) {
    writeFileSync(join(dir, 'ssh'), `#!/bin/sh\ncase "$*" in *scutil*) printf '%s\n' '${identity}';; esac\n`, { mode: 0o700 });
    const r = run();
    expect(r.exitCode).toBe(2); expect(r.stderr.toString()).toContain('identity is invalid');
  }
  expect(existsSync(opLog)).toBe(false);
});
