import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const checker = resolve(process.env.BOUNDARY_PREPUSH_CHECKER ?? 'scripts/ci/boundary-prepush.mjs');
const names = [
  'sk-ssh-ed25519@openssh.com', 'ssh-ed25519-cert-v01@openssh.com',
  'sk-ecdsa-sha2-nistp256@openssh.com', 'sk-ssh-ed25519-cert-v01@openssh.com',
  'sk-ecdsa-sha2-nistp256-cert-v01@openssh.com',
  'ecdsa-sha2-nistp256-cert-v01@openssh.com',
  'ecdsa-sha2-nistp384-cert-v01@openssh.com',
  'ecdsa-sha2-nistp521-cert-v01@openssh.com', 'ssh-rsa-cert-v01@openssh.com',
];
// Two labels before the reserved namespace deliberately stay outside the
// policy's one-label fixture exemption, so these still exercise refusal.
// Use boundary-prepush.test.mjs's adverse-fixture assembly convention. All
// public algorithm identifiers above remain whole literal strings.
const adverse = [
  ['fixture', 'unit.fixture.example'],
  ['sk-ssh-ed25519', 'openssh.com.evil.test'],
  ['xsk-ssh-ed25519', 'unit.fixture.example'],
  ['ssh-ed25519-cert-v02', 'unit.fixture.example'],
].map(parts => parts.join('@'));
adverse.push('sk-ssh-ed25519@openssh.com,' + adverse[0]);
test('r1 adverse address fixtures use reserved namespaces', () => {
  for (const value of adverse) {
    for (const [token, domain] of value.matchAll(/[^\s,@]+@([^\s,]+)/g)) {
      // Exact public algorithm tokens are public names, not adverse mailboxes.
      if (names.includes(token)) continue;
      assert.match(domain, /\.(example|test|invalid)$/);
    }
  }
});
for (const [index, content] of [...names, ...adverse].entries()) {
  const allowed = index < names.length;
  test(`row3 ${allowed ? 'public algorithm' : 'adverse mailbox'} ${index}`, () => {
    const root = mkdtempSync(join(tmpdir(), 'boundary-openssh-'));
    const git = (...args) => {
      const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
    };
    try {
      git('init', '-q'); git('config', 'user.name', 'Fixture');
      git('config', 'user.email', 'fixture@example.com');
      git('commit', '--allow-empty', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
      writeFileSync(join(root, 'names.txt'), content + '\n');
      git('add', '.'); git('commit', '-qm', 'candidate');
      const r = spawnSync(process.execPath, [checker], { cwd: root, encoding: 'utf8',
        input: `refs/heads/main ${git('rev-parse', 'HEAD')} refs/heads/main ${base}\n` });
      assert.equal(r.status, allowed ? 0 : 1, r.stderr);
      if (!allowed) assert.match(r.stderr, /publication violation \(identity-pii\)/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
