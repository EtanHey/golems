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


test('M1 is a test rig only; the proof gate is a dormant adapter until Etan authorizes the rig', () => {
  const text = read('skills/golem-powers/agent-routing/SKILL.md').split('## Dispatch Boundaries')[1].split('## Lead Topology')[0];
  for (const rule of [
    '"**The M1 Pro becomes a TEST RIG only.** Development stays on the MBP. … Nothing changes on the M1 for this yet." (Etan 2026-10-18, via orc collab)',
    'until Etan authorizes the rig setup', 'docs.local/reports/2026-10-18/m1-rig/', 'stays on the MBP',
  ]) assert.ok(text.includes(rule), rule);
  assert.doesNotMatch(text, /^- M1 \(T3\): a lead routes a worker to the M1/m);
  const rig = text.split('### M1 test-rig adapter')[1];
  assert.ok(rig, 'M1 test-rig adapter sub-heading is required');
  for (const rule of ['only when the deliverable must be proven on the M1', 'Codex workers only', 'recorded Claude-in-T3 proof passes', 'one real `brain_search` result, one skill invoked, no hook errors', 'same-turn BrainBar probe: the socket accepts and `brain_search` answers', 'failed probe is reported to the lead and the work stays on the MBP', 'Leads never move']) assert.ok(rig.includes(rule), rule);
});

test('routing SSOT carries the dated flip trial, risk-sized review and the Codex model list', () => {
  const skill = read('skills/golem-powers/agent-routing/SKILL.md');
  const ssot = skill.split('## Routing rules (SSOT)')[1].split('## Model roles')[0];
  const impl = ssot.split('### Implementation and review')[1].split('\n### ')[0];
  const trial = impl.split('#### Trial: flipped implement/review (2026-10-18 → review 2026-10-22)')[1];
  assert.ok(trial, 'dated trial block is required');
  assert.ok(trial.indexOf('| Work | Implements | Reviews | Plus |') > 0, 'trial block sits directly above the permanent table');
  const block = trial.split('| Work | Implements | Reviews | Plus |')[0];
  for (const rule of [
    '"**EXPERIMENT, starting now for a few days: FLIP the roles.** Claude Opus 5.5 IMPLEMENTS and Codex gpt-6.1-sol REVIEWS." (Etan 2026-10-18, via orc collab)',
    '"Track it in your STATUS: PRs merged per day, hours from open to merge, defects caught after merge. We compare at the end." (Etan 2026-10-18, via orc collab)',
    '`claude.judgment` implements', '`codex.implement` reviews at effort `high`', 'UX/UI and Security rows are unchanged',
    'merged/day', 'open→merge hours', 'post-merge defects', 'expires', 'permanent table',
  ]) assert.ok(block.includes(rule), rule);
  const sizing = ssot.split('### Review sizing')[1]?.split('\n### ')[0];
  assert.ok(sizing, 'review sizing section is required');
  for (const rule of [
    '"XS/S: 1 reviewer, 1 round." (Etan 2026-10-18, via orc collab)',
    '"Full panel only for L, data or security paths, and that panel = Opus + Cursor working as a team. **NO Gemini Argon as a reviewer** (it fabricates)." (Etan 2026-10-18, via orc collab)',
    'M: up to 2 rounds',
    '"a Codex worker uses computer use to record the changed states (default, hover, clicked, …), then hands the recording to an Opus reviewer."',
    '"That reviewer loads the frontend-design skill (`frontend-design:frontend-design`, the latest Anthropic one) and judges the UX/UI."',
  ]) assert.ok(sizing.includes(rule), rule);
  const pins = ssot.split('### Model pins and dispatch')[1];
  for (const rule of [
    '"**Models:** Codex = gpt-6.1-sol and gpt-6-luna ONLY."', '"**Never gpt-5.6-\\*** (luna, sol, terra)"', '"gpt-6-astra only when Etan asks for it."',
    '`codex.implement`', '`codex.subagent.mechanical`', 'refused',
  ]) assert.ok(pins.includes(rule), rule);
  // Review r1 BLOCKING: explicit interim UI precedence (lead decision) next to the UI bullet.
  const uiLine = sizing.split('\n').find(l => l.startsWith('- UI precedence (interim'));
  assert.ok(uiLine, 'dated interim UI precedence line is required');
  for (const rule of ['skill-lead interim', 'pending Etan', 'takes precedence over the table', 'evidence', 'functional defect', 'not "the reviewer"', 'ONE reviewer', 'fresh Opus', 'never the implementer', 'XS/S', 'M UI PRs: up to 2 rounds', 'full panel']) assert.ok(uiLine.includes(rule), rule);
  const matrix = skill.split('## Role Matrix')[1].split('### Evidence')[0];
  assert.match(matrix, /3\. Code or file changes follow the Routing rules \(SSOT\) table.*dated trial/);
  const suite = JSON.parse(read('skills/golem-powers/agent-routing/evals/evals.json'));
  assert.equal(new Set(suite.evals.map(e => e.id)).size, suite.evals.length);
  for (const [id, name] of [[90, 'trial-refactor-opus-implements-sol-reviews'], [91, 'refuse-gpt-5-6-pin'], [92, 'astra-only-on-etan-ask'], [93, 'l-data-path-opus-cursor-panel-no-argon'], [94, 'ui-pr-recorded-states-frontend-design'], [95, 'm1-test-rig-only'], [96, 'xs-ui-pr-one-opus-reviewer-codex-records'], [97, 'astra-on-etan-explicit-ask']]) {
    const e = suite.evals.find(e => e.id === id);
    assert.equal(e?.name, name);
    assert.ok(e.prompt && e.expected_output, name);
    assert.ok(e.assertions.some(a => a.type === 'negative'), name);
  }
  // Review r1 MAJOR: eval 92 is a lead's suggestion, not Etan's ask; eval 54 asserts MBP, not cmux.
  const e92 = suite.evals.find(e => e.id === 92);
  assert.match(e92.prompt, /lead/i);
  assert.match(e92.prompt, /Etan has not/);
  const e54 = suite.evals.find(e => e.id === 54);
  assert.ok(e54.assertions.some(a => /MBP/.test(a.text) && /M1 proof/.test(a.text)), 'eval 54 asserts MBP with the M1-proof restriction');
  assert.ok(!e54.assertions.some(a => /cmux/.test(a.text)), 'eval 54 no longer requires cmux');
});

