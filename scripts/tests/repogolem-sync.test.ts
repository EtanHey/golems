import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
