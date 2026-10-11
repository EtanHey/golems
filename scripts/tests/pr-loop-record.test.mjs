import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const record = 'Loop-record: implementer=openai/gpt-6.1-sol/medium reviewer=anthropic/claude-opus-4.8 rounds=1/0 defects=0 role=worker';
function check(body, login = 'EtanHey') {
  return spawnSync(process.execPath, ['scripts/ci/pr-loop-record.mjs'], {
    encoding: 'utf8', env: { ...process.env, PR_BODY: body, PR_AUTHOR: login },
  });
}

test('missing record is RED', () => {
  const result = check('## Summary\nNo record.');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing Loop-record/);
});
test('valid line is GREEN', () => assert.equal(check(`## Summary\n\n${record}\n`).status, 0));
test('reviewer none and zero rounds are well formed', () => assert.equal(check(record.replace('anthropic/claude-opus-4.8', 'none').replace('1/0', '0/0')).status, 0));
for (const [field, replacement] of [
  ['implementer=openai/gpt-6.1-sol/medium', 'implementer=openai/gpt-6.1-sol'],
  ['reviewer=anthropic/claude-opus-4.8', 'reviewer=anthropic'],
  ['rounds=1/0', 'rounds=one/0'],
  ['defects=0', 'defects=-1'],
  ['role=worker', 'role=reviewer'],
]) test(`malformed ${field.split('=')[0]} fails`, () => {
  const result = check(record.replace(field, replacement));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /malformed Loop-record/);
});
test('duplicate records fail', () => assert.equal(check(`${record}\n${record}`).status, 1));
test('record must be its own line', () => assert.equal(check(`Prose ${record}`).status, 1));
test('template placeholders fail', () => assert.equal(check('Loop-record: implementer=<vendor/model/effort> reviewer=<vendor/model|none> rounds=<inner>/<remote> defects=<n> role=<lead|worker>').status, 1));
test('Dependabot is exempt', () => assert.equal(check('', 'dependabot[bot]').status, 0));
test('lookalike Dependabot author is not exempt', () => assert.equal(check('', 'dependabot').status, 1));
test('CRLF body is accepted', () => assert.equal(check(`${record}\r\n`).status, 0));

test('workflow validates edited bodies through env and preserves default PR events', async () => {
  const { readFileSync } = await import('node:fs');
  const workflow = readFileSync('.github/workflows/ratchet.yml', 'utf8');
  assert.match(workflow, /pull_request:\n    types: \[opened, synchronize, reopened, edited\]/);
  assert.match(workflow, /^  ratchet:/m);
  const job = workflow.slice(workflow.indexOf('  loop-record:'), workflow.indexOf('  ratchet:'));
  assert.match(job, /if: github.event_name == 'pull_request'/);
  assert.match(job, /permissions:\n      contents: read/);
  assert.match(job, /PR_BODY: \$\{\{ github.event.pull_request.body \}\}/);
  assert.match(job, /PR_AUTHOR: \$\{\{ github.event.pull_request.user.login \}\}/);
  assert.match(job, /run: node scripts\/ci\/pr-loop-record.mjs/);
  assert.match(job, /run: node --test scripts\/tests\/pr-loop-record.test.mjs/);
  assert.doesNotMatch(job, /run:.*\$\{\{/);
});
