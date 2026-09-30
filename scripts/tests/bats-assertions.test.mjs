import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('the non-final missing-video assertion rejects an incorrect diagnostic', t => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const source = readFileSync(new URL('./test-qa-video-dense-windows.bats', import.meta.url), 'utf8');
  const block = source.match(/^@test "dense-windows: fails cleanly on a missing video" \{[\s\S]*?^\}/m)?.[0];
  assert.ok(block, 'missing-video test must exist');
  const wrong = block.replace('*"video not found"*', '*"DELIBERATELY_ABSENT_DIAGNOSTIC"*');
  assert.notEqual(wrong, block, 'mutation must change the diagnostic assertion');
  const scratch = mkdtempSync(join(tmpdir(), 'bats-assertion-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  for (const [name, body, expected] of [['positive', block, 0], ['mutant', wrong, 1]]) {
    const fixture = join(scratch, `${name}.bats`);
    // Only the missing-video test is needed; its normal video-rendering setup
    // is irrelevant. The test body and production script remain unchanged.
    writeFileSync(fixture, 'setup() { WORK="$BATS_TEST_TMPDIR/work"; mkdir -p "$WORK"; CUES="$WORK/cues.tsv"; }\n' + body + '\n');
    const result = spawnSync('bats', ['--tap', fixture], {
      encoding: 'utf8', timeout: 30000,
      env: { ...process.env, DENSE: join(root, 'skills/golem-powers/qa-video/scripts/dense-windows.sh') },
    });
    assert.ifError(result.error);
    assert.equal(result.status, expected, `${name}: ${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, expected ? /^not ok 1 /m : /^ok 1 /m);
  }
});

const negations = [
  ['test-repogolem-dispatch.bats', 'AFTER_HTTP_TOKEN=http-token', 'output'],
  ['test-repogolem-dispatch.bats', 'AFTER_SERVER_TOKEN=server-token', 'output'],
  ['test-repogolem-dispatch.bats', 'AFTER_REGISTRY_TOKEN=registry-token', 'output'],
  ['test-repogolem-dispatch.bats', 'mcp_servers.httpRemote.env.HTTP_TOKEN', 'output'],
  ['test-repogolem-dispatch.bats', 'mcp_servers.serverRemote.env.SERVER_TOKEN', 'output'],
  ['test-repogolem-dispatch.bats', 'mkstemp failed', 'output'],
  ['test-repogolem-dispatch.bats', 'XXXXXX', 'MKTEMP_CREATED'],
  ['test-stalker-durable-failures.bats', 'LURKER_SCRIPT="$SCRIPT_DIR/twitch-chat-lurker.ts"', 'STALKER_DIR', 'test-stalker-durable-failures-parts/cases-01.bash'],
];

for (const [file, needle, input, sourceFile = file] of negations) {
  test(`non-final negation rejects a present string: ${file}: ${needle}`, t => {
    const source = readFileSync(new URL(sourceFile, import.meta.url), 'utf8');
    const assertions = source.split('\n').filter(line => /^\s*! grep /.test(line) && line.includes(needle));
    assert.equal(assertions.length, 1, 'probe must identify exactly one source assertion');
    const scratch = mkdtempSync(join(tmpdir(), 'bats-negation-'));
    t.after(() => rmSync(scratch, { recursive: true, force: true }));
    const fixture = join(scratch, 'probe.bats');
    // Reuse the source assertion verbatim. A trailing success exposes a
    // vacuous negation on both old macOS Bash and current Linux Bash.
    writeFileSync(fixture, `@test "negation" {\noutput="$PROBE_TEXT"\n${assertions[0]}\ntrue\n}\n`);
    for (const [name, text, expected] of [['positive', '', 0], ['mutant', needle, 1]]) {
      const inputFile = join(scratch, input === 'STALKER_DIR' ? 'stream-watcher.sh' : 'input');
      writeFileSync(inputFile, text + '\n');
      const result = spawnSync('bats', ['--tap', fixture], {
        encoding: 'utf8', timeout: 30000,
        env: { ...process.env, PROBE_TEXT: text, MKTEMP_CREATED: inputFile, STALKER_DIR: scratch },
      });
      assert.ifError(result.error);
      assert.equal(result.status, expected, `${name}: ${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, expected ? /^not ok 1 /m : /^ok 1 /m);
    }
  });
}
