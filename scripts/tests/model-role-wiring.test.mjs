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

test('routing SSOT owns the work table, sequential review and dispatch policy', () => {
  const skill = read('skills/golem-powers/agent-routing/SKILL.md');
  assert.ok(skill.indexOf('## Routing rules (SSOT)') < skill.indexOf('## Model roles'));
  assert.doesNotMatch(skill, /^## Review routing$/m);
  const text = skill.split('## Routing rules (SSOT)')[1]?.split('## Model roles')[0];
  assert.ok(text, 'routing SSOT section is required');
  assert.match(text, /single source of truth for fleet routing/);
  assert.match(text, /\| UX\/UI \| `claude.judgment` \| Codex \(`codex.implement`\)/);
  assert.match(text, /\| Security \| `codex.security` at effort `high` \| `claude.judgment` \|.*`codex-security` deep scan per security PR/);
  assert.match(text, /Security effort is `high` on the interim route/); // MF-2: canon-only rule carried into the SSOT
  assert.match(text, /When Daybreak Blue returns, evaluate its first security PRs: if they show more review rounds or more defects than the prior route, flip the pair/); // MF-1
  assert.match(text, /\| Everything else.*\| `codex.implement` \| `claude.judgment` \|/);
  assert.match(text, /only after.*implementer reports done/);
  assert.match(text, /DONE marker or report line/);
  assert.match(text, /PR head stable.*10 min.*checks finished/);
  assert.match(text, /LEAD routes the reviewer/);
  assert.match(text, /worker never starts its own/i);
  assert.match(text, /escalation path, not a gate/);
  assert.match(text, /`\/pr-loop` bot and PR reviewers are separate/);
  assert.match(text, /`\/collab-monitor`/);
  assert.match(text, /Auto-only.*never pass a model flag or model field/);
  assert.match(text, /Every non-Cursor Agent\/Workflow\/Task spawn pins its model explicitly/);
  assert.match(text, /claude.judgment.*1M/);
  assert.match(text, /pin is never removed/);
  assert.match(text, /≤2–3 concurrent Claude dispatches, staggered/);
  assert.doesNotMatch(text, /flip back to/);
  const evals = JSON.parse(read('skills/golem-powers/agent-routing/evals/evals.json')).evals;
  for (const [id, role] of [[46, 'claude.judgment'], [47, 'codex.security'], [48, 'lead'], [49, 'codex.implement']]) {
    const e = evals.find(e => e.id === id);
    assert.ok(e?.expected_output.includes(role), `eval ${id} covers ${role}`);
    assert.ok(e?.assertions.some(a => a.type === 'negative'), `eval ${id} has a negative assertion`);
  }
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
    const section = text => text.replaceAll('\\`', '`').split('## Choosing effort per phase')[1].split('## ')[0].trim();
    const phaseEffort = section(generated);
    assert.match(phaseEffort, /Effort is not in the model-roles config; the phase declares it\./);
    assert.match(phaseEffort, /48 verified runs/);
    assert.doesNotMatch(phaseEffort, /effort_note|config's effort/);
    for (const path of ['skills/golem-powers/large-plan/SKILL.md', 'skills/golem-powers/large-plan/workflows/scaffold.md', 'skills/golem-powers/large-plan/scripts/scaffold-plan.sh']) {
      assert.equal(section(read(path)), phaseEffort, path);
    }

    const staffing = generated.split('## Tools')[1].split('## Choosing effort per phase')[0];
    const lines = staffing.split('\n').filter(line => /^- \*\*(Gatherer|Implementer|Reviewer|Lookup)/.test(line));
    assert.equal(lines.length, 4);
    for (const line of lines) {
      assert.match(line, /model: <resolved model>/);
      assert.match(line, /effort: <low\|medium\|high\|xhigh\|default>/);
      assert.match(line, /why: <one line>/);
    }
    assert.doesNotMatch(staffing, /effort: medium\b/);
    const implementer = generated.split('\n').find(line => line.startsWith('- **Implementer:**'));
    assert.match(implementer, /UX\/UI phases: `claude.judgment` implements, Codex reviews; security phases: Daybreak Blue implements, `claude.judgment` reviews; see canon #1/);
    for (const path of ['skills/golem-powers/large-plan/SKILL.md', 'skills/golem-powers/large-plan/workflows/scaffold.md', 'skills/golem-powers/large-plan/scripts/scaffold-plan.sh']) {
      assert.equal(read(path).replaceAll('\\`', '`').split('\n').find(line => line.startsWith('- **Implementer:**')), implementer, path);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('packaged helper role matches config and caller-selected brain-worker stays unpinned', () => {
  const helper = read('skills/golem-powers/orc/agents/orc-helper.md').split('---')[1];
  assert.match(helper, /role: claude.subagent.cheap/);
  assert.ok(helper.includes(`model: ${config.roles['claude.subagent.cheap'].alias}`));
  assert.match(helper, /^effort: medium$/m); // benched agent-level override
  for (const role of Object.values(config.roles)) {
    assert.ok(!Object.hasOwn(role, 'effort'));
    assert.ok(!Object.hasOwn(role, 'effort_note'));
  }

  const worker = read('skills/golem-powers/orc/agents/brain-worker.md');
  assert.doesNotMatch(worker.split('---')[1], /^role:|^model:/m);
  assert.match(worker, /caller-selected role per lookup \(cheap vs judgment\)/);
  const allow = JSON.parse(read('scripts/ci/model-role-allowlist.json')).exclusions;
  const migrated = ['skills/golem-powers/agent-routing/SKILL.md', 'skills/golem-powers/large-plan/SKILL.md', 'skills/golem-powers/large-plan/workflows/scaffold.md'];
  assert.ok(allow.every(e => !migrated.includes(e.file)));
  assert.deepEqual(lint(root, config, allow).hits, []);
});
