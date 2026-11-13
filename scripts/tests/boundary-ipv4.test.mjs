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

  ['SDK multi-digit first component', 'Cargo.lock', `version = "0.4.0+sdk-${ip(110, 4, 341, 0)}"`, null],
  ['ordinary build counter', 'Cargo.lock', 'version = "1.2.3+build.5"', null],
  ['numeric build date', 'Cargo.lock', 'version = "2.0.0+20231101"', null],
  ['letter-bearing prerelease identifier', 'Cargo.lock', `version = "1.2.3-sdk-${ip(1, 4, 341, 0)}+build.5"`, null],
  ['metadata Cargo address', 'Cargo.lock', `version = "1.2.3+${ip(10, 20, 30, 40)}"`, 'push-ipv4'],
  ['metadata source address', 'source.js', `const version = "1.2.3+${ip(10, 20, 30, 40)}"`, 'push-ipv4'],
  ['metadata bare address', 'note.txt', `1.2.3+${ip(10, 20, 30, 40)}`, 'push-ipv4'],
  ['metadata yaml address', 'config.yaml', `version: 2.0.0+${ip(172, 16, 0, 1)}`, 'push-ipv4'],
  ['metadata JSON address', 'package-lock.json', `{"version": "1.0.0+${ip(10, 20, 30, 40)}"}`, 'push-ipv4'],
  ['prerelease and metadata address', 'config.toml', `1.0.0-rc.1+${ip(10, 20, 30, 40)}`, 'push-ipv4'],
  ['zero version metadata', 'note.txt', `0.0.0+${ip(10, 0, 0, 1)}`, 'push-ipv4'],
  ['query metadata', 'source.js', `http://x/?v=1.2.3+${ip(10, 0, 0, 1)}`, 'push-ipv4'],
  ['ssh metadata', 'commands.sh', `ssh root@1.2.3+${ip(10, 0, 0, 1)}`, 'push-ipv4'],
  ['prerelease address', 'Cargo.lock', `1.2.3-${ip(10, 0, 0, 1)}+b`, 'push-ipv4'],
  ['metadata suffix letter', 'note.txt', `1.2.3+${ip(10, 0, 0, 1)}x`, 'push-ipv4'],
  ['mapped semver address', 'note.txt', `::ffff:1.2.3+${ip(10, 0, 0, 1)}`, 'push-ipv4'],
  ['tab metadata address', 'note.txt', `\t1.2.3+${ip(10, 0, 0, 1)}\t`, 'push-ipv4'],
  ['tab prerelease address', 'note.txt', `\t1.2.3-${ip(10, 0, 0, 1)}+b\t`, 'push-ipv4'],
  ['v-prefixed version', 'Cargo.lock', `v1.0.0+${ip(192, 168, 1, 5)}`, 'push-ipv4'],
  ['metadata alone', 'note.txt', `+${ip(10, 0, 0, 1)}`, 'push-ipv4'],
  ['URL metadata alone', 'note.txt', `http://x/+${ip(10, 0, 0, 1)}`, 'push-ipv4'],
  ['email-shaped metadata', 'note.txt', `user+${ip(10, 1, 2, 3)}@host`, 'push-ipv4'],
  ['comma adjacent address', 'note.txt', `0.4.0+sdk-${ip(1, 4, 341, 0)},${ip(10, 0, 0, 1)}`, 'push-ipv4'],
  ['two addresses one SDK exempt', 'note.txt', `0.4.0+sdk-${ip(1, 4, 341, 0)} ${ip(10, 0, 0, 1)} ${ip(192, 168, 1, 5)}`, 'push-ipv4'],
  ['mapped address', 'note.txt', `::ffff:${ip(10, 0, 0, 1)}`, 'push-ipv4'],
  ['four part version and metadata', 'Cargo.lock', `${ip(10, 0, 0, 1)}+1.2.3+b`, 'push-ipv4'],
  ['four part build version', 'Cargo.lock', `${ip(10, 0, 0, 1)}+build`, 'push-ipv4'],
  ['double plus', 'note.txt', `1.2.3+a+${ip(10, 0, 0, 1)}`, 'push-ipv4'],
  ['resolved tarball', 'package-lock.json', `resolved = http://${ip(10, 0, 0, 5)}/x.tgz`, 'push-ipv4'],
  ['tarball version path', 'note.txt', `http://${ip(10, 0, 0, 5)}/x-1.2.3+b.tgz`, 'push-ipv4'],
  ['path metadata', 'note.txt', `http://x/p-1.2.3+${ip(10, 0, 0, 5)}`, 'push-ipv4'],
  ['Cargo source address', 'Cargo.lock', `source = "git+http://${ip(10, 0, 0, 5)}/repo#abc"`, 'push-ipv4'],
  ['overlapping SDK run', 'Cargo.lock', `0.4.0+sdk-${ip(10, 0, 0, 1)}.2`, 'push-ipv4'],
  ['separate metadata run', 'Cargo.lock', `0.4.0+sdk-1.${ip(10, 0, 0, 1)}`, 'push-ipv4'],
  ['separate prerelease run', 'Cargo.lock', `1.2.3-sdk-1.${ip(10, 0, 0, 1)}+b`, 'push-ipv4'],

  ['projection function assignment', 'source.ts', 'const projection = projectStructured' + 'Speech("fixture");', null],
  ['projection awaited function', 'source.ts', 'const projection = await projectStructured' + 'Speech("fixture");', null],
  ['project named long function', 'source.ts', 'const project = projectStructured' + 'Speech("fixture");', null],
  ['real shaped quoted project ref', 'config.env', 'project_ref = "' + 'abcdefghij' + '0123456789' + '"', 'real-identifiers'],
  ['real shaped unquoted project id', 'config.env', 'SUPABASE_PROJECT_ID=' + 'abcdefghij' + 'klmnopqrst', 'real-identifiers'],
  ['real shaped colon project id', 'config.json', '{"projectId":"' + 'abcdefghij' + 'klmnopqrst' + '"}', 'real-identifiers'],

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
