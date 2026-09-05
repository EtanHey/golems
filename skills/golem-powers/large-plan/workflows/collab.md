# Async Agent Collaboration

> Strict coordination protocol for parallel Claude Code sessions sharing a collab file.
> Fleet law: canon #7 owns claim/guard/DONE/harvest-close. This workflow keeps the concrete collab template, status table, append mechanics, and update gates.

## When to Use

- 2+ Claude sessions working on a plan in parallel
- Overnight/async autonomous work (human asleep or away)
- Any multi-agent task where agents must coordinate without human intervention

## The Rule

Use the collab as the active coordination artifact: scaffold it before spawn, update it at the gates below, and keep Messages append-only.

---

## Collab File Structure (MANDATORY)

Every collab file MUST have these sections in this order. Copy this template.

```markdown
# [Project Name] Collab

> [One-line purpose]. All agents: read this file every 5 min. Update BEFORE every commit.

## References

- Plan: `path/to/README.md`
- Phase docs: `path/to/phase-N/`
- Collab rules: `~/.claude/skills/large-plan/workflows/collab.md`

## Goal

[One sentence. What are we trying to accomplish?]

## Orchestrator

**[agentName]** advances rounds and resolves conflicts. All other agents report to this file.

## Agents

| Agent | Role | Repo/CWD | Status |
|-------|------|----------|--------|
| agentA | Phase 1, 3 | $HOME/Gits/repo-a | idle |
| agentB | Phase 2, 4 | $HOME/Gits/repo-b | idle |

Status values: `idle` | `ready` | `learning` | `working` | `blocked:reason` | `done` | `signed-off`

## Task Board

| Phase/Task | Owner | Status | PR |
|------------|-------|--------|----|
| Phase 1: Description | agentA | pending | — |
| Phase 2: Description | agentB | pending | — |

This is the SINGLE source of truth for progress. Messages are supplementary.

## Key Constraints

### agentA
- Phase 3 depends on Phase 2 (agentB must finish first)
- Works in $HOME/Gits/repo-a only — no cross-repo writes

### agentB
- Independent of agentA — can start immediately
- CPU constraint: don't run heavy tasks while diarization is active

## Shared Context

- Design tokens: accent=#8B5CF6, bg=#0A0E1A
- Paths: audio at ~/data/audio/, output at ~/data/output/
- Known bugs: [list any known issues agents should watch for]
- Env vars: HF_TOKEN at ~/.huggingface/token

## Update Gates (MANDATORY)

| Checkpoint | What to Write | Where |
|------------|---------------|-------|
| Pre-flight done | Status -> `learning`. "Pre-flight: N tests green." | Agents + Messages |
| Starting work | Status -> `working`. "Starting [task]." | Agents + Messages |
| Before EVERY commit | One-line summary of changes | Messages |
| Before creating PR | Read other agents' Messages for cross-refs. **Invoke `/pr-loop` for the full loop.** | Messages |
| Phase complete | Status -> `done`; PR link; append `### @<agent> → @<listen-name> — [ISO-timestamp] Phase N done: <summary>. Next: <what is unblocked>` | Task Board + Messages |
| Blocked | Status -> `blocked:reason`; append `### @<agent> → @<listen-name> — [ISO-timestamp] Phase N blocked: <need/from whom>` | Agents + Messages |
| Done for session | "agentX signing off." Status -> `signed-off` | Agents + Messages |

**Enforcement:** If you git commit without a corresponding Messages entry, you are violating the protocol. Update collab FIRST, then commit.

## Round Advancement

[Only needed for round-based sprints. Delete for simple parallel work.]

| Round | Advance When |
|-------|-------------|
| 0 -> 1 | All agents report `learning` or `ready` |
| 1 -> 2 | All Round 1 PRs merged |

Orchestrator announces: `**ADVANCING TO ROUND N.** [per-agent directives]`

## Decisions

<!-- Decisions are FINAL once written. Don't revisit without new information. -->

- [timestamp] Decided: [what] ([reasoning])

## Messages

<!-- Format: - [agentName ISO-timestamp] Short update. Bold status. -->

