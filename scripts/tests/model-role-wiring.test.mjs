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
