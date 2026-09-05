---
name: large-plan
description: "Scaffold multi-phase plans with async agents. Triggers: large feature, multi-PR refactor, parallel cmux."
---

# /large-plan

**Invoke as:** `/large-plan` (single segment).  
**Source:** `$HOME/.golems/skills/golem-powers/large-plan/` (symlinked at `~/.claude/skills/large-plan`).

> Fleet law: canon #2 owns PR-loop validity and canon #7/#8 own collab/lead-routing law. This skill keeps plan scaffolding, phase routing, collab file mechanics, adapters, and evaluator gates.

> Scaffold folder-based plans with phase folders, execute them through the branch-PR-review cycle, and coordinate async agent collaboration.

## Quick Actions

| What you want to do | Workflow |
|---------------------|----------|
| Create a new plan from a description | [workflows/scaffold.md](workflows/scaffold.md) |
| Execute the next phase in a plan | [workflows/execute-phase.md](workflows/execute-phase.md) |
| Start async collab on a phase | [workflows/collab.md](workflows/collab.md) |

---

## Available Scripts

| Script | Purpose | Usage |
|--------|---------|-------|
| `scripts/scaffold-plan.sh` | Create folder-based plan structure | `bash scripts/scaffold-plan.sh <plan-dir> <plan-name> <phase-count>` |

---

## Core Concept

Large plans are folder-based: one folder per phase, each containing a README.md (steps) and findings.md (shared knowledge). A main README.md acts as the index with a progress table and routing.

```
plan-dir/
  README.md              # Index: progress table, routing, execution rules
  collab.md              # Created when parallel phases exist (see below)
  phase-1-name/
    README.md            # Steps for this phase
    findings.md          # Shared knowledge room (agents write here)
  phase-2-name/
    README.md
    findings.md
  ...
```

### Execution Decision: Sequential vs Parallel

For large or heavy plans, run `/plan-council` on the authored plan before execution begins.

**EVERY plan must decide this at scaffold time.** Analyze the dependency graph:

```
Phases with NO cross-dependencies  →  Parallel (collab.md + multiple agents)
Phases that depend on each other   →  Sequential (execute-phase, one at a time)
Mixed                              →  Rounds (parallel within round, sequential between rounds)
```

**Decision tree:**
1. Draw the dependency graph from phase `Depends On` fields
2. Group independent phases into **rounds** (phases in the same round can run in parallel)
3. If ANY round has 2+ phases → create `collab.md` at plan root
4. Add `## Execution Strategy` to the main README.md showing rounds and parallelism

Example:
```markdown
## Execution Strategy

| Round | Phases | Mode | Agents |
|-------|--------|------|--------|
| 1 | Phase 1, Phase 2 | **parallel** (collab) | brainClaude, golemsClaude |
| 2 | Phase 3 (depends on 1+2) | sequential | mainClaude |
| 3 | Phase 4, Phase 5 | **parallel** (collab) | brainClaude, golemsClaude |
```

When a round has parallel phases, the orchestrator:
1. Creates/updates `collab.md` using the [collab protocol](workflows/collab.md)
2. Starts the monitor **before dispatching any worker** (step 0 at boot and after every compaction — `/collab-monitor` § "Arming Is Step 0") and attaches its alert stream with `bash $HOME/.golems/skills/golem-powers/collab-monitor/scripts/collab-monitor.sh start @<listen-name> collab.md && bash $HOME/.golems/skills/golem-powers/collab-monitor/scripts/collab-monitor.sh follow @<listen-name>` in a supervised long-running command session
3. Arms a process-exit or scheduled process/registry liveness watcher for every worker. The addressed-message collab monitor **MUST NOT be the only worker-liveness guard**
4. Spawns one agent per phase (Task tool or CLI agents) only after the message monitor reports `STARTED`, its consumer reports `FOLLOWING`, and the liveness watchers are armed
5. Includes the collab.md path in every kickoff prompt, requires each agent to append either `### @<agent> → @<listen-name> — [ISO-timestamp] Phase N done: <summary>` or `### @<agent> → @<listen-name> — [ISO-timestamp] Phase N blocked: <need/from whom>`, and advances rounds when all phases are done

### Plan Lifecycle