- [agentA 2026-02-25T14:00] Pre-flight: 42 tests green. Starting Phase 1.
```

---

## Scaffolding a Collab

When you create a collab file, follow these steps:

### 1. Scope it

The collab file is for **coordination only**. These DO NOT belong in a collab file:
- Health/biometrics data
- Calendar schedules
- Workout plans
- Side project specs
- Implementation details (put in PR descriptions or phase findings files)
- Debugging notes (put in agent-specific findings files)

If content doesn't help an agent answer "what should I do next?" — it doesn't belong.

### 2. Declare the orchestrator

One agent (usually the one that created the collab) is the orchestrator. Their job:
- Advance rounds when criteria are met
- Triage review feedback into actionable items
- Resolve conflicts between agents
- Write per-agent directives in Messages using `@agentName:`

### 3. Define agent isolation

Every agent must know:
- Which repo/directory it owns
- What depends on its output
- What it can run in parallel
- Resource constraints (CPU, GPU, RAM)

### 4. Set polling cadence

State it in the file header: `"read this file every N min"`. Typical values:
- 5 min: active overnight work, agents need tight coordination
- 15 min: daytime parallel work, agents mostly independent
- On-demand: agents only check when they finish a task

**Use `/loop` for automated monitoring (Claude Code v2.1.71+):**
```bash
# Orchestrator monitors collab file changes every 5 min:
/loop 5m Read the collab file at <path>/collab.md. Check for status changes, blockers, or completed phases. Take action if needed.

# Monitor PR review comments:
/loop 2m gh pr view <N> --comments | tail -20

# Use CronCreate for background scheduled checks:
CronCreate(schedule="*/5 * * * *", command="bash $HOME/.golems/skills/golem-powers/collab-monitor/scripts/collab-monitor.sh run --once @<listen-name> <path>/collab.md")
```
This replaces the old `fswatch -1` + `run_in_background` pattern.

### 5. Launch agents with the collab path in their prompt

Every agent's kickoff prompt MUST include:
```
Coordination file: <path>/collab.md — read it now, update it at every checkpoint.
```

### 6. Claim names on entry

Canon #7 owns claim-name law. In this workflow, include a grep-stable claim line before dispatch and anchor monitors on claimed names:

```text
> CLAIM name=<name> role=<lead|worker|weaver|orc> monitor=<task-id|none>
```

Roster query: `grep '^> CLAIM' <path>/collab.md`.

---

## Message Format

Short. Timestamped. Bold status keywords. One line per update.

**Good:**
```
### @brainClaude → @mainClaude — [2026-02-25T04:30:00Z] Phase 1 done: PR #13 merged; 266 tests pass. Next: Phase 2.
- [golemsClaude 2026-02-25T04:45] **ADVANCING TO ROUND 2.** @brainClaude: start Phase 2. @voiceClaude: start Phase 5.
### @voiceClaude → @mainClaude — [2026-02-25T05:00:00Z] Phase 5 blocked: human must accept the pyannote license; URLs are in Key Constraints.
- [brainClaude 2026-02-25T06:00] brainClaude signing off. All phases done.
```

**Bad:**
```
- mainClaude: I've been working on the enrichment pipeline and it seems like the
  MLX backend is working well. I processed about 500 chunks and 440 were ok which
  is an 88% success rate. The JSON parse failures were about 12%...
