import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync, execSync } from 'node:child_process';
import { lint } from '../ci/check-model-role-drift.mjs';
const root = new URL('../../', import.meta.url).pathname;
const read = p => readFileSync(join(root, p), 'utf8');
const config = JSON.parse(read('standards/model-roles.json'));
const roles = ['codex.implement', 'claude.judgment', 'claude.subagent.cheap', 'claude.subagent.mechanical', 'gemini.gather.text', 'gemini.gather.visual'];

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
  assert.doesNotMatch(text, /Sonnet 5\.5 otherwise/);
  assert.match(text, /\| Holistic\/product work \(.*\| `claude.judgment` \(Opus; Sonnet\/Haiku only as sub-agents for trivial wording edits\), 2026-10-29 \| Codex Sol \(`codex.implement`\) \|/);
  assert.match(text, /\| Narrow technical work \(.*\| Codex Sol \(hard\) \/ Terra \(bounded\), 2026-10-29 \| `claude.judgment` \|/);
  assert.doesNotMatch(text, /\| Everything else/);
  assert.doesNotMatch(text, /only Sol reviews a Claude implementation/);
  // RT-3: the reviewer is always the other vendor; no same-vendor review exception survives.
  assert.match(text, /The reviewer is always the other vendor\./);
  assert.doesNotMatch(text, /same-vendor (review )?exception|Sol or Opus only, whichever|Claude reviews Claude|Codex reviews Codex/i);
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
  assert.match(text, /Claude concurrency .*fleet canon #5 owns the numbers/);
  assert.doesNotMatch(text, /2–3 concurrent Claude dispatches/);
  const canon = read('standards/fleet-canon.md');
  assert.match(canon, /at most 5 parallel Claude lead tracks fleet-wide, normally 3-4/);
  assert.ok(canon.includes('maybe 3-5 leads parallel at a time might have to be the max? since they also use claudes for review and implementations?'));
  const roleMap = config.roles;
  for (const id of ['claude.judgment', 'claude.subagent.cheap', 'claude.subagent.mechanical']) {
    assert.ok(id in roleMap, `${id} must exist in model-roles.json`);
    assert.ok(canon.includes('`' + id + '`'), `canon #5 must name ${id}`);
  }
  assert.match(canon, /<=2 `claude\.judgment`.*<=2 `claude\.subagent\.cheap`, <=4 `claude\.subagent\.mechanical`.*<=20% of the rolling 5h/s);
  assert.match(canon, /7-slot `claude\.judgment` ceiling with leads/);
  assert.match(canon, />=60% no new Claude workers and <=2 active leads/);
  assert.match(canon, />=80% no Claude workers and <=1 essential lead turn/);
  assert.match(canon, /<=6 weekly points per 5h window until the weekly reset/);
  assert.ok(canon.includes('(provisional until the first fresh-session window shows a non-zero 1h-cache write share; then re-derive)'));
  assert.match(canon, /every account actually serving/);
  assert.match(canon, /Stale, unknown or\s+rejected telemetry counts as NO headroom/);
  assert.match(canon, /weekly rejection overrides five-hour\s+headroom/);
  assert.match(canon, /used% x 300 \/ elapsed-minutes > 80/);
  assert.doesNotMatch(canon, /tier->model/);
  for (const f of execSync("git ls-files 'skills/**/*.md'", { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)) {
    assert.doesNotMatch(read(f), /canon #5[^\n]{0,80}2[-–]3|2[-–]3[^\n]{0,80}canon #5/i, `${f} restates the old 2-3 cap`);
  }
  assert.doesNotMatch(canon, /2-3 concurrent Claude dispatches/);
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
  const deploy = read('skills/golem-powers/orc/agents/deploy-local-prod.md').split('---')[1];
  assert.match(deploy, /^role: claude.subagent.cheap$/m);
  assert.ok(deploy.includes(`model: ${config.roles['claude.subagent.cheap'].alias}`));
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


test('M1 test placement keeps admission and vendor proof gates', () => {
  const text = read('skills/golem-powers/agent-routing/SKILL.md').split('## Dispatch Boundaries')[1].split('## Lead Topology')[0];
  for (const rule of [
    '"**The M1 Pro becomes a TEST RIG only.** Development stays on the MBP. … Nothing changes on the M1 for this yet." (Etan 2026-10-18, via orc collab)',
    '2026-10-28', '≥10 GiB guard', 'max 3 heavy lanes', 'never during a sync window', 'PHX admission required', 'Quick focused unit tests stay local', 'stays on the MBP',
  ]) assert.ok(text.includes(rule), rule);
  assert.doesNotMatch(text, /^- M1 \(T3\): a lead routes a worker to the M1/m);
  const rig = text.split('### M1 test-rig adapter')[1];
  assert.ok(rig, 'M1 test-rig adapter sub-heading is required');
  for (const rule of ['Codex workers only', 'recorded Claude-in-T3 proof passes', 'real `brain_search`, one skill invoked, no hook errors', 'same-turn BrainBar probe: the socket accepts and `brain_search` answers', 'failed probe is reported to the lead; the work stays on the MBP', 'Leads never move']) assert.ok(rig.includes(rule), rule);
});

test('routing SSOT carries the dated flip trial, risk-sized review and the Codex model list', () => {
  const skill = read('skills/golem-powers/agent-routing/SKILL.md');
  const ssot = skill.split('## Routing rules (SSOT)')[1].split('## Model roles')[0];
  const impl = ssot.split('### Implementation and review')[1].split('\n### ')[0];
  const trial = impl.split('#### Implementation default (Etan, 2026-10-29)')[1];
  assert.ok(trial, 'dated trial block is required');
  assert.ok(trial.indexOf('| Work | Implements | Reviews | Plus |') > 0, 'trial block sits directly above the permanent table');
  const block = trial.split('| Work | Implements | Reviews | Plus |')[0];
  for (const rule of [
    '"**EXPERIMENT, starting now for a few days: FLIP the roles.** Claude Opus 5.5 IMPLEMENTS and Codex gpt-6.1-sol REVIEWS." (Etan 2026-10-18, via orc collab)',
    '"Track it in your STATUS: PRs merged per day, hours from open to merge, defects caught after merge. We compare at the end." (Etan 2026-10-18, via orc collab)',
    'Default implementers (2026-10-29,', 'holistic/product work', 'Claude Opus implements. Sonnet/Haiku never implement', 'Narrow technical work', 'Codex implements (Sol hard, Terra bounded)', 'Reviewers (2026-10-29) are always the other vendor', 'Gemini/Antigravity gather and never review', 'Sonnet 5.5 is a valid worker tier', 'Never fast/priority', 'fresh context', 'bounded lifetime', 'explicit effort', 'serviceTier:"default"', 'Claude only', 'does not revert at a window reset',
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
    'gpt-6.1-sol, gpt-6-luna and gpt-6.1-terra are allowed', '"**Never gpt-5.6-\\*** (luna, sol, terra)"', '"gpt-6-astra only when Etan asks for it."',
    'configured candidate gates', 'RT-2', 'refused',
  ]) assert.ok(pins.includes(rule), rule);
  // The frontend flow adds taste review while preserving cross-vendor review.
  const uiLine = sizing.split('\n').find(l => l.startsWith('- UI flow (Etan FRONTEND RULE'));
  assert.ok(uiLine, 'frontend UI flow line is required');
  for (const rule of ['2026-10-28', 'red-team Claude', 'BOTH skills', "the table's Codex reviewer (cross-vendor, canon #1)", 'Codex plumbing', 'already the other vendor', 'Both reviews cite the Visual proof']) assert.ok(uiLine.includes(rule), rule);
  for (const rule of ['never the implementer', 'frontend-design:frontend-design', 'emil-design-eng', 'round caps', 'full panel']) assert.ok(sizing.includes(rule), rule);
  const matrix = skill.split('## Role Matrix')[1].split('### Evidence')[0];
  assert.match(matrix, /3\. Code or file changes follow the Routing rules \(SSOT\) table.*Codex Sol.*Terra/);
  const suite = JSON.parse(read('skills/golem-powers/agent-routing/evals/evals.json'));
  assert.equal(new Set(suite.evals.map(e => e.id)).size, suite.evals.length);
  for (const [id, name] of [[90, 'rebalance-refactor-codex-implements-opus-reviews'], [91, 'refuse-gpt-5-6-pin'], [92, 'astra-only-on-etan-ask'], [93, 'l-data-path-opus-cursor-panel-no-argon'], [94, 'ui-pr-recorded-states-frontend-design'], [95, 'm1-test-rig-only'], [96, 'xs-ui-pr-claude-taste-plus-codex-review'], [97, 'astra-on-etan-explicit-ask']]) {
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
  assert.ok(e54.assertions.some(a => /MBP/.test(a.text) && /test work/.test(a.text)), 'eval 54 asserts MBP with the M1-proof restriction');
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
  assert.ok(skill.includes('fleet canon #5 owns the numbers'));
  assert.ok(!skill.includes('2–3 concurrent Claude dispatches'));
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

test('large-plan defaults to T3-native execution and keeps cmux monitors as an adapter', () => {
  const dir = 'skills/golem-powers/large-plan';
  const skill = read(`${dir}/SKILL.md`);
  const t3 = skill.split('### T3-native execution (default in T3)')[1]?.split('\n### cmux adapter: parallel rounds')[0];
  assert.ok(t3, 'T3-native execution section precedes the cmux adapter');
  for (const rule of [
    'agent-routing/references/t3-native.md', '`delegate_task`', '`taskId`', 'completion notification is the liveness guard',
    'no collab monitor', '`ScheduleWakeup`', '`CronCreate`', 'end the turn', 'verify the artifact',
    '`watch_pull_request`', '`codex.subagent.mechanical`', 'deadline', 'single terminal report',
    'never owns the parent\'s PR watch', '`task_cancel`', '`unwatch_pull_request`', '(Etan 2026-10-18, via orc collab)',
  ]) assert.ok(t3.includes(rule), rule);
  const cmux = skill.split('### cmux adapter: parallel rounds')[1].split('### Plan Lifecycle')[0];
  assert.ok(cmux.includes('Arms the addressed monitor'), 'round monitor procedure lives under the cmux adapter');
  const parallel = skill.split('## Parallel Execution')[1].split('\n## ')[0];
  assert.ok(parallel.indexOf('### cmux adapter: orchestrator duties') < parallel.indexOf('**The orchestrator MUST:**'), 'parallel monitor procedure lives under the cmux adapter');
  const table = skill.split('## Platform Features')[1].split('\n## ')[0];
  assert.match(table, /\| Feature \| T3 \(default in T3\) \| cmux adapter: Claude Code \| cmux adapter: universal fallback \|/);
  for (const cell of ['`delegate_task`', 'Completion notification', '`watch_pull_request`', '`unwatch_pull_request`', '`task_cancel`']) assert.ok(table.includes(cell), cell);
  for (const path of [`${dir}/SKILL.md`, `${dir}/adapters/codex.md`, `${dir}/adapters/claude.md`, `${dir}/adapters/capabilities.yaml`, `${dir}/workflows/collab.md`]) {
    const text = read(path);
    assert.doesNotMatch(text, /Codex uses packaged|Codex seats use (its|the) packaged|collab-monitor\.sh (start|follow)/, `${path}: Codex seats run no collab monitor`);
  }
  assert.ok(read(`${dir}/adapters/codex.md`).includes('Codex seats must not poll collabs; T3 delegate completions already wake you.'));
  const arm = read(`${dir}/workflows/collab.md`).split('### 4. Arm addressed watches')[1].split('### 5.')[0];
  assert.ok(arm.includes('**T3 (default in T3):**') && arm.includes('**cmux adapter:**'), 'collab step 4 branches T3 vs cmux');
  const suite = JSON.parse(read(`${dir}/evals/evals.json`));
  assert.equal(new Set(suite.evals.map(e => e.id)).size, suite.evals.length);
  for (const [id, name] of [[30, 't3-next-batch-delegate-no-guards'], [31, 't3-ci-watch-parent-or-bounded-child'], [32, 'codex-lead-refuses-collab-monitor'], [33, 'cmux-fleet-keeps-monitor-adapter']]) {
    const e = suite.evals.find(e => e.id === id);
    assert.equal(e?.name, name);
    assert.ok(e.prompt && e.expected_output && e.assertions.length >= 2, name);
  }
  // Review round 1: generated collab/kickoff instructions carry no polling cadence; cmux cadence is labelled.
  const collab = read(`${dir}/workflows/collab.md`);
  const scaffoldDoc = read(`${dir}/workflows/scaffold.md`);
  const header = collab.split('## Collab File Structure (MANDATORY)')[1].split('## References')[0];
  assert.ok(header.includes('completion notification') && header.includes('`watch_pull_request`'), 'collab header template wakes on notifications');
  const kickoff = scaffoldDoc.split('### Kickoff Prompt:')[1].split('Start now.')[0];
  assert.ok(kickoff.includes('completion notification') && kickoff.includes('`watch_pull_request`'), 'kickoff prompt wakes on notifications');
  const pollParent = join(root, 'docs.local/cx28'); mkdirSync(pollParent, { recursive: true });
  const scaffoldDir = mkdtempSync(join(pollParent, 'poll-'));
  try {
    assert.equal(spawnSync('bash', [join(root, `${dir}/scripts/scaffold-plan.sh`), scaffoldDir, 'poll-check', '2'], { encoding: 'utf8' }).status, 0);
    const generated = [readFileSync(join(scaffoldDir, 'phase-1/README.md'), 'utf8'), readFileSync(join(scaffoldDir, 'phase-2/README.md'), 'utf8')];
    const polling = /every (\[?N\]?|\d+) min|poll (reviews|the collab|collab)|read (this|the) (collab )?file every|\/loop \d|CronCreate\(|ScheduleWakeup\(/i;
    for (const [where, text] of [['collab header', header], ['kickoff prompt', kickoff], ['scaffold header rule', scaffoldDoc.split('**Mandatory sections to fill at scaffold time')[1].split('**Additional sections')[0]], ...generated.map((t, i) => [`generated phase-${i + 1}`, t])]) {
      assert.doesNotMatch(text, polling, `${where}: no polling cadence in generated instructions`);
    }
    for (const path of [`${dir}/SKILL.md`, `${dir}/workflows/collab.md`, `${dir}/workflows/scaffold.md`, `${dir}/workflows/execute-phase.md`, `${dir}/adapters/claude.md`, `${dir}/adapters/codex.md`]) {
      for (const para of read(path).split(/\n\s*\n/).filter(p => polling.test(p) || /30\+ min|30-minute expiry|keep polling/i.test(p))) {
        assert.match(para, /cmux adapter|never|Does not|Do not poll|No polling|must not poll/i, `${path}: cadence must be labelled cmux adapter: ${para}`);
      }
    }
  } finally { rmSync(scaffoldDir, { recursive: true, force: true }); }
  // Old evals 4-5 distinguish T3 completion notifications from the cmux adapter; none reward /loop or CronCreate.
  for (const id of [4, 5]) {
    const e = suite.evals.find(e => e.id === id);
    assert.ok(e.expected_output.includes('completion notification') && e.expected_output.includes('cmux adapter'), `eval ${id} expected_output branches T3 vs cmux adapter`);
    assert.doesNotMatch(e.expected_output, /\/loop|CronCreate/, `eval ${id} expected_output does not reward /loop or CronCreate`);
    for (const a of e.assertions) {
      if (/\/loop|CronCreate|ScheduleWakeup/.test(a.description)) assert.match(a.name, /-negative$/, `eval ${id} ${a.name}: polling only as a negative`);
    }
    assert.ok(e.assertions.some(a => a.description.includes('completion notification')), `eval ${id} asserts the T3 completion notification`);
    assert.ok(e.assertions.some(a => a.description.includes('cmux adapter')), `eval ${id} asserts the cmux adapter branch`);
  }
  // Watcher recipe resolves through the PR10 contract, not a self-declared authorisation.
  for (const path of [`${dir}/SKILL.md`, `${dir}/adapters/codex.md`]) {
    assert.ok(read(path).includes('node scripts/model-roles.mjs codex.subagent.mechanical --use watcher'), `${path}: watcher role resolves via --use watcher`);
  }
  assert.doesNotMatch(skill, /this ruling is the authorisation for the watch use/);
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
  for (const kept of ['cmux fleet (`/cmux-agents`)', 'Visible-worker launch law lives in fleet canon #6', 'Codex workers edit only their delegated worktree; their Claude lead owns acceptance']) assert.ok(cmux.includes(kept), kept);
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

// Codex = gpt-6.1-sol and gpt-6-luna only; Astra only on Etan's own explicit request. Every other
// Codex model mention (gpt-*, Spark, Astra) anywhere in an agent-routing eval must match an exact
// (eval id, field, sentence) row below, each reviewed with its reason. No natural-language exemptions:
// a new mention needs a deliberate, reviewable edit to this table (#803 review r1, lead decision).
const PINNED_CODEX_MODEL_MENTIONS = [
  [9, 'prompt', 'Also tell me whether GPT-5.4-mini should be the default fast path.', 'user asks about an off-list model; eval checks it is refused'],
  [9, 'expected_output', 'Spark is rejected outright, even as an explicit `-m gpt-5.3-codex-spark` override: it is not on the Codex model list (gpt-6.1-sol, gpt-6-luna and gpt-6.1-terra, Etan 2026-10-28).', 'rejects Spark'],
  [9, 'expected_output', 'GPT-5.4-mini must be rejected as the routine default for Codex work.', 'rejects GPT-5.4-mini'],
  [9, 'assertions[2].text', 'If Spark comes up, rejects it even as an explicit `-m gpt-5.3-codex-spark` override, because it is not on the Codex model list', 'rejects Spark'],
  [9, 'assertions[3].text', 'Rejects GPT-5.4-mini as the routine default path for Codex work', 'rejects GPT-5.4-mini'],
  [9, 'assertions[5].text', 'Does NOT route either job to Spark or any model off the Codex model list', 'negative assertion against Spark'],
  [14, 'prompt', 'Internal ephemeral subagent spawned from inside an agent session: `spawn_agent({"agent_type":"worker", "model":"gpt-5.3-codex-spark", "message":"small implementation"})`\n\nWhich one is allowed, and what should each be rewritten to?', 'user shows a Spark spawn; eval checks it is rejected'],
  [14, 'expected_output', 'Should also reject B: being an internal ephemeral subagent does not unlock Spark, which is not on the Codex model list (gpt-6.1-sol, gpt-6-luna and gpt-6.1-terra, Etan 2026-10-28).', 'rejects Spark'],
  [14, 'assertions[4].text', "Rejects B's `gpt-5.3-codex-spark` model too, and rewrites B to a role resolved through `node scripts/model-roles.mjs` (codex.implement, or codex.subagent.mechanical under its gated exceptions)", 'rejects Spark'],
  [14, 'assertions[5].text', 'Does NOT allow Spark (or any model off the Codex model list) for the internal subagent, even by explicit model selection', 'negative assertion against Spark'],
  [91, 'name', 'refuse-gpt-5-6-pin', 'eval name for the gpt-5.6 refusal'],
  [91, 'prompt', "Use gpt-5.6-sol for this Codex worker, it's cheaper.", 'user asks for a forbidden pin; eval checks it is refused'],
  [91, 'expected_output', 'Refuse the pin: Codex allows gpt-6.1-sol, gpt-6-luna and gpt-6.1-terra, never gpt-5.6-* (Etan 2026-10-28).', 'refuses gpt-5.6-*'],
  [91, 'expected_output', 'Dispatch with codex.implement resolved through node scripts/model-roles.mjs, and remove any gpt-5.6-* pin you own.', 'removes gpt-5.6-* pins'],
  [91, 'assertions[0].text', 'Resolves the worker through codex.implement (or a gated codex.subagent.mechanical use), not a gpt-5.6-* model.', 'rejects gpt-5.6-*'],
  [91, 'assertions[1].text', 'Does NOT dispatch with any gpt-5.6-* model, even when a T3 catalog lists it or cost is the reason.', 'negative assertion against gpt-5.6-*'],
  [92, 'name', 'astra-only-on-etan-ask', 'eval name for the Astra gate'],
  [92, 'prompt', 'Let\'s get astra to look at it." Etan has not asked for Astra.', 'a lead suggests Astra; eval checks it is refused'],
  [92, 'expected_output', "No Astra: gpt-6-astra runs only on Etan's own explicit request, and here only a lead suggested it.", 'refuses Astra without Etan\'s ask'],
  [92, 'assertions[0].text', 'Keeps the review on the SSOT-routed roles, or asks Etan, without dispatching Astra.', 'refuses Astra'],
  [92, 'assertions[1].text', "Does NOT dispatch gpt-6-astra without Etan's own explicit request.", 'negative assertion against Astra'],
  [97, 'name', 'astra-on-etan-explicit-ask', 'eval name for the Astra exception'],
  [97, 'prompt', 'Etan, directly: "Use gpt-6-astra for this review of the race in the scheduler.', 'Etan\'s own explicit request for Astra (reviewed wording)'],
  [97, 'expected_output', 'Allowed: Etan himself explicitly asked for Astra, the one exception in the Codex model list.', 'Astra allowed only because of the pinned prompt'],
  [97, 'expected_output', 'Dispatch the reviewer on gpt-6-astra via delegate_task (model checked against orchestrator_capabilities) and record that Etan requested it.', 'Astra allowed only because of the pinned prompt'],
  [97, 'assertions[0].text', 'Dispatches the reviewer on gpt-6-astra because Etan explicitly asked for it, and records that request.', 'Astra allowed only because of the pinned prompt'],
  [97, 'assertions[1].text', 'Does NOT refuse or substitute another model when Etan himself explicitly requests Astra.', 'Astra allowed only because of the pinned prompt'],
];

function codexModelMentions(suite) {
  const strings = (value, path, out) => {
    if (typeof value === 'string') out.push([path, value]);
    else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${path}[${i}]`, out));
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) strings(v, path ? `${path}.${k}` : k, out);
    return out;
  };
  const mentions = [];
  for (const e of suite.evals) {
    for (const [field, text] of strings(e, '', [])) {
      for (const sentence of text.split(/(?<=[.;!?])\s+/)) {
        // Strip exact allowed names, then squash backticks, emphasis and whitespace so split tokens
        // like `gpt-5.6`-sol or "gpt - 5.6 - sol" still read as a mention.
        const rest = sentence.replace(/`/g, '').replace(/\bgpt-6\.1-sol(?![\w-]|\.\w)|\bgpt-6-luna(?![\w-]|\.\w)/gi, ' ');
        if (/gpt|astra|spark/.test(rest.toLowerCase().replace(/[\s*_\\]/g, ''))) mentions.push([e.id, field, sentence]);
      }
    }
  }
  return mentions;
}

function guardCodexModels(suite) {
  const pinned = new Set(PINNED_CODEX_MODEL_MENTIONS.map(([id, field, sentence]) => JSON.stringify([id, field, sentence])));
  for (const [id, field, sentence] of codexModelMentions(suite)) {
    assert.ok(pinned.has(JSON.stringify([id, field, sentence])), `eval ${id} ${field} names a non-allowed Codex model in an unpinned sentence: ${sentence}`);
  }
}

test('Codex model guard rejects mutated evals (#802 and #803 review r1 MAJORs)', () => {
  const suite = JSON.parse(read('skills/golem-powers/agent-routing/evals/evals.json'));
  const mutate = (id, fn) => {
    const copy = structuredClone(suite);
    fn(copy.evals.find(e => e.id === id));
    return copy;
  };
  const mutations = {
    'unrelated negation after a positive route': mutate(25, e => { e.expected_output = 'Routes recon to gpt-5.6-sol, not to Luna.'; }),
    'Etan prefix without an explicit request': mutate(97, e => { e.prompt = 'Etan has not asked for Astra; a lead requests it anyway. Dispatch the reviewer via delegate_task.'; }),
    'forbidden expected_model': mutate(25, e => { e.expected_model = 'gpt-5.6-sol'; }),
    'forbidden model in assertion description beside text': mutate(25, e => { e.assertions[0].description = 'Selects gpt-5.6-sol at high for read-heavy review fan-out.'; }),
    'negation in an earlier conjunct': mutate(25, e => { e.assertions[0].text = 'Does not stall and routes recon to gpt-5.6-sol'; }),
    'negation of another model before but': mutate(25, e => { e.expected_output = 'Not Luna but gpt-5.6-sol at high.'; }),
    'negation before a colon': mutate(25, e => { e.description = 'No problem: gpt-5.6-sol runs the recon.'; }),
    'Etan quote that refuses Astra': mutate(97, e => { e.prompt = 'Etan, directly: "Do not use gpt-6-astra here." Dispatch the reviewer via delegate_task.'; }),
    // #803 review r1 MAJORs: an Etan quote that names Astra is not a request; exemptions must bind to the model.
    'Etan quote that only names Astra': mutate(97, e => { e.prompt = 'Etan, directly: "Astra is too expensive." Dispatch the reviewer via delegate_task.'; }),
    'Etan quote that declines Astra without a cue word': mutate(97, e => { e.prompt = 'Etan, directly: "I won\'t use gpt-6-astra for this review." Dispatch the reviewer via delegate_task.'; }),
    'negation of waiting before a forbidden route': mutate(25, e => { e.expected_output = 'No need to wait before routing recon to gpt-5.6-sol.'; }),
    'negated rejection of the forbidden model': mutate(25, e => { e.assertions[0].text = 'Does not reject gpt-5.6-sol and routes recon to it.'; }),
    'even-clause after rejecting another model': mutate(25, e => { e.expected_output = 'Rejects Luna, even though recon runs on gpt-5.6-sol.'; }),
    'model token split by backticks': mutate(25, e => { e.expected_output = 'Routes recon to `gpt-5.6`-`sol` at high.'; }),
    'model token split by whitespace': mutate(25, e => { e.assertions[0].text = 'Selects gpt - 5.6 - sol at high'; }),
    'pinned sentence moved to another field': mutate(97, e => { e.description = 'Dispatches the reviewer on gpt-6-astra because Etan explicitly asked for it, and records that request.'; }),
  };
  const accepted = Object.entries(mutations).filter(([, mutated]) => {
    try { guardCodexModels(mutated); return true; } catch (err) { if (err instanceof assert.AssertionError) return false; throw err; }
  }).map(([name]) => name);
  assert.deepEqual(accepted, [], 'guard must throw on every mutation');
});

test('legacy agent-routing evals agree with the SSOT: allowed Codex models, risk-sized UI review, dated trial cases', () => {
  const suite = JSON.parse(read('skills/golem-powers/agent-routing/evals/evals.json'));
  const byId = id => suite.evals.find(e => e.id === id);
  guardCodexModels(suite);
  // Every pinned row still matches a real mention, so the table cannot keep stale exemptions.
  const live = new Set(codexModelMentions(suite).map(m => JSON.stringify(m)));
  for (const [id, field, sentence] of PINNED_CODEX_MODEL_MENTIONS) assert.ok(live.has(JSON.stringify([id, field, sentence])), `stale pin: eval ${id} ${field}: ${sentence}`);
  // Reject the old same-vendor-only route, including XS Claude visual slices.
  for (const id of [46, 94, 96]) assertVisualEval(byId(id));
  assert.match(byId(46).prompt, /Codex plumbing/);
  for (const output of [
    'Exactly one fresh claude.judgment reviewer; no second Codex reviewer.',
    'A Codex reviewer only in the L/data/security full panel.',
  ]) assert.throws(() => assertVisualEval({ ...byId(96), expected_output: output }));
  // Eval 14: Spark is no longer allowed for internal children.
  assert.doesNotMatch(JSON.stringify(byId(14)), /Allows Spark/);
  // Codex-implements answers for "everything else" are explicitly dated after the trial.
  for (const id of [9, 34, 49]) assert.match(byId(id).prompt, /2026-10-28.*Codex Sol.*Terra.*default implementation/s, `eval ${id} is dated post-trial`);
  // Trial-agnostic implementer wording where the point is "not the lead, not Cursor".
  for (const id of [2, 3, 5, 8, 22]) assert.match(JSON.stringify(byId(id)), /Codex Sol.*Terra/, `eval ${id} names the default implementers`);
  // M1: failed probe stays on the MBP; nothing moves before Etan authorizes the rig.
  assert.match(JSON.stringify(byId(55)), /MBP/);
  assert.doesNotMatch(JSON.stringify(byId(55)), /cmux/);
  assert.match(JSON.stringify(byId(56)), /recorded Claude-in-T3 proof/);
});

function assertVisualEval(evaluation) {
  const output = evaluation.expected_output;
  for (const required of ['fresh claude.judgment', 'never the implementer', 'Codex plumbing', 'already the other vendor', 'frontend-design:frontend-design', 'emil-design-eng',
    'PLUS the Codex reviewer', 'Both reviews cite the Visual proof', '1 round for XS/S',
    'up to 2 rounds for M', 'full panel', 'only after the implementer reports DONE'])
    assert.ok(output.includes(required), `eval ${evaluation.id}: ${required}`);
  assert.doesNotMatch(JSON.stringify(evaluation), /Exactly one fresh|Codex reviewer only in|does NOT require a Codex reviewer|Does NOT add a second \(Codex\) reviewer/i);
}
