import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const checker = resolve(process.env.BOUNDARY_PREPUSH_CHECKER ?? 'scripts/ci/boundary-prepush.mjs');
const ip = (...parts) => parts.join('.');
const version = '0.4.0+sdk-' + ip(1, 4, 341, 0);
const cases = [
  ['Cargo build metadata', 'Cargo.lock', `version = "${version}"`, null],
  ['JSON build metadata', 'package-lock.json', `"version": "${version}"`, null],
  ['prerelease build metadata', 'poetry.lock', `version = "1.2.3-rc.1+sdk-${ip(1, 2, 3, 4)}"`, null],
  ['source address names its class', 'source.js', `const HOST = "${ip(10, 20, 30, 40)}";`, 'push-ipv4'],
  ['ssh address', 'commands.sh', `ssh ${ip(192, 168, 1, 5)}`, 'push-ipv4'],
  ['fake version wrapper', 'source.js', `version = "${ip(10, 20, 30, 40)}"`, 'push-ipv4'],
  ['address beside semver', 'Cargo.lock', `version = "${version}" # host ${ip(10, 20, 30, 40)}`, 'push-ipv4'],
  ['address before semver', 'Cargo.lock', `# host ${ip(10, 20, 30, 40)} version = "${version}"`, 'push-ipv4'],
  ['credential beside documentation address', 'source.js', `token = "${'ghp_' + 'z'.repeat(32)}"; host = "${ip(192, 0, 2, 1)}"`, 'push-credentials'],
  ['credential inside semver metadata', 'Cargo.lock', `version = "1.2.3+${'ghp_' + 'z'.repeat(32)}"`, 'push-credentials'],
  ['documentation address remains allowed', 'source.js', `const HOST = "${ip(192, 0, 2, 1)}";`, null],
];
for (const [name, file, content, violation] of cases) {
  test(name, () => {
    const root = mkdtempSync(join(tmpdir(), 'boundary-ipv4-'));
    const git = (...args) => {
      const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    try {
      git('init', '-q');
      git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.com');
      git('commit', '--allow-empty', '-qm', 'base');
      const base = git('rev-parse', 'HEAD');
      writeFileSync(join(root, file), content + '\n');
      git('add', file); git('commit', '-qm', 'candidate');
      const head = git('rev-parse', 'HEAD');
      const result = spawnSync(process.execPath, [checker], {
        cwd: root, encoding: 'utf8',
        input: `refs/heads/x ${head} refs/heads/x ${base}\n`,
      });
      assert.equal(result.status, violation ? 1 : 0, result.stderr);
      assert.ok(result.stderr.includes(violation ? `publication violation (${violation}); content withheld` : 'PASS'), result.stderr);
      assert.ok(!result.stderr.includes(content), 'diagnostic must withhold content');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
