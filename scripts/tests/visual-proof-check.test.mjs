import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const fields = ['Desktop before', 'Desktop after', '390 px before', '390 px after', 'GIF', 'E2E screenshot diffs'];
const body = '## Visual proof\n' + fields.map(x => `${x}: [proof](https://github.com/user-attachments/assets/example)`).join('\n');
function run(PR_BODY = body, PR_LABELS = '["visual"]', PR_CHANGED_FILES = '') {
  return spawnSync(process.execPath, ['skills/golem-powers/pr-loop/scripts/visual-proof-check.mjs'], {
    env: { ...process.env, PR_BODY, PR_LABELS, PR_CHANGED_FILES }, encoding: 'utf8',
  });
}
test('non-visual passes', () => assert.equal(run('', '[]').status, 0));
test('visual label with full proof passes', () => assert.equal(run().status, 0));
for (const field of fields) test(`missing ${field} fails by name`, () => {
  const result = run(body.split('\n').filter(x => !x.startsWith(field + ':')).join('\n'));
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(field));
});
test('empty section fails', () => assert.equal(run('## Visual proof\n').status, 1));
test('path triggers without label', () => assert.equal(run('', '[]', 'packages/golems-tui/src/components/Dashboard.tsx').status, 1));
test('exact GIF exemption only', () => {
  const exempt = body.replace(/^GIF:.*$/m, 'GIF: none: no animation or interaction changed');
  assert.equal(run(exempt).status, 0);
  for (const value of ['none', 'none: no animation changed', 'none: no animation or interaction changed extra'])
    assert.equal(run(body.replace(/^GIF:.*$/m, `GIF: ${value}`)).status, 1);
});
test('placeholders, ignored paths and code fences are not proof', () => {
  for (const value of ['TODO', 'node_modules/before.png', '[proof](node_modules/before.png)', '<!-- https://github.com/user-attachments/assets/x -->'])
    assert.equal(run(body.replace(/^Desktop before:.*$/m, `Desktop before: ${value}`)).status, 1);
  assert.equal(run('```md\n' + body + '\n```').status, 1);
});
test('all committed surface globs trigger', () => {
  for (const path of ['packages/content/src/remotion/components/FadeIn.tsx', 'packages/content/remotion/src/Root.tsx', 'skills/golem-powers/html-dashboard/templates/template.html', 'skills/golem-powers/audio-dashboard/templates/decision-flow/shell.html'])
    assert.equal(run('', '[]', path).status, 1, path);
});
test('proof outside the section and malformed label data fail', () => {
  assert.equal(run('## Visual proof\n## Other\n' + body.split('\n').slice(1).join('\n')).status, 1);
  assert.equal(run(body, '{}').status, 1);
  assert.equal(run(body, 'invalid').status, 1);
});
test('required job supplies event inputs safely and reacts to labels', () => {
  const workflow = readFileSync('.github/workflows/ratchet.yml', 'utf8');
  const job = workflow.split('  loop-record:\n')[1].split('  ratchet:\n')[0];
  assert.ok(workflow.includes('edited, labeled, unlabeled]'));
  for (const expected of ['fetch-depth: 0', 'PR_BODY: ${{ github.event.pull_request.body }}',
    'PR_LABELS: ${{ toJSON(github.event.pull_request.labels.*.name) }}',
    'git diff --name-only "$BASE_SHA...$HEAD_SHA"',
    'node skills/golem-powers/pr-loop/scripts/visual-proof-check.mjs']) assert.ok(job.includes(expected), expected);
  assert.ok(!job.split('        run: |')[1].includes('${{'));
});