```

### Append Protocol (MANDATORY)

1. **Append at FILE BOTTOM, always.** Mid-file insertions are invisible to agents that tail-read the collab.
2. **NEVER use context-matching patch tools** (e.g. `apply_patch` anchored on a signature line) to append — signature lines repeat, and the patch lands at the FIRST match, not EOF. Use an explicit end-of-file append.
3. **@tag the recipient on every handoff** (`@agentName:`) — an untagged handoff is easy to miss.
4. **Tail-read after every append** — read the last lines and confirm your message landed as the final entry. A message inserted above a pair's later "standing by" line cost ~1h of pair idle time.

---

## Anti-Patterns (DO NOT DO THESE)

1. **Collab as shared notepad** — agents write whenever they feel like it, in whatever format. No structure = human must micromanage.
2. **Decisions buried in Messages** — use the `## Decisions` section. Messages scroll; decisions must be findable.
3. **Unbounded findings in collab** — detailed analysis goes in `agent-specific.md` files. Collab has one-line summaries only.
4. **Freeform status prose** — "I'm working on the thing and it's going well" is not a status update. Use the gate format.
5. **No sign-off** — without explicit sign-off, other agents keep polling for updates that will never come.
6. **No pre-flight** — always verify tests pass before starting work. Report the count.
7. **No forward-looking handoff** — "Phase 1 done" is incomplete. "Phase 1 done. **Next: Phase 2 (agentB unblocked).**" is correct.
8. **Scope creep** — health data, calendar schedules, workout plans, side project specs DO NOT BELONG in a collab file.
9. **No orchestrator** — someone must advance rounds and resolve conflicts. If nobody is designated, nobody does it.
10. **Human writes the protocol at 4am** — if the coordination protocol wasn't in the collab BEFORE agents started, the collab was set up wrong.
11. **Status drift** — agents invent new statuses (`in-progress`, `almost done`) instead of using the defined values. Stick to the status list.
12. **Dual sources of truth** — collab Task Board says one thing, plan README says another. The collab Task Board is authoritative during execution. Plan README gets updated after merge.
13. **Concurrent edit clobbering** — two agents edit collab.md simultaneously, one overwrites the other. Messages section is append-only. For the rest, each agent edits only their own rows.
14. **Stale `working` status** — agent crashes or hangs, status stays `working` forever. If no Messages update for 30+ min from a `working` agent, orchestrator should check on them.
15. **Missing MCP servers in cross-repo agents** — agent launched in repo B has no access to MCP servers configured in repo A's `.mcp.json`. ALWAYS use `--mcp-config` when launching agents in different repos. See scaffold step 9 for CLI template.
16. **Registering hooks before creating the file** — Agent adds a hook to `settings.json` pointing to a file that doesn't exist yet. Hook runner returns exit code 2 (file not found), which blocks ALL tool calls for ALL agents in the repo. **Rule: create the hook file first, register it second. Never the reverse.**
17. **No cron cleanup** — `CronCreate` crons persist until explicitly deleted. When a collab ends, orchestrator must `CronDelete` all monitoring crons. Otherwise they keep running and wasting resources.
18. **`/loop` without termination** — `/loop` runs indefinitely. When all phases are `done` or `signed-off`, stop the loop. Don't leave it polling a dead collab.
19. **Fire-and-forget delegation** — Orchestrator sends a task to an agent without an armed liveness watcher. A crash or stall emits no addressed message, so the packaged collab monitor alone cannot detect it. **Rule: before EVERY delegation, arm a process-exit or scheduled process/registry liveness watcher. The packaged collab monitor may additionally deliver addressed status, blocker, and completion messages, but MUST NOT be the only worker-liveness guard.**
20. **Silent progress** — Agent does work but doesn't use `TaskCreate`/`TaskUpdate`. Orchestrator and UI have no visibility into what's happening. **All agents MUST use task tools for progress tracking.**
21. **Lazy reviewer teaching** — Agent responds to CodeRabbit with "Fixed in X" without explaining the design decision. Next review, CodeRabbit flags the same pattern. **Always `@coderabbitai` with a Learning explaining WHY the pattern is correct.**
22. **Unknown neighbors** — Agent works in isolation without discovering what other agents/daemons/services exist. **Run `brain_entity()` at kickoff to discover the ecosystem before writing code.**
23. **Mid-file insertion** — a message appended via a context-matching patch tool (anchored on a signature line that repeats) lands mid-file where a tail-reading pair never sees it. **Append at EOF, then tail-read to verify placement (see Append Protocol).**

---

## Mandatory Agent Rules (DO NOT REMOVE)

### LOOP RULE (Monitoring Before Delegation)

Canon #7 owns guard/monitor law. Before sending a task, arm a process-exit or scheduled process/registry liveness watcher that wakes the orchestrator on a worker exit or stall. If addressed status, blocker, and completion messages matter, also arm the packaged collab monitor and attach its consumer; it MUST NOT be the only worker-liveness guard.

```bash
# Before spawning an agent for Phase 2:
/loop 5m Read collab file, check if agentB has updated. If no update in 15min, ping them.

# Before delegating a PR review fix:
/loop 2m gh pr view <N> --json reviews --jq '.reviews[-1].state'
```

### TASK USAGE (Progress Visibility)

**All agents MUST use `TaskCreate` and `TaskUpdate`** so progress shows in the UI and the orchestrator has visibility.

```text
TaskCreate("Phase 2: VoiceBar MCP", status="working")
... work ...
TaskUpdate(id, status="done", note="PR #57 merged. 289 tests.")
```

**When to create tasks:** At kickoff (one per phase/task claimed). Update status at every gate checkpoint. Use the collab status values defined above (`idle | ready | learning | working | blocked:reason | done | signed-off`) — not tool-specific values like `in_progress`/`completed`.

### RESEARCH REFERENCE RULE

**Every research output MUST be tagged where it matters.** When a research doc is produced:
1. Tag it in the **roadmap** section it informs (as a reference link)
2. Tag it in the **design doc** section it informs
3. Tag it in the **plan phase** it informs
4. If a future Claude visits that section, they should find the research without searching for it.

```text
WRONG: Research lives in docs.local/research/ and nowhere else
RIGHT: Research linked from roadmap phase, design doc section, AND plan phase README
```

### CHECKPOINT CADENCE

**`brain_store` every 3 completed tasks.** Don't wait until the end of a session.

