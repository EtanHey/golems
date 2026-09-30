import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validate, lint, loadConfig } from '../ci/check-model-role-drift.mjs';
const root = new URL('../../', import.meta.url).pathname;
const config = () => JSON.parse(readFileSync(join(root, 'standards/model-roles.json')));
const schema = () => JSON.parse(readFileSync(join(root, 'standards/model-roles.schema.json')));
const dirs = [];
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));
function fixture(text, file = 'skills/example/SKILL.md') {
  mkdirSync(join(root, 'docs.local/cx27'), { recursive: true });
  const dir = mkdtempSync(join(root, 'docs.local/cx27/fixture-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'standards'), { recursive: true });
  mkdirSync(join(dir, 'skills/example/agents'), { recursive: true });
  writeFileSync(join(dir, file), text);
  return dir;
}
test('schema accepts canonical config and rejects invalid contracts', () => {
  assert.deepEqual(validate(config(), schema()), []);
  for (const mutate of [c => delete c.schema, c => delete c.roles,
    c => delete c.roles['claude.judgment'].model,
    c => c.roles['claude.judgment'].status = 'unmeasured',
    c => c.roles['claude.judgment'].use_for = 7]) {
    const bad = config(); mutate(bad); assert.ok(validate(bad, schema()).length);
  }
});
test('schema requires effort for every Claude/Codex role and forbids Gemini effort', () => {
  for (const name of Object.keys(config().roles).filter(n => /^(claude|codex)\./.test(n))) {
    const bad = config(); delete bad.roles[name].effort;
    assert.ok(validate(bad, schema()).length, name);
    const dir = fixture('# Role effort validation');
    writeFileSync(join(dir, 'standards/model-roles.json'), JSON.stringify(bad));
    writeFileSync(join(dir, 'standards/model-roles.schema.json'), JSON.stringify(schema()));
    assert.throws(() => loadConfig(dir), /effort/);
  }
  for (const name of ['gemini.gather.text', 'gemini.gather.visual']) {
    const bad = config(); bad.roles[name].effort = 'high';
    assert.ok(validate(bad, schema()).length, name);
  }
  const future = config(); future.roles['claude.future'] = { model: 'future', use_for: 'lookup' };
  assert.ok(validate(future, schema()).length);
  const changed = config(); changed.roles['claude.subagent.cheap'].effort = 'default';
  assert.deepEqual(validate(changed, schema()), []);
});
test('resolver known, unknown, candidate and optional fields', () => {
  const run = (...args) => spawnSync(process.execPath, [join(root, 'scripts/model-roles.mjs'), ...args], { encoding: 'utf8' });
  const known = run('claude.judgment'); assert.equal(known.status, 0); assert.equal(known.stdout, 'claude-opus-5-5\n');
  assert.equal(run('unknown').status, 2);
  const candidate = run('codex.subagent.mechanical'); assert.equal(candidate.status, 0); assert.match(candidate.stderr, /candidate: bench before use/);
  assert.equal(run('claude.subagent.cheap', '--field', 'alias').stdout, 'sonnet\n');
  assert.equal(run('codex.implement', '--field', 'effort').stdout, 'medium\n');
  assert.equal(run('claude.subagent.cheap', '--field', 'effort').stdout, 'default\n');
  assert.equal(run('codex.subagent.mechanical', '--field', 'effort').stdout, 'low\n');
  assert.equal(run('gemini.gather.visual', '--field', 'launcher_tier').stdout, 'flash-high\n');
  assert.equal(run('claude.judgment', '--field', 'missing').status, 2);
});
test('prescriptions fail including CLI tiers and agent frontmatter', () => {
  for (const text of ['Use `gpt-6.1-sol` for implementation.', '`-m flash-high`', 'UX judgment stays on Opus.', 'Opus implements; Codex reviews.', 'Agent routing: Claude → Sonnet', '---\nmodel: sonnet\n---']) {
    const result = lint(fixture(text), config(), []); assert.equal(result.hits.length, 1, text);
  }
});
test('evidence sections and same-line dated history pass with notices', () => {
  const result = lint(fixture('# Evidence\nUse gpt-6.1-sol\n## Subsection\nUse gpt-6-luna\n# Instructions\n2026-09-30: use sonnet'), config(), []);
  assert.equal(result.hits.length, 0); assert.equal(result.exemptions.length, 3);
  assert.equal(lint(fixture('# Evidence\nUse gpt-6-luna\n# Instructions\nUse gpt-6-luna'), config(), []).hits.length, 1);
});
test('content-marker exclusions are explicit and validate reasons', () => {
  const dir = fixture('Use gpt-6.1-sol');
  const allow = [{ file: 'skills/example/SKILL.md', marker: 'Use gpt-6.1-sol', reason: 'PR2-wiring' }];
  const result = lint(dir, config(), allow); assert.equal(result.hits.length, 0); assert.equal(result.exemptions.length, 1);
  assert.throws(() => lint(dir, config(), [{ ...allow[0], reason: '' }]), /reason/);
});
test('declared agent role enforces alias and cannot be allowlisted away', () => {
  const file = 'skills/example/agents/worker.md';
  const text = '---\nrole: claude.subagent.cheap\nmodel: opus\n---';
  assert.equal(lint(fixture(text, file), config(), [{ file, marker: 'model: opus', reason: 'PR2-wiring' }]).hits.length, 1);
  assert.equal(lint(fixture(text.replace('opus', 'sonnet'), file), config(), []).hits.length, 0);
  assert.equal(lint(fixture(text.replace('claude.subagent.cheap', 'unknown'), file), config(), []).hits.length, 1);
});
test('agents without a role emit migration notice', () => {
  const result = lint(fixture('---\nmodel: sonnet\n---', 'skills/example/agents/worker.md'), config(), []);
  assert.equal(result.hits.length, 0); assert.match(result.notices.join('\n'), /without role/);
});