```
Scaffold plan  →  Analyze dependencies  →  Group into rounds
                                                |
                    ┌───────────────────────────┘
                    ▼
              Round has 1 phase?  →  Execute sequentially (execute-phase)
              Round has 2+ phases? → Create collab.md, arm message + liveness guards, spawn agents in parallel
                    |
                    ▼
              All round phases done  →  Advance to next round  →  Repeat
```

### Non-Code Deliverables Check (MANDATORY at scaffold time)

> **Root cause (April 5 overnight sprint):** orcClaude missed the second track — user wanted 9 entity files enhanced for morning walk + code PRs by dawn. Agent only scaffolded the code track.

**At scaffold time, ALWAYS ask:** "Are there non-code deliverables alongside the code phases?"

Common non-code deliverables:
- Data enrichment / content curation (entity files, research docs, grill enhancement)
- Documentation updates (READMEs, portfolio pages, design docs)
- Configuration changes (LaunchAgents, hooks, environment)
- Research outputs (A/B test results, comparative analysis)

If yes, add a separate phase or parallel track for the non-code work. Non-code deliverables are often the user's PRIMARY goal — the code is just infrastructure supporting it.

### Branch Lifecycle (per phase)

Branch/PR law lives in canon #2 and `/pr-loop`; each implementation phase records its PR URL and follows the current lane's merge authority.

### Phase Template

Each phase README follows this template:

```markdown
# Phase N: Name

> [Back to main plan](../README.md)

## Goal
One sentence describing what this phase achieves.

## Time
- **Estimate:** NNmin (basis: [complexity/rolling avg from prior phases])
- **Started:** HH:MM
- **Completed:** —
- **Actual:** —
- **Error ratio:** —

## Round
Round M (parallel with Phase X, Phase Y) OR Round M (sequential).

## Tools
- **Research:** [gemini|cursor|codex] — what to research
- **Code:** [cursor|haiku|sonnet] — what to implement
- **MCPs:** [list relevant MCP servers]

## Steps
1. Step one
2. Step two
3. ...

## Depends On
- Phase X (for Y reason)

## Status
- [ ] Step one
- [ ] Step two
```

### Findings Template

Each phase findings.md is the shared collaboration room:

```markdown
# Phase N Findings

## Decisions
- [timestamp] Decision: ...

## Research
- [timestamp] Agent: Found that ...

## Task Board
| Task | Owner | Status |
|------|-------|--------|
| Research X | gemini | done |
| Implement Y | cursor | in progress |
```

---

## Parallel Execution (Collab Protocol)

When a round has 2+ independent phases, use the **full collab protocol** defined in [workflows/collab.md](workflows/collab.md).

**The orchestrator MUST:**
1. Create `collab.md` at plan root using the template from the collab workflow
2. Fill in all mandatory sections (Goal, Agents, Task Board, Constraints, Gates)
3. Start the monitor and attach its alert stream with `bash $HOME/.golems/skills/golem-powers/collab-monitor/scripts/collab-monitor.sh start @<listen-name> collab.md && bash $HOME/.golems/skills/golem-powers/collab-monitor/scripts/collab-monitor.sh follow @<listen-name>` in a supervised long-running command session
4. Arm a process-exit or scheduled process/registry liveness watcher for every worker. The addressed-message collab monitor **MUST NOT be the only worker-liveness guard**
5. Spawn agents with the collab path in their kickoff prompts only after the message monitor reports `STARTED`, its consumer reports `FOLLOWING`, and the liveness watchers are armed; require each agent to append either `### @<agent> → @<listen-name> — [ISO-timestamp] Phase N done: <summary>` or `### @<agent> → @<listen-name> — [ISO-timestamp] Phase N blocked: <need/from whom>`, and advance rounds when all agents report `done`

Fleet law for claim/guard/DONE/harvest-close lives in canon #7; this workflow keeps the concrete template, status table, and update gates.

**Complexity tiers** (from collab workflow):
- **Lightweight** (~40 lines): 2 agents, fully independent work
- **Standard** (~100 lines): 2-3 agents, some dependencies
- **Complex** (~200 lines): 3+ agents, multi-repo, round-based

See [workflows/collab.md](workflows/collab.md) for the full protocol, mandatory sections, update gates, message format, and anti-patterns.

---

