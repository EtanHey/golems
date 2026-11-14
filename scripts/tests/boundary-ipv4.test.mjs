import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const checker = resolve(process.env.BOUNDARY_PREPUSH_CHECKER ?? 'scripts/ci/boundary-prepush.mjs');
const ip = (...parts) => parts.join('.');
const version = '0.4.0+sdk-' + ip(1, 4, 341, 0);
const cases = [
  ['JDK five-part log version', 'formal/run.log', `Running on Homebrew ${ip(27, 0, 1, 0, 3)} (Mac OS X 26.1 aarch64)`, 'push-ipv4'],
  ['five-part numeric version', 'note.txt', ip(1, 2, 3, 4, 5), 'push-ipv4'],
  ['five-part private-looking version', 'note.txt', `version ${ip(10, 0, 0, 1, 2)}`, 'push-ipv4'],
  ['product word does not exempt address', 'note.txt', `Homebrew ${ip(10, 20, 30, 40)}`, 'push-ipv4'],
  ['sentence-final dot', 'note.txt', `host ${ip(192, 168, 1, 5)}.`, 'push-ipv4'],
  ['address with port', 'note.txt', `${ip(10, 0, 0, 1)}:8080`, 'push-ipv4'],
  ['parenthesized address', 'note.txt', `(${ip(10, 0, 0, 1)})`, 'push-ipv4'],
  ['address with assignment and comma', 'note.txt', `ip=${ip(172, 16, 0, 1)},`, 'push-ipv4'],
  ['address after longer version', 'note.txt', `${ip(1, 2, 3, 4, 5)} ${ip(10, 0, 0, 1)}`, 'push-ipv4'],
  ['address before longer version', 'note.txt', `${ip(10, 0, 0, 1)} ${ip(1, 2, 3, 4, 5)}`, 'push-ipv4'],
  ['six-part numeric version', 'note.txt', ip(1, 2, 3, 4, 5, 6), 'push-ipv4'],
  ['dot before address', 'note.txt', `.${ip(10, 0, 0, 1)}`, 'push-ipv4'],
  ['nonnumeric dotted prefix', 'note.txt', `host.${ip(10, 0, 0, 1)}`, 'push-ipv4'],
  ['nonnumeric dotted suffix', 'note.txt', `${ip(10, 0, 0, 1)}.host`, 'push-ipv4'],
  ['long numeric prefix in five-part version', 'note.txt', ip(1000, 1, 2, 3, 4), 'push-ipv4'],
  ['long numeric suffix in five-part version', 'note.txt', ip(1, 2, 3, 4, 1000), 'push-ipv4'],
  ['two longer versions', 'note.txt', `${ip(1, 2, 3, 4, 5)} ${ip(6, 7, 8, 9, 0)}`, 'push-ipv4'],
  ['comma after longer version', 'note.txt', `${ip(1, 2, 3, 4, 5)},${ip(10, 0, 0, 1)}`, 'push-ipv4'],
  ['credential beside longer version', 'note.txt', `${ip(1, 2, 3, 4, 5)} ${'ghp_' + 'z'.repeat(32)}`, 'push-credentials'],
  ['prerelease-only five-part run', 'Cargo.lock', `1.2.3-sdk-${ip(10, 0, 0, 1, 2)}`, 'push-ipv4'],
  ['metadata numeric five-part run', 'Cargo.lock', `1.2.3+${ip(10, 0, 0, 1, 2)}`, 'push-ipv4'],
  ['v-prefixed metadata five-part run', 'Cargo.lock', `v1.2.3+sdk-${ip(10, 0, 0, 1, 2)}`, 'push-ipv4'],
  ['package-prefixed semver five-part run', 'note.txt', `pkg-1.2.3+sdk-${ip(10, 0, 0, 1, 2)}`, 'push-ipv4'],
  ['word-glued semver five-part run', 'note.txt', `pkg1.2.3+sdk-${ip(10, 0, 0, 1, 2)}`, 'push-ipv4'],
  ['plain version after semver token', 'note.txt', `1.2.3+build ${ip(27, 0, 1, 0, 3)}`, 'push-ipv4'],
  ['netstat dotted ports', 'formal/network.log', `tcp4 0 0 ${ip(10, 20, 30, 40, 51234)} ${ip(93, 184, 216, 34, 443)} ESTABLISHED`, 'push-ipv4'],
  ['tcpdump dotted ports', 'formal/network.log', `IP ${ip(10, 20, 30, 40, 51234)} > ${ip(93, 184, 216, 34, 443)}: Flags [S]`, 'push-ipv4'],
  ['syslog dotted port', 'note.txt', `connection from ${ip(10, 20, 30, 40, 55555)} refused`, 'push-ipv4'],
  ['TLC runtime tuple', 'formal/run.log', `Running breadth-first search Model-Checking with fp 0 and seed 2 with 1 worker on 8 cores with 512MB heap and 64MB offheap memory [pid: 1234] (Mac OS X 26.1 aarch64, Homebrew ${ip(28, 1, 2, 3, 4)} 64bit, MSBDiskFPSet, DiskStateQueue).`, null],
  ['vendor version architecture residual', 'note.txt', `Homebrew ${ip(10, 20, 30, 40, 5)} aarch64`, null],
  ['four parts after vendor and before architecture', 'note.txt', `Homebrew ${ip(10, 20, 30, 40)} aarch64`, 'push-ipv4'],
  ['unknown vendor five-part run', 'note.txt', `UnknownJDK ${ip(10, 20, 30, 40, 5)} aarch64`, 'push-ipv4'],
  ['vendor glued to word', 'note.txt', `NotHomebrew ${ip(10, 20, 30, 40, 5)} aarch64`, 'push-ipv4'],
  ['version without architecture', 'note.txt', `Homebrew ${ip(10, 20, 30, 40, 5)}`, 'push-ipv4'],
  ['architecture glued suffix', 'note.txt', `Homebrew ${ip(10, 20, 30, 40, 5)} aarch64host`, 'push-ipv4'],
  ['address after allowed header slot', 'note.txt', `Homebrew ${ip(28, 1, 2, 3, 4)} aarch64 ${ip(10, 20, 30, 40)}`, 'push-ipv4'],
  ['address before allowed header slot', 'note.txt', `${ip(10, 20, 30, 40)} Homebrew ${ip(28, 1, 2, 3, 4)} aarch64`, 'push-ipv4'],
  ['credential beside allowed header slot', 'note.txt', `Homebrew ${ip(28, 1, 2, 3, 4)} aarch64 ${'ghp_' + 'z'.repeat(32)}`, 'push-credentials'],
  ['TLC2 version header', 'formal/run.log', `TLC2 Version ${ip(2027, 11, 12, 123456)} (rev: abc1234)`, null],
  ['TLC2 address-slot residual', 'note.txt', `TLC2 Version ${ip(10, 20, 30, 40)} (rev: abc1234)`, null],
  ['TLC2 missing revision suffix', 'note.txt', `TLC2 Version ${ip(10, 20, 30, 40)}`, 'push-ipv4'],
  ['TLC2 missing literal prefix', 'note.txt', `Version ${ip(10, 20, 30, 40)} (rev: abc1234)`, 'push-ipv4'],
  ['TLC2 revision too short', 'note.txt', `TLC2 Version ${ip(10, 20, 30, 40)} (rev: abc123)`, 'push-ipv4'],
  ['TLC2 revision too long', 'note.txt', `TLC2 Version ${ip(10, 20, 30, 40)} (rev: ${'a'.repeat(41)})`, 'push-ipv4'],
  ['TLC2 nonhex revision', 'note.txt', `TLC2 Version ${ip(10, 20, 30, 40)} (rev: abc123g)`, 'push-ipv4'],
  ['address beside TLC2 header', 'note.txt', `TLC2 Version ${ip(2027, 11, 12, 123456)} (rev: abc1234) ${ip(10, 20, 30, 40)}`, 'push-ipv4'],
  ['credential beside TLC2 header', 'note.txt', `TLC2 Version ${ip(2027, 11, 12, 123456)} (rev: abc1234) ${'ghp_' + 'z'.repeat(32)}`, 'push-credentials'],
  ['Cargo build metadata', 'Cargo.lock', `version = "${version}"`, null],
  ['JSON build metadata', 'package-lock.json', `"version": "${version}"`, null],
  ['prerelease build metadata address', 'poetry.lock', `version = "1.2.3-rc.1+sdk-${ip(1, 2, 3, 4)}"`, 'push-ipv4'],
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

  ['letter-glued SDK private address', 'Cargo.lock', `1.2.3+sdk-${ip(10, 0, 0, 1)}`, 'push-ipv4'],
  ['letter-glued a private address', 'Cargo.lock', `1.2.3+a-${ip(192, 168, 1, 5)}`, 'push-ipv4'],
  ['letter-glued SDK public address', 'Cargo.lock', `1.2.3+sdk-${ip(8, 8, 8, 8)}`, 'push-ipv4'],
  ['letter-glued prerelease address', 'Cargo.lock', `1.2.3-sdk-${ip(10, 0, 0, 1)}+b`, 'push-ipv4'],
  ['letter-glued nested identifier address', 'Cargo.lock', `1.2.3+a-b-${ip(10, 0, 0, 1)}`, 'push-ipv4'],
  ['letter-glued address with suffix', 'Cargo.lock', `1.2.3+sdk-${ip(10, 0, 0, 1)}-b`, 'push-ipv4'],
  ['digit-letter-glued address', 'Cargo.lock', `1.2.3+1sdk-${ip(10, 0, 0, 1)}`, 'push-ipv4'],

  ['projection function assignment', 'source.ts', 'const projection = projectStructured' + 'Speech("fixture");', null],
  ['projection awaited function', 'source.ts', 'const projection = await projectStructured' + 'Speech("fixture");', null],
  ['project named long function', 'source.ts', 'const project = projectStructured' + 'Speech("fixture");', null],
  ['real shaped quoted project ref', 'config.env', 'project_ref = "' + 'abcdefghij' + '0123456789' + '"', 'real-identifiers'],
  ['real shaped unquoted project id', 'config.env', 'SUPABASE_PROJECT_ID=' + 'abcdefghij' + 'klmnopqrst', 'real-identifiers'],
  ['real shaped colon project id', 'config.json', '{"projectId":"' + 'abcdefghij' + 'klmnopqrst' + '"}', 'real-identifiers'],

];
for (const vendor of ['Homebrew', 'Oracle Corporation', 'Eclipse Adoptium', 'Azul Systems', 'Amazon.com Inc.', 'Temurin', 'GraalVM']) {
  for (const arch of ['aarch64', 'x86_64', 'amd64', '64bit']) {
    cases.push([`JVM vendor ${vendor} ${arch}`, 'formal/run.log', `${vendor} ${ip(28, 1, 2, 3, 4, 5)} ${arch}`, null]);
  }
}
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
      mkdirSync(dirname(join(root, file)), { recursive: true });
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