```text
Task 1 done → collab update
Task 2 done → collab update
Task 3 done → collab update + brain_store(summary of tasks 1-3, decisions made, surprises found)
```

**Why:** In long sprints, context compaction can erase early work. Checkpointing every 3 tasks ensures knowledge survives compaction boundaries.

### HONESTY RULE

**Do NOT just push through to finish.** If something concerns you — a design gap, a potential bug, a CodeRabbit comment that might be right, a surprise in the codebase — RAISE IT.

```markdown
### agentName (YYYY-MM-DD HH:MM)
**CONCERN:** [what worries you]
- Context: [what you found]
- Why it matters: [impact if ignored]
- Suggested: [investigate / fix / defer with tracking]
```

**Investigate before dismissing.** If a reviewer flags something that conflicts with the design, READ the design doc section. If it doesn't explicitly address the tradeoff → treat it as a real gap.

### PR LOOP TEACHING

**Always teach CodeRabbit with `@coderabbitai` Learnings on design decisions.** Don't just "Fixed in X".

```text
WRONG: "Fixed the error handling as suggested."
RIGHT: "@coderabbitai This pattern uses INSERT OR IGNORE with content-hash dedup because
        the daemon may receive the same chunk from multiple socat clients simultaneously.
        The duplicate is expected, not an error. Please learn this for future reviews."
```

**Why:** In the Three-Daemon Sprint, teaching CodeRabbit on design decisions (dual-protocol sockets, content-hash dedup, single-writer SQLite) prevented repeat flags across PR review rounds.

### AGENT ENTITY AWARENESS

**At kickoff, run `brain_entity()` to discover the ecosystem.** Know what other agents, daemons, and services exist before writing code.

```bash
# At agent kickoff:
brain_entity("voicelayer")   # What does this system do? What are its components?
brain_entity("brainlayer")   # What tools does it expose? What's the architecture?
brain_entity("cmux")         # How does it dispatch commands?
```

**Why:** Agents that understand the ecosystem write better integration code and avoid reimplementing existing functionality.

---

## Overnight Autonomous Work

When agents work while the human sleeps:

1. **Scaffold the collab BEFORE the human goes to sleep.** All sections filled, all constraints declared.
2. **Each agent sets a polling timer** — use `/loop 5m Read collab file, check for updates, take action` (preferred) or `CronCreate` for background checks.
3. **CPU/thermal safety rules in Key Constraints** — which heavy processes can run simultaneously.
4. **Blocker escalation** — if blocked on human action, update status to `blocked:human` with exactly what's needed. Don't keep retrying.
5. **Sign off when done** — prevents other agents from waiting for you.
6. **The human should wake up to a clean collab file** where Messages show exactly what happened, Task Board shows what's done, and Decisions capture anything learned.

---

## Complexity Tiers

**Always-required sections** (every tier): Goal, Agents, Task Board, Update Gates, Decisions, Messages.

### Lightweight (2 agents, independent work, ~40 lines)
Required: Goal, Agents, Task Board, Update Gates, Decisions, Messages.
Optional: References, Key Constraints, Shared Context, Orchestrator.
Skip: Round Advancement.
Note: If Orchestrator section is omitted, the agent that created the collab is implicitly the orchestrator.
Example: `project-mini-sites/collab.md`

### Standard (2-3 agents, some dependencies, ~80-100 lines)
Required: All always-required + Orchestrator, Key Constraints, Shared Context, References.
Skip: Round Advancement (no rounds needed).
Example: `sprint-3-collab.md`

### Complex (3+ agents, multi-repo, round-based, ~150-200 lines)
Required: All sections including Round Advancement.
Plus: Per-agent findings in separate files. Archive old messages when >50 lines.
Example: `brainlayer-v2-launch/collab.md` + `v2-fix-sprint/collab.md`

## Participation law (binding on every agent in this collab)

**A collab is a mailbox with no doorbell.** Writing to it makes a message durable, not delivered.
Full rules: `collab-monitor` SKILL.md § *Participation Law*. The short form, which a plan's collab
section MUST state so every joining agent inherits it:

- **Arm a watcher on this file before doing any work** — the moment you are named a participant.
  Claude: `Monitor`. Codex: `tail -n0 -F <collab> &` detached, then RETURN.
- **Waiting = detached watcher + return.** Never foreground-poll; never inspect another agent's
  pane to infer state.
- **Stop the watcher when you post your DONE** — its life is exactly your lane's life.
- **Pings are pointers**: one line, where to look + why it is urgent. Detail lives here, because
  this file survives restarts and panes do not.
- If a handoff looks unanswered, check whether the recipient had a watcher before concluding
  anything about the recipient.