test('large-plan staffing lines resolve through the SSOT including any dated trial and the Codex model list', () => {
  for (const path of ['skills/golem-powers/large-plan/SKILL.md', 'skills/golem-powers/large-plan/workflows/scaffold.md', 'skills/golem-powers/large-plan/scripts/scaffold-plan.sh']) {
    const lines = read(path).replaceAll('\\`', '`').split('\n');
    assert.match(lines.find(l => l.startsWith('- **Implementer:**')), /Routing rules \(SSOT\), including any dated trial>/, path);
    assert.match(lines.find(l => l.startsWith('- **Reviewer / decisions:**')), /including any dated trial and review sizing>/, path);
    assert.match(lines.find(l => l.startsWith('- **Config:**')), /Codex dispatches use only the allowed Codex models in `\/agent-routing` § Model pins and dispatch\./, path);
  }
});

test('lead topology records model and tier-change reason', () => {
  const text = read('skills/golem-powers/agent-routing/SKILL.md').split('## Lead Topology')[1].split('## Goal Contract')[0];
  assert.ok(text.includes("6. A lead's model is written in its lane brief, golem-id and claim post; a mid-sprint tier change names its reason (budget | quality | stall)."));
});

test('one PR = one fresh implementer replaces lane-wide worker reuse', () => {
  const skill = read('skills/golem-powers/agent-routing/SKILL.md');
  const topology = skill.split('## Lead Topology')[1].split('## Goal Contract')[0];
  const goal = skill.split('## Goal Contract')[1].split('## Cross-Skill Ownership')[0];
  for (const rule of [
    '**One PR = one fresh implementer.**',
    'Dependent stacks are no exception',
    '"No Codex session lives past one PR, or ~100 turns. After that, start a fresh delegate with a short brief and a compact checkpoint. Never re-inject full plans or logs."',
    '"reviewers fresh per implementer (same PR may reuse them)"',
    '"at most 4 Codex workers running at once per lead"',
    '"it re-uses workers instead of settling and opening new ones, like that ship 2246 chat that had 25 prs, 24 merged"',
    '(Etan 2026-10-18, via orc collab)',
    'settle',
  ]) assert.ok(topology.includes(rule), rule);
  assert.doesNotMatch(topology, /follow-ups on its own diff/);
  assert.doesNotMatch(goal, /continue the same lane/);
  assert.match(goal, /a new PR gets a fresh implementer/);
  assert.ok(skill.includes('Keep to ≤2–3 concurrent Claude dispatches, staggered.'));
  const ops = read('skills/golem-powers/agent-routing/references/delegation-operations.md');
  assert.doesNotMatch(ops, /Reuse before spawn|do not fork the lane/);
  assert.match(ops, /\*\*One PR = one fresh implementer\.\*\*/);
  const incidents = read('skills/golem-powers/agent-routing/references/verification-and-incidents.md');
  assert.doesNotMatch(incidents, /Reuse managed workers/);
  assert.doesNotMatch(incidents, /existing managed worker, reuse that `agent_id`/);
  assert.doesNotMatch(incidents, /supersede the same worker with the full mission/);
  assert.match(incidents, /supersede only within the same PR/);
  assert.match(incidents, /additional PR gets a fresh implementer with a compact checkpoint/);
  const suite = JSON.parse(read('skills/golem-powers/agent-routing/evals/evals.json'));
  for (const name of ['fresh-implementer-next-pr-idle-worker', 'same-pr-review-fix-reuses-implementer', 'codex-turn-cap-fresh-delegate', 'codex-concurrency-cap-queue-fifth']) {
    const e = suite.evals.find(e => e.name === name);
    assert.ok(e?.prompt && e.expected_output, name);
    assert.ok(e.assertions.some(a => a.type === 'negative'), name);
  }
  assert.doesNotMatch(JSON.stringify(suite.evals.find(e => e.id === 15)), /Reuses the existing `brainlayerCodex` worker unless/);
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

test('legacy agent-routing evals agree with the SSOT: allowed Codex models, risk-sized UI review, dated trial cases', () => {
  const suite = JSON.parse(read('skills/golem-powers/agent-routing/evals/evals.json'));
  const byId = id => suite.evals.find(e => e.id === id);
  // Codex = gpt-6.1-sol and gpt-6-luna only; Astra only on Etan's own ask. Any other Codex model
  // named in an eval's expected output or assertions must sit in a rejection sentence.
  const allowed = new Set(['gpt-6.1-sol', 'gpt-6-luna']);
  const rejects = /\b(reject\w*|refus\w*|ban\w*|remov\w*|never|not|no)\b/i;
  for (const e of suite.evals) {
    const texts = [e.expected_output, ...e.assertions.map(a => a.text ?? a.description ?? '')];
    for (const text of texts) {
      for (const sentence of text.split(/(?<=[.;])\s+/)) {
        for (const m of sentence.matchAll(/\bgpt-[0-9][\w.]*(?:-[a-z]+)*|\bspark\b/gi)) {
          const model = m[0].toLowerCase().replace(/[.*]+$/, '');
          if (allowed.has(model)) continue;
          if (model === 'gpt-6-astra' && /^Etan\b/.test(e.prompt)) continue;
          assert.match(sentence, rejects, `eval ${e.id} names non-allowed Codex model ${m[0]} outside a rejection: ${sentence}`);
        }
      }
    }
  }
  // Eval 46: UI review is sized; a Codex reviewer only in the L/data/security full panel.
  const e46 = JSON.stringify(byId(46));
  assert.match(e46, /size:\*/);
  assert.match(e46, /frontend-design:frontend-design/);
  assert.match(e46, /full panel/);
  assert.doesNotMatch(e46, /Codex with the codex\.implement model to review/);
  // Eval 14: Spark is no longer allowed for internal children.
  assert.doesNotMatch(JSON.stringify(byId(14)), /Allows Spark/);
  // Codex-implements answers for "everything else" are explicitly dated after the trial.
  for (const id of [9, 34, 49]) assert.match(byId(id).prompt, /2026-10-26.*trial.*expired/s, `eval ${id} is dated post-trial`);
  // Trial-agnostic implementer wording where the point is "not the lead, not Cursor".
  for (const id of [2, 3, 5, 8, 22]) assert.match(JSON.stringify(byId(id)), /dated trial/, `eval ${id} names the trial implementer`);
  // M1: failed probe stays on the MBP; nothing moves before Etan authorizes the rig.
  assert.match(JSON.stringify(byId(55)), /MBP/);
  assert.doesNotMatch(JSON.stringify(byId(55)), /cmux/);
  assert.match(JSON.stringify(byId(56)), /authorizes the rig/);
});