## Integration with Other Skills (Building Blocks)

**MANDATORY for every phase:**

| Skill | When | Why |
|-------|------|-----|
| `/pr-loop` | Every phase completion | Procedural PR checklist; canon #2 owns the branch-to-merge law. |
| Failing test first (AGENTS.md law) | All implementation | Red-green-refactor. No code without a failing test first; `/tdd-guard` is the hook that enforces the edit limit. |
| `/never-fabricate` | Before claiming "done" or reporting results | Evidence before assertions: Read() files before summarizing them, verify before claiming. Enforced by the false-green-gate hook. |
| `/plan-council` | Review one authored plan/spec | Declared cross-family judges, live validation, measured bias, and lift round. |

**Optional per phase:**

| Skill | When to use |
|-------|-------------|
| `/coderabbit` | Verify phase output with targeted review |
| Manual QA checklist | Generate test plans per phase from the diff |
| `/prd` | Create PRDs from phase specs |
| `/pr-loop` step 5 | CodeRabbit review + atomic commit |

---

## PR Review Cycle (per phase)

After push, automated reviewers comment. Classify each:

| Type | Action |
|------|--------|
| **Real bug** | FIX immediately |
| **Style preference** | Fix if genuinely better |
| **Over-engineering** | SKIP |
| **Out of context** | Comment explaining why |

Repeat push-fix cycle until no real bugs remain.

---

## Platform Features vs Universal Fallbacks

> Claude Code features are listed first. If running on Codex or Cursor, use the universal fallback.
> Full adapter docs: [adapters/](adapters/)

| Feature | Claude Code | Universal Fallback |
|---------|-------------|-------------------|
| **Parallel phase agents** | `Agent(isolation="worktree", run_in_background=true)` | Pre-create worktrees, then launch repoGolem workers with `-w <abs-path>` |
| **Phase worktree isolation** | `Agent(isolation="worktree")` — auto-creates + cleans up | `git worktree add -b feature/phase-N ../<dir> master`, then pass the absolute path |
| **Collab file monitoring** | `CronCreate` or `/loop 5m` | `bash $HOME/.golems/skills/golem-powers/collab-monitor/scripts/collab-monitor.sh start @<listen-name> collab.md && bash $HOME/.golems/skills/golem-powers/collab-monitor/scripts/collab-monitor.sh follow @<listen-name>` in a monitored long-running command session |
| **Worker liveness** | Process-exit notification or a scheduled process/registry check | `skills/golem-powers/codex-workflows/scripts/codex-workflows.sh watch --run-id <run-id>`; read the finished log once, never poll `read_screen` |
| **Cron cleanup (plan done)** | `CronDelete(<id>)` — mandatory | `bash $HOME/.golems/skills/golem-powers/collab-monitor/scripts/collab-monitor.sh stop @<listen-name>` |
| **Plan mode (spec first)** | `EnterPlanMode → ExitPlanMode` | Write plan to `docs.local/plan/<name>/README.md` manually |
| **Memory persistence** | `brain_store()` / `brain_search()` via BrainLayer | Append to `<plan-dir>/findings.md` |
| **Session resume** | `claude --resume` | Not available — pass `<plan-dir>/README.md` in next session's context |
| **Background phase execution** | `Agent(run_in_background=true)` | `nohup codex --full-auto "..." > phase.log 2>&1 &` |

---

## Time Tracking & Estimation Calibration (MANDATORY)

> Data from April 5 overnight sprint (brainlayer, Codex workers): estimated 90min/phase, actual 15min average. Started at 6x overestimate, auto-calibrated to 1.25x by phase 7. Record timestamps at phase start + PR creation. Without tracking, estimates never calibrate.

### At Scaffold Time

The main README.md progress table MUST include estimate and actual columns:

```markdown
## Progress

| Phase | Status | Estimate | Started | Completed | Actual | Error |
|-------|--------|----------|---------|-----------|--------|-------|
| 1. Setup | ✅ done | 30min | 1:15 AM | 1:28 AM | 13min | 2.3x |
| 2. Search | ✅ done | 30min | 1:30 AM | 1:42 AM | 12min | 2.5x |
| 3. Hybrid | 🔄 active | 15min* | 1:45 AM | — | — | — |
| 4. Evals | ⏳ pending | 15min* | — | — | — | — |

*Auto-recalibrated from rolling avg of phases 1-2 (12.5min → round to 15min)
Rolling calibration: 2.3x → 2.5x → tracking...
```

