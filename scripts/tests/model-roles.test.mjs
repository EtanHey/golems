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
test('schema forbids effort and effort notes on every role', () => {
  for (const name of [...Object.keys(config().roles), 'claude.future', 'custom.future']) {
    for (const key of ['effort', 'effort_note']) {
      const bad = config();
      bad.roles[name] ??= { model: 'future', use_for: 'lookup' };
      bad.roles[name][key] = 'high';
      const errors = validate(bad, schema());
      assert.ok(errors.length, `${name}.${key}`);
      if (key === 'effort') assert.match(errors.join('\n'), /effort does not belong in model-roles: declare it per \/large-plan phase/);
      const dir = fixture('# Role validation');
      writeFileSync(join(dir, 'standards/model-roles.json'), JSON.stringify(bad));
      writeFileSync(join(dir, 'standards/model-roles.schema.json'), JSON.stringify(schema()));
      assert.throws(() => loadConfig(dir), /unexpected property/);
    }
  }
});
test('schema requires Gemini launcher tiers and retains generic allOf and not validation', () => {
  for (const name of ['gemini.gather.text', 'gemini.gather.visual', 'gemini.future']) {
    const bad = config(); bad.roles[name] ??= { model: 'future', use_for: 'lookup' };
    delete bad.roles[name].launcher_tier;
    assert.ok(validate(bad, schema()).some(e => e.includes('launcher_tier')), name);
  }
  assert.deepEqual(validate({ ok: true }, { allOf: [{ required: ['ok'] }], not: { required: ['forbidden'] } }), []);
  assert.ok(validate({}, { allOf: [{ required: ['ok'] }] }).length);
  assert.ok(validate({ forbidden: true }, { not: { required: ['forbidden'] } }).length);
});
test('resolver known, unknown, candidate and optional fields', () => {
  const run = (...args) => spawnSync(process.execPath, [join(root, 'scripts/model-roles.mjs'), ...args], { encoding: 'utf8' });
  const known = run('claude.judgment'); assert.equal(known.status, 0); assert.equal(known.stdout, 'claude-opus-5-5\n');
  assert.equal(run('unknown').status, 2);
  const candidate = run('codex.subagent.mechanical'); assert.equal(candidate.status, 0); assert.match(candidate.stderr, /candidate: bench before use/);
  assert.equal(run('claude.subagent.cheap', '--field', 'alias').stdout, 'sonnet\n');
  const rejected = run('codex.implement', '--field', 'effort');
  assert.equal(rejected.status, 2);
  assert.equal(rejected.stdout, '');
  assert.match(rejected.stderr, /usage:.*model\|alias\|launcher_tier/);
  assert.equal(run('gemini.gather.visual', '--field', 'launcher_tier').stdout, 'flash-high\n');
  assert.equal(run('claude.judgment', '--field', 'missing').status, 2);
});
test('security implementation resolves its configured model and preserves the key gate', () => {
  const role = loadConfig().roles['codex.security'];
  assert.ok(role, 'codex.security must be a configured role');
  assert.equal(role.use_for, 'security implementation (interim Blue-less route)');
  assert.equal(role.gate, 'Daybreak Blue resumes this role when Etan has hardware keys: one-line model swap');
  const result = spawnSync(process.execPath, [join(root, 'scripts/model-roles.mjs'), 'codex.security', '--field', 'model'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${role.model}\n`);
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
