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
