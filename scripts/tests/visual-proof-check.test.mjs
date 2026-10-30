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

test('label events rerun real gates without job-level label skips', () => {
  const workflow = readFileSync('.github/workflows/ratchet.yml', 'utf8');
  assert.ok(workflow.includes('edited, labeled, unlabeled]'));
  const jobConditions = workflow.match(/^ {4}if:.*(?:\n(?: {6,}.*|[ \t]*$))*/gm) ?? [];
  for (const condition of jobConditions) {
    assert.doesNotMatch(condition, /\b(?:labeled|unlabeled)\b/, 'job condition must not skip real gates on label events');
  }
  const loop = workflow.split('  loop-record:\n')[1].split('  ratchet:\n')[0];
  assert.ok(loop.includes("if: github.event_name == 'pull_request'"));
});
for (const [name, input] of [
  ['unclosed fence', '```\n' + body],
  ['longer fence close', '```\n' + body + '\n````'],
  ['unclosed comment', '<!--\n' + body],
  ['inline-code links', body.replace(/(\[proof\]\([^)]+\))/g, '`$1`')],
]) test(`hidden Markdown regression: ${name}`, () => assert.equal(run(input).status, 1));
test('unclosed excluded regions fail even after visible complete proof', () => {
  for (const suffix of ['\n```', '\n<!--']) assert.equal(run(body + suffix).status, 1);
});
test('fence requires matching character and at least opener length', () => {
  for (const [open, close] of [['````', '```'], ['~~~', '```']])
    assert.equal(run(open + '\n' + body + '\n' + close).status, 1);
  assert.equal(run('````\nignored\n`````\n' + body).status, 0);
  assert.equal(run('~~~\nignored\n~~~~\n' + body).status, 0);
});
test('commented or inline-code heading does not become a real heading', () => {
  assert.equal(run(body.replace('## Visual proof', '`## Visual proof`')).status, 1);
  assert.equal(run(body.replace('## Visual proof', '<!-- hidden -->## Visual proof')).status, 1);
});
test('GitHub file URLs share private-path and traversal validation', () => {
  const prefix = 'https://github.com/EtanHey/golems/blob/c27915c9ef8eeef69b55888abe996f08740c4d1b/';
  for (const path of ['docs' + '.local/proof.png', '../../fake.png', 'node_modules/proof.png',
    '%2e%2e/fake.png', 'artifacts/%2E./fake.png', 'artifacts/%252e%252e/fake.png',
    'artifacts%2f..%2ffake.png', 'artifacts/%6eode_modules/proof.png']) {
    for (const url of [prefix + path, prefix.replace('/blob/', '/raw/') + path])
      assert.equal(run(body.replace(/^Desktop before:.*$/m, `Desktop before: [proof](${url})`)).status, 1, url);
  }
  assert.equal(run(body.replace(/^Desktop before:.*$/m, `Desktop before: [proof](${prefix}artifacts/proof.png)`)).status, 0);
});
const htmlEscapeCases = [
  ['exact pre whole-body', `<pre>\n${body}\n</pre>`, 1],
  ['single-field pre', body.replace(/^Desktop before:.*$/m, line => `<pre>\n${line}\n</pre>`), 1],
  ['textarea wrapping', `<textarea>\n${body}\n</textarea>`, 1],
  ['script wrapping', `<script>\n${body}\n</script>`, 1],
  ['unclosed pre at EOF', `<pre>\n${body}`, 1],
  ['escaped committed-relative link', body.replace(/^Desktop before:.*$/m, 'Desktop before: \\[proof](skills/golem-powers/pr-loop/SKILL.md)'), 1],
  ['ordinary proof', body, 0],
  ['CRLF proof', body.replace(/\n/g, '\r\n'), 0],
  ['longer-fence close positive', '````\nignored\n`````\n' + body, 0],
  ['nested comment opener before ordinary proof', '<!-- <!-- -->\n' + body, 0],
];
for (const [name, input, expected] of htmlEscapeCases)
  test(`HTML and escapes: ${name}`, () => assert.equal(run(input).status, expected));
test('HTML masking is case insensitive and fail-closed', () => {
  for (const tag of ['PRE', 'TeXtArEa', 'SCRIPT', 'style']) {
    assert.equal(run(`<${tag}>\n${body}\n</${tag}>`).status, 1);
    assert.equal(run(body + `\n<${tag}>`).status, 1);
    assert.equal(run(`<${tag}>ignored</${tag}>\n` + body).status, 0);
  }
  for (const tag of ['div', 'table', 'details', 'custom-block'])
    assert.equal(run(`<${tag}>\n${body}\n</${tag}>`).status, 1);
  assert.equal(run(body.replace(/^Desktop before:.*$/m, line => `<div>${line}</div>`)).status, 1);
});
test('escaped closing bracket and odd/even backslash parity', () => {
  for (const count of [1, 3]) {
    const slashes = '\\'.repeat(count);
    for (const link of [`${slashes}[proof](skills/golem-powers/pr-loop/SKILL.md)`, `[proof${slashes}](skills/golem-powers/pr-loop/SKILL.md)`])
      assert.equal(run(body.replace(/^Desktop before:.*$/m, `Desktop before: ${link}`)).status, 1);
  }
  assert.equal(run(body.replace(/^Desktop before:.*$/m, 'Desktop before: \\\\[proof](skills/golem-powers/pr-loop/SKILL.md)')).status, 0);
});
