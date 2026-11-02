import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertions } from '../ci/check-bats-bash32.mjs';

const bare = '@test "probe" {\n  [[ false == true ]]\n  true\n}\n';
test('finds non-final assertions in Bats and split functions', () => {
  for (const opening of ['@test "probe"', 'function split_case_001()', 'helper()']) {
    assert.deepEqual(assertions(bare.replace('@test "probe"', opening)), [2]);
  }
});
test('accepts guarded, final, conditional and commented assertions', () => {
  for (const body of ['[[ a == b ]] || false\ntrue', '[[ a == b ]]',
    'if [[ a == b ]]; then\ntrue\nfi', '# [[ a == b ]]\ntrue']) {
    assert.deepEqual(assertions(`@test "probe" {\n${body}\n}\n`), []);
  }
});
test('heredoc braces do not end the enclosing function', () => {
  assert.deepEqual(assertions('helper() {\ncat <<\'SH\'\n}\nSH\n[[ a == b ]]\ntrue\n}\n'), [5]);
});
test('real Bats exposes the Bash 3.2 non-final assertion trap', t => {
  mkdirSync(join(process.cwd(), 'docs.local'), { recursive: true });
  const scratch = mkdtempSync(join(process.cwd(), 'docs.local/r16-proof-'));
  t.after(() => rmSync(scratch, { recursive: true }));
  const fixture = join(scratch, 'probe.bats');
  const bash = process.env.BATS_PROOF_BASH || '/bin/bash';
  const version = spawnSync(bash, ['-c', 'echo "$BASH_VERSINFO"'], { encoding: 'utf8' });
  assert.equal(version.status, 0);
  const major = Number(version.stdout.trim());
  for (const guarded of [false, true]) {
    writeFileSync(fixture, guarded ? bare.replace(']]', ']] || false') : bare);
    const result = spawnSync(bash, ['-c', 'exec "$BASH" "$(command -v bats)" --tap "$1"', '_', fixture], { encoding: 'utf8',
      env: { ...process.env, PATH: `${dirname(bash)}:${process.env.PATH}` },
    });
    assert.ifError(result.error);
    assert.equal(result.status, guarded || major >= 4 ? 1 : 0, result.stdout + result.stderr);
    t.diagnostic(`Bash ${major}, guarded=${guarded}: ${result.stdout.trim()}`);
  }
});

test('CLI rejects tracked Bats and split-part violations and accepts their fixes', t => {
  mkdirSync(join(process.cwd(), 'docs.local'), { recursive: true });
  const scratch = mkdtempSync(join(process.cwd(), 'docs.local/r16-lint-'));
  t.after(() => rmSync(scratch, { recursive: true }));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: scratch, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  git('init', '-q');
  mkdirSync(join(scratch, 'probe-parts'));
  writeFileSync(join(scratch, 'probe.bats'), bare);
  writeFileSync(join(scratch, 'probe-parts/case.bash'), bare.replace('@test "probe"', 'function split_case_001()'));
  git('add', '.');
  const checker = new URL('../ci/check-bats-bash32.mjs', import.meta.url);
  const run = () => spawnSync(process.execPath, [checker.pathname], { cwd: scratch, encoding: 'utf8' });
  const bad = run();
  assert.equal(bad.status, 1, bad.stderr);
  assert.match(bad.stderr, /probe\.bats:2:/);
  assert.match(bad.stderr, /probe-parts\/case\.bash:2:/);
  for (const name of ['probe.bats', 'probe-parts/case.bash'])
    writeFileSync(join(scratch, name), bare.replace(']]', ']] || false'));
  const good = run();
  assert.equal(good.status, 0, good.stderr);
});
