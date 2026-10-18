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
      assert.match(text, /`\/agent-routing`.*Routing rules \(SSOT\)/);
      assert.ok(text.includes('standards/model-roles.json'));
      assert.ok(text.includes('scripts/model-roles.mjs'));
    }
    const generated = readFileSync(join(dir, 'phase-1/README.md'), 'utf8');
    for (const text of [generated, readFileSync(join(dir, 'phase-2/README.md'), 'utf8'), read('skills/golem-powers/large-plan/workflows/scaffold.md')]) {
      assert.match(text, /## Invariant test\n- \*\*Invariant:\*\* \[behavior this slice must preserve\]\n- \*\*Test:\*\* \[command or case proving it before READY\]/);
    }
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
    assert.match(implementer, /role selected via `\/agent-routing` § Routing rules \(SSOT\)/);
    assert.doesNotMatch(staffing, /Daybreak Blue implements|Claude reviews|Codex reviews/);
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


test('M1 dispatch keeps the proof scope, live memory gate and cmux fallback', () => {
  const text = read('skills/golem-powers/agent-routing/SKILL.md').split('## Dispatch Boundaries')[1].split('## Lead Topology')[0];
  for (const rule of ['M1 (T3)', 'only when the deliverable must be proven on the M1', 'Codex workers only', 'recorded Claude-in-T3 proof passes', 'one real `brain_search` result, one skill invoked, no hook errors', 'same-turn BrainBar probe: the socket accepts and `brain_search` answers', 'failed probe is reported to the lead and the work stays in cmux', 'Leads never move']) assert.ok(text.includes(rule), rule);
});

test('lead topology records model and tier-change reason', () => {
  const text = read('skills/golem-powers/agent-routing/SKILL.md').split('## Lead Topology')[1].split('## Goal Contract')[0];
  assert.ok(text.includes("6. A lead's model is written in its lane brief, golem-id and claim post; a mid-sprint tier change names its reason (budget | quality | stall)."));
});

test('short plans use the same skeleton and multi-PR plans declare invariant tests and chain span', () => {
  const text = read('skills/golem-powers/large-plan/SKILL.md');
  for (const rule of ['ALWAYS use `/large-plan` for planning', 'a few lines', 'same skeleton', 'Each slice of a multi-PR plan declares its invariant test', 'chain span as its convergence metric']) assert.ok(text.includes(rule), rule);
  assert.match(text, /## Invariant test/);
});

test('weave evals exercise rejected M1 routes, lead provenance and short/multi-PR planning', () => {
  for (const [skill, names] of [['agent-routing', ['m1-proof-dispatch', 'm1-long-running-only', 'm1-failed-brainbar-probe', 'm1-claude-startup-ready', 'lead-model-tier-change']], ['large-plan', ['short-plan-same-skeleton', 'multi-pr-invariant-chain-span']]]) {
    const suite = JSON.parse(read(`skills/golem-powers/${skill}/evals/evals.json`));
    assert.equal(new Set(suite.evals.map(e => e.id)).size, suite.evals.length);
    if (skill === 'agent-routing') assert.doesNotMatch(JSON.stringify(suite.evals.find(e => e.id === 54)), /three-lane pilot/);
    for (const name of names) {
      const e = suite.evals.find(e => e.name === name);
      assert.ok(e?.prompt && e.expected_output, name);
      assert.ok(e.assertions.length >= 2, name);
    }
  }
});


test('large-plan install scope includes short work', () => {
  const text = read('skills/golem-powers/large-plan/INSTALL_PROMPT.md');
  assert.match(text, /ALWAYS use.*planning/);
  assert.match(text, /short work.*few lines.*same skeleton/);
  assert.doesNotMatch(text, /NOT for: single-file changes/);
});

test('agent-routing has a first-class T3-native child lifecycle and keeps cmux as an adapter', () => {
  const skill = read('skills/golem-powers/agent-routing/SKILL.md');
  const fanOut = skill.split('## Fan-out engine')[1].split('\n## ')[0];
  assert.match(fanOut, /\| .*T3 `delegate_task`.*\|/);
  assert.doesNotMatch(fanOut, /\| Visible, multi-vendor, long-running, human-watchable workers \| cmux fleet/);
  const t3 = skill.split('## T3-native dispatch')[1]?.split('\n## ')[0];
  assert.ok(t3, 'T3-native dispatch section is required');
  assert.ok(t3.trim().split('\n').length <= 20, 'T3-native dispatch section stays <=20 lines');
  assert.match(t3, /references\/t3-native\.md/);
  assert.match(skill.split('## Read Map')[1].split('\n## ')[0], /references\/t3-native\.md/);
  const boundaries = skill.split('## Dispatch Boundaries')[1].split('## Lead Topology')[0];
  const cmux = boundaries.split('### cmux adapter')[1];
  assert.ok(cmux, 'cmux adapter sub-heading is required');
  for (const kept of ['cmux fleet (`/cmux-agents`)', 'Visible-worker launch law lives in fleet canon #6', 'Codex children may edit only inside their visible Codex parent\'s worktree']) assert.ok(cmux.includes(kept), kept);
  const owners = skill.split('## Cross-Skill Ownership')[1];
  assert.match(owners, /`\/collab-monitor`: cmux\/collab-mail only.*T3 children.*completion notifications/);

  const ref = read('skills/golem-powers/agent-routing/references/t3-native.md');
  for (const rule of [
    '`orchestrator_capabilities`', 'never a native tool\'s model list', 'canon #5',
    '`delegate_task`', '`taskId`', '`clientRequestId`', '`isolation: "worktree"`', 'committed', 'gitignored', 'absolute paths',
    'end the turn', 'verify the artifact',
    'NEW `delegate_task`', 'prior findings', '`childThreadId`', '`t3_thread_send`',
    '`hasPendingQuestion`', '"workers never ask Etan routing questions"', '(Etan 2026-10-18, via orc collab)',
    '`t3_thread_launch`', '`create_threads`', '`link_pull_request`', '`watch_pull_request`', 'parent-owned',
    'Lead Topology #5',
  ]) assert.ok(ref.includes(rule), rule);
  assert.doesNotMatch(ref, /at most 4 Codex workers|No Codex session lives past one PR/, 'point to Lead Topology, do not restate it');

  // Review r1 MAJOR: task completion (status/workState/summary) is separate from later child-thread runs.
  assert.doesNotMatch(ref, /`hasPendingChildRuns` means the child is not finished/);
  const onWake = ref.split('## 4.')[1].split('\n## ')[0];
  for (const rule of ['`workState`', '`result_available`', '`waiting_for_children`', '`summary`', 'stable', '`hasPendingChildRuns`', 'does not reopen', '`task_cancel`']) assert.ok(onWake.includes(rule), rule);
  assert.match(onWake, /`hasPendingChildRuns`[^\n]*(?:\n[^\n]+)*not a reason to (?:delay|wait)/);

  // Review r1 BLOCKING: delegation-operations monitor loop + no-worktree are the cmux adapter; T3 readers go to t3-native.md.
  const readMap = skill.split('## Read Map')[1].split('\n## ')[0];
  const opsLine = readMap.split('\n').find(l => l.includes('references/delegation-operations.md'));
  assert.match(opsLine, /cmux/);
  const t3Line = readMap.split('\n').find(l => l.includes('references/t3-native.md'));
  assert.match(t3Line, /owns the T3 (?:child )?lifecycle/);
  assert.match(t3Line, /not delegation-operations\.md|instead of .*delegation-operations\.md/);
  const ops = read('skills/golem-powers/agent-routing/references/delegation-operations.md');
  assert.match(ops, /\*\*Adapter scope\.\*\*[^\n]*cmux[^\n]*references\/t3-native\.md|\*\*Adapter scope\.\*\*[\s\S]{0,400}t3-native\.md/);
  const monitorLine = ops.split('\n').find(l => l.includes('own monitor loop'));
  assert.match(monitorLine, /cmux/);
  const seqRow = ops.split('\n').find(l => l.startsWith('| Sequential specialist'));
  assert.match(seqRow, /cmux/);
  assert.match(ops, /\| T3 child[^\n]*`isolation: "worktree"`/);

  const suite = JSON.parse(read('skills/golem-powers/agent-routing/evals/evals.json'));
  assert.equal(new Set(suite.evals.map(e => e.id)).size, suite.evals.length);
  for (const [id, name] of [[80, 't3-review-round-new-delegate-task'], [81, 't3-dispatch-worker-lifecycle'], [82, 't3-child-done-verify-before-relay'], [83, 't3-new-thread-vs-subagent'], [84, 't3-completed-with-pending-child-runs']]) {
    const e = suite.evals.find(e => e.id === id);
    assert.equal(e?.name, name);
    assert.ok(e.prompt && e.expected_output, name);
    assert.ok(e.assertions.some(a => a.type === 'negative'), name);
  }
});