### At Phase Start (CLOCK IN)

```
brain_store(
  content: "CLOCK IN [plan-name / Phase N]: Started HH:MM. Estimate: NNmin. Basis: [first phase=complexity, later=rolling avg].",
  tags: ["time-tracking", "clock-in", "<project>"],
  importance: 5
)
```

Fill in the phase template's Time section: Started, Estimate.

### At Phase Complete (CLOCK OUT)

```
brain_store(
  content: "CLOCK OUT [plan-name / Phase N]: PR merged HH:MM. Actual: NNmin. Estimated: NNmin. Error: X.Xx. Rolling avg (last 3): NNmin.",
  tags: ["time-tracking", "clock-out", "<project>"],
  importance: 5
)
```

Fill in the phase template's Time section: Completed, Actual, Error ratio.
Update the main README progress table.

### Auto-Recalibration (after 3+ phases)

Once 3 phases have actuals:

```
rolling_avg = average(last 3 actuals)
remaining_phases × rolling_avg = estimated total remaining

Report: "Phases 1-3 done in 38min total. Rolling avg: 12.7min.
         Remaining 4 phases: ~51min at current pace.
         Sprint total ETA: ~89min (original estimate was 630min = 7.1x overestimate)"
```

**Rule:** After 3+ phases, new estimates MUST be within 2x of rolling average. Don't keep estimating 90min when actuals are 15min.

### Why This Matters

User correction (April 5): "No, I'm saying it will take probably hours, not weeks" — after orc estimated a 2-week timeline for work that took one evening. Time tracking turns this from a repeated correction into self-correcting behavior.

---

## Quality Gates (before marking phase done)

| Gate | Check |
|------|-------|
| Typed right | No `any`, proper interfaces |
| Documented | JSDoc on exports, CLAUDE.md updated if needed |
| DRY | No duplicated logic |
| Tests pass | `bun test` / `npm test` green |
| Build passes | No compile errors |

---

## Phase N+1: Adversarial Evaluator (NON-NEGOTIABLE)

> **Closes the self-audit-as-evaluator substitution loophole.** Observed at P5 fix queue 2026-05-17 — agent self-graded "evaluator replay PASS" without dispatching a separate evaluator. /goal hook silently passed.

Every /large-plan output that produces code, scripts, configs, or plist drafts **MUST** end with a Phase N+1 that:

1. **Spawns a separate evaluator subagent** (NOT the producing agent's self-audit).
   - Use `Agent(subagent_type=evaluator, ...)` or equivalent platform fallback.
   - The evaluator MUST be a different agent invocation from the one that produced the work.
2. **Hands the evaluator a verbatim copy of every "Pass criterion"** from the original /goal hook (no paraphrasing, no summarization).
3. **Requires the evaluator to re-Read each cited file:line** and run anti-fabrication checks (per /never-fabricate Live-citation gate).
4. **The evaluator MUST score ≥8/10** OR produce an `ITERATE` verdict with specific fixes.
5. **SELF-AUDIT IS NOT EVALUATION.** If the producing agent grades its own work, the /goal hook does not pass — re-dispatch with explicit `subagent_type` ≠ producing agent.

**Template:** [workflows/phase-evaluator.md](workflows/phase-evaluator.md) — minimal evaluator-subagent dispatch (prompt format, scoring rubric link).

**Done-gate semantics:**

| Producing agent emits | /goal hook treats as |
|-----------------------|----------------------|
| `TASK_DONE` without evaluator dispatch transcript | **FAIL** (substitution loophole) |
| `TASK_NEEDS_EVALUATOR` + transcript of separate evaluator scoring ≥8/10 | **PASS** |
| `TASK_NEEDS_EVALUATOR` + evaluator `ITERATE` verdict | **RE-DISPATCH** (do not declare done) |

**Evidence:** 4-of-4 /goal outputs 2026-05-17 night surfaced critical issues only when externally evaluated. P5 fix queue silently substituted self-audit for the required external evaluator replay (skillcreator-p5fix mine [1438]).
