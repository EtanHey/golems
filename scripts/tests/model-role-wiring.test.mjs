import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { lint } from '../ci/check-model-role-drift.mjs';
const root = new URL('../../', import.meta.url).pathname;
const read = p => readFileSync(join(root, p), 'utf8');
const config = JSON.parse(read('standards/model-roles.json'));
const roles = ['codex.implement', 'claude.judgment', 'claude.subagent.cheap', 'gemini.gather.text', 'gemini.gather.visual'];

test('agent-routing evals cover cheap recall, judgment deletion and visual gathering', () => {
  const suite = JSON.parse(read('skills/golem-powers/agent-routing/evals/evals.json'));
  assert.equal(new Set(suite.evals.map(e => e.id)).size, suite.evals.length);
  for (const [name, role] of [['single-fact-role-brain-worker', 'claude.subagent.cheap'], ['deletion-role-judgment', 'claude.judgment'], ['visual-frame-batch-role', 'gemini.gather.visual']]) {
    const e = suite.evals.find(e => e.name === name);
    assert.ok(e?.prompt); assert.ok(e.expected_output.includes(role));
    assert.ok(e.assertions.some(a => a.type === 'negative'));
    assert.ok(e.assertions.some(a => a.type === 'behavioral' && a.text.includes(role)));
  }
  const text = read('skills/golem-powers/agent-routing/SKILL.md');
  for (const role of roles) assert.ok(text.includes(role));
  assert.match(text, /instead of the judgment seat's own context/);
  assert.match(text, /high-stakes history only/);
});

test('large-plan generated phases and authored templates retain config-driven staffing', () => {
  const parent = join(root, 'docs.local/cx28'); mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, 'scaffold-'));
  try {
    const run = spawnSync('bash', [join(root, 'skills/golem-powers/large-plan/scripts/scaffold-plan.sh'), dir, 'role-wiring', '2'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    for (const text of [readFileSync(join(dir, 'phase-1/README.md'), 'utf8'), readFileSync(join(dir, 'phase-2/README.md'), 'utf8'), read('skills/golem-powers/large-plan/SKILL.md'), read('skills/golem-powers/large-plan/workflows/scaffold.md'), read('skills/golem-powers/large-plan/workflows/collab.md')]) {
      for (const role of roles) assert.ok(text.includes(role), role);
      assert.ok(text.includes('standards/model-roles.json'));
      assert.ok(text.includes('scripts/model-roles.mjs'));
    }
    const generated = readFileSync(join(dir, 'phase-1/README.md'), 'utf8');
    const staffing = generated.split('## Tools')[1].split('## Choosing effort per phase')[0];
    const lines = staffing.split('\n').filter(line => /^- \*\*(Gatherer|Implementer|Reviewer|Lookup)/.test(line));
    assert.equal(lines.length, 4);
    for (const line of lines) {
      assert.match(line, /model: <resolved model>/);
      assert.match(line, /effort: <low\|medium\|high\|xhigh\|default>/);
      assert.match(line, /why: <one line>/);
    }
    assert.doesNotMatch(staffing, /effort: medium\b/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('packaged helper role matches config and caller-selected brain-worker stays unpinned', () => {
  const helper = read('skills/golem-powers/orc/agents/orc-helper.md').split('---')[1];
  assert.match(helper, /role: claude.subagent.cheap/);
  assert.ok(helper.includes(`model: ${config.roles['claude.subagent.cheap'].alias}`));
  assert.doesNotMatch(helper, /^effort:/m); // role default omits the flag

  const worker = read('skills/golem-powers/orc/agents/brain-worker.md');
  assert.doesNotMatch(worker.split('---')[1], /^role:|^model:/m);
  assert.match(worker, /caller-selected role per lookup \(cheap vs judgment\)/);
  const allow = JSON.parse(read('scripts/ci/model-role-allowlist.json')).exclusions;
  const migrated = ['skills/golem-powers/agent-routing/SKILL.md', 'skills/golem-powers/large-plan/SKILL.md', 'skills/golem-powers/large-plan/workflows/scaffold.md'];
  assert.ok(allow.every(e => !migrated.includes(e.file)));
  assert.deepEqual(lint(root, config, allow).hits, []);
});
