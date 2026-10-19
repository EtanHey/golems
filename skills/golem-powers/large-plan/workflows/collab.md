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

## Status and wakes

The fleet collab law (Etan 2026-10-18, via orc collab), verbatim:

- "**Where updates go:** leads post progress HERE, appended with `cat >> … <<'EOF'`, never edited in place. No more status messages into orc's T3 thread."
- "**What wakes orc:** `@orc`, a header `### <lead> → orc`, or a BLOCKED/DONE line. Use them only for: blocked, a lane done, or something Etan must decide."
- "**Etan-facing asks:** tag them `@etan`. orc folds them into ONE stable page" (orc's `fleet-latest.html`, overwritten in place, same URL every time).
- "**Lead workers** post here as `<lead>-w<N>`."
- "**Status tracking:** a STATUS file overwritten in place, plus ONE line per status change appended here (traceability). No big ledgers."

HERE is orc's fleet collab for a lead's progress; a plan's `collab.md` follows the same law. In practice:

1. **STATUS file:** `STATUS.md` next to `collab.md` (for fleet progress, the lead's own STATUS file). It holds the Task Board (phase, owner, status, PR) and any metric the lead tracks. One writer, the lead, overwrites it in place. It is current state, never a growing table of past states.
2. **One collab line per status change**, appended at EOF and never edited:
   ```bash
   cat >> <plan-dir>/collab.md <<'EOF'
   - [skill-lead-w2 2026-10-19T09:12Z] Phase 2: PR #801 opened. **working → review**
   EOF
   ```
   A status change is a move between the status values below, a PR opened or merged, or a blocker. A commit, a test run or a step inside a phase is not one and gets no line. Canon #7's "checkpoint before commits" is a check that your status is current; append only when it changed.
3. **Progress never goes into orc's T3 thread** or the lead's thread as a message. A T3 child's final message is its report; the `delegate_task` completion wakes the lead, which overwrites STATUS.md only: the worker's own line already recorded the change, so the lead appends no second line. It appends one only when no line for that change landed (the child ended without writing it).
4. **Wake words only for a wake:** `@orc`, `### <lead> → orc`, or a BLOCKED/DONE line, and only for blocked, a lane done, or an Etan decision. Inside a plan, the `### @<agent> → @<listen-name> — … done|blocked` headings below are the same wake for the lead. A progress line carries no `@` tag.
5. **`@etan`** is for a decision only Etan can make. Routing, scope and model questions go to the lead, never Etan (`/agent-routing` § Goal Contract).
   Only one-way doors qualify (Etan 2026-10-19, via orc; canonical: `/pr-loop` § Hard Gates). A tag, release, install, deploy or upgrade is never an `@etan` ask or a dashboard "Waiting on you" item: ship it, then report it as done. A remote branch delete or force push still needs the `human-confirm-gate` token (deleting data is a one-way door).
6. **Names:** a lead's workers post as `<lead>-w<N>` (`skill-lead-w2`), numbered in dispatch order.

---

## Collab File Structure (MANDATORY)

Every collab file MUST have these sections in this order. Copy this template.

```markdown
# [Project Name] Collab

> [One-line purpose]. No polling: in T3 the `delegate_task` completion notification wakes the lead and PR waits are the parent's `watch_pull_request`; read this file on each wake. cmux adapter: arm the addressed watch per `/collab-monitor`. Status lives in `STATUS.md` (overwritten in place); this file gets ONE appended line per status change.

## References

- Plan: `path/to/README.md`
- Phase docs: `path/to/phase-N/`
- Collab rules: `~/.claude/skills/large-plan/workflows/collab.md`

## Goal

[One sentence. What are we trying to accomplish?]

## Orchestrator

**[agentName]** advances rounds and resolves conflicts. All other agents report to this file.

## Agents

Staff by role from golems `standards/model-roles.json`; resolve with
`node scripts/model-roles.mjs <role> --field <field>` before dispatch.

| Agent | Role | Phases | Repo/CWD |
|-------|------|--------|----------|
| lead-w1 | `codex.implement` | 1, 3 | $HOME/Gits/repo-a |
| lead-w2 | `gemini.gather.text` | 2, 4 | $HOME/Gits/repo-b |
| lead-w3 | <role per `/agent-routing` § Routing rules (SSOT)> | PR gates | $HOME/Gits/repo-a |

Workers are named `<lead>-w<N>`. Frame batches use `gemini.gather.visual`; single-fact recall, pane mechanics and
verifiers use `claude.subagent.cheap`. Candidate roles require their bench gate.

Status values: `idle` | `ready` | `learning` | `working` | `blocked:reason` | `done` | `signed-off`

## Task Board

Board state (phases, owners, agent status) lives in `STATUS.md` next to this file; read it there. The lead overwrites it in place (template: [STATUS.md template](#statusmd-template)).

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
| Pre-flight done | Status -> `learning`. "Pre-flight: N tests green." | One status line |
| Starting work | Status -> `working`. "Starting [task]." | One status line |
| Before a commit | Check your status is current; append a line only if it changed. No per-commit lines | — |
| Before creating PR | Read other agents' Messages for cross-refs. **Invoke `/pr-loop` for the full loop.** | One status line when the PR opens |
| Phase complete | Status -> `done`; PR link; append `### @<agent> → @<listen-name> — [ISO-timestamp] Phase N done: <summary>. Next: <what is unblocked>` | Messages (lead overwrites STATUS.md) |
| Blocked | Status -> `blocked:reason`; append `### @<agent> → @<listen-name> — [ISO-timestamp] Phase N blocked: <need/from whom>` | Messages (lead overwrites STATUS.md) |
| Done for session | "<lead>-w<N> signing off." Status -> `signed-off` | One status line |

**Enforcement:** every status change gets exactly one appended line, and the lead folds it into STATUS.md. A status change with no line breaks the protocol; a line with no status change is ledger noise ("No big ledgers").

## Round Advancement

[Only needed for round-based sprints. Delete for simple parallel work.]

| Round | Advance When |
|-------|-------------|
| 0 -> 1 | Staff roles resolved from config; candidate gates satisfied; all agents report `learning` or `ready` |
| 1 -> 2 | All Round 1 PRs merged, every worker's CLEANUP RECEIPT posted, and the lead's prune step run |

Orchestrator announces: `**ADVANCING TO ROUND N.** [per-agent directives]`

## Decisions

<!-- Decisions are FINAL once written. Don't revisit without new information. -->

- [timestamp] Decided: [what] ([reasoning])

## Messages

<!-- Format: - [<lead>-w<N> ISO-timestamp] One line per status change. Bold status. Append with cat >> … <<'EOF'. -->

- [lead-w1 2026-02-25T14:00] Pre-flight: 42 tests green. **learning → working** on Phase 1.
```

## STATUS.md template

Create `STATUS.md` next to `collab.md` at scaffold time from this template. One writer, the lead, overwrites the whole file in place on every status change; it is current state, never a history.

```markdown
# [Project Name] Status

> Overwritten in place by the lead. History lives in collab.md Messages (one line per status change).

## Task Board

| Phase/Task | Owner | Status | PR |
|------------|-------|--------|----|
| Phase 1: Description | lead-w1 | pending | — |
| Phase 2: Description | lead-w2 | pending | — |

## Agent state

One row per agent (the collab Agents table has no Status column):

| Agent | Status |
|-------|--------|
| lead-w1 | idle |
| lead-w2 | idle |
```

STATUS.md is the SINGLE source of truth for progress. Messages hold one line per status change.

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

### 4. Arm addressed watches

**T3 (default in T3):** arm nothing. The lead dispatches with `delegate_task` and the
completion notification is the guard (SKILL.md § T3-native execution). On wake, verify
the report and requested artifact before advancing.

**cmux adapter:** Watches: follow `/collab-monitor` before dispatch and after every compaction;
a DONE marker or version match still needs artifact or real-client verification.
Use native Monitor (cmux adapter) for addressed collab and PR events, with its documented
30-minute expiry and re-arm rules. Record its returned task ID and use TaskStop
before replacing a watch or closing its lane; preserve routing state and avoid
duplicate streams. Codex seats arm no collab monitor: "Codex seats must not poll
collabs; T3 delegate completions already wake you." (Etan 2026-10-18, via orc collab)
Also arm a separate process-exit or process/registry liveness watcher before dispatch.
Every DONE/BLOCKED heading needs a unique ISO timestamp; verify the report and
requested artifact before advancing.

### 5. Launch agents with the collab path in their prompt

Every agent's kickoff prompt MUST include:
```
Coordination file: <path>/collab.md — read it now, update it at every checkpoint.
Board state: <path>/STATUS.md — read it for phases, owners and status; only the lead writes it.
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
5. **No sign-off** — without explicit sign-off, other agents keep waiting for updates that will never come.
6. **No pre-flight** — always verify tests pass before starting work. Report the count.
7. **No forward-looking handoff** — "Phase 1 done" is incomplete. "Phase 1 done. **Next: Phase 2 (agentB unblocked).**" is correct.
8. **Scope creep** — health data, calendar schedules, workout plans, side project specs DO NOT BELONG in a collab file.
9. **No orchestrator** — someone must advance rounds and resolve conflicts. If nobody is designated, nobody does it.
10. **Human writes the protocol at 4am** — if the coordination protocol wasn't in the collab BEFORE agents started, the collab was set up wrong.
11. **Status drift** — agents invent new statuses (`in-progress`, `almost done`) instead of using the defined values. Stick to the status list.
12. **Dual sources of truth** — STATUS.md says one thing, plan README says another. The STATUS.md Task Board is authoritative during execution. Plan README gets updated after merge.
13. **Concurrent edit clobbering** — two agents edit collab.md simultaneously, one overwrites the other. Messages section is append-only. STATUS.md has one writer, the lead.
14. **Stale `working` status** — agent crashes or hangs, status stays `working` forever. cmux adapter: if no Messages update for 30+ min from a `working` agent, the orchestrator checks the liveness watcher once. In T3 the completion notification (or one bounded `task_status` check) answers this; never a polling turn.
15. **Missing MCP servers in cross-repo agents** — agent launched in repo B has no access to MCP servers configured in repo A's `.mcp.json`. ALWAYS use `--mcp-config` when launching agents in different repos. See scaffold step 9 for CLI template.
16. **Registering hooks before creating the file** — Agent adds a hook to `settings.json` pointing to a file that doesn't exist yet. Hook runner returns exit code 2 (file not found), which blocks ALL tool calls for ALL agents in the repo. **Rule: create the hook file first, register it second. Never the reverse.**
17. **No watch cleanup** — when a collab ends, stop owned Monitor task IDs with TaskStop (cmux adapter). In T3: `unwatch_pull_request` and `task_cancel` any child still running.
18. **`/loop` without termination** (cmux adapter, Claude seats only) — `/loop` runs indefinitely. When all phases are `done` or `signed-off`, stop the loop. Don't leave it polling a dead collab. In T3 and on Codex seats, never start one.
19. **Fire-and-forget delegation** — Orchestrator sends a task to an agent without an armed liveness watcher. A crash or stall emits no addressed message, so the collab monitor alone cannot detect it. **Rule (cmux adapter): before EVERY delegation, arm a process-exit or scheduled process/registry liveness watcher. The collab monitor may additionally deliver addressed status, blocker, and completion messages, but MUST NOT be the only worker-liveness guard.** In T3 the `delegate_task` completion notification is that guard; arm nothing else.
20. **Silent progress** — Agent does work but doesn't use `TaskCreate`/`TaskUpdate`. Orchestrator and UI have no visibility into what's happening. **All agents MUST use task tools for progress tracking.**
21. **Lazy reviewer teaching** — Agent responds to CodeRabbit with "Fixed in X" without explaining the design decision. Next review, CodeRabbit flags the same pattern. **Always `@coderabbitai` with a Learning explaining WHY the pattern is correct.**
22. **Unknown neighbors** — Agent works in isolation without discovering what other agents/daemons/services exist. **Run `brain_entity()` at kickoff to discover the ecosystem before writing code.**
23. **Mid-file insertion** — a message appended via a context-matching patch tool (anchored on a signature line that repeats) lands mid-file where a tail-reading pair never sees it. **Append at EOF, then tail-read to verify placement (see Append Protocol).**

---

## Mandatory Agent Rules (DO NOT REMOVE)

### WATCH RULE (Monitoring Before Delegation)

Canon #7 owns guard/monitor law. **T3 (default in T3):** the `delegate_task` completion notification is the guard; arm no monitor or liveness watcher. **cmux adapter:** Before sending a task, arm a process-exit or scheduled process/registry liveness watcher that wakes the orchestrator on a worker exit or stall. For addressed status, blocker, and completion messages, also arm native Monitor (Claude) per `/collab-monitor`; Codex seats arm none. The collab monitor MUST NOT be the only worker-liveness guard. Follow the lifecycle in step 4 above, including expiry, compaction re-arm and cleanup. For PR events, query current PR state on each tick per `/collab-monitor`; do not reuse a stale review payload.

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
2. **Wake-ups are set before sleep** — T3: completion notifications wake the lead, nothing armed. cmux adapter: each Claude seat arms an addressed watch per `/collab-monitor`, including expiry and compaction re-arm; Codex seats arm none.
3. **CPU/thermal safety rules in Key Constraints** — which heavy processes can run simultaneously.
4. **Blocker escalation** — if blocked on human action, update status to `blocked:human` with exactly what's needed. Don't keep retrying.
5. **Sign off when done** — prevents other agents from waiting for you.
6. **The human should wake up to a clean collab file** where Messages show one line per status change, STATUS.md shows what's done, and Decisions capture anything learned.

---

## Complexity Tiers

**Always-required sections** (every tier): Goal, Agents, Task Board (in STATUS.md), Update Gates, Decisions, Messages.

### Lightweight (2 agents, independent work, ~40 lines)
Required: Goal, Agents, Task Board (in STATUS.md), Update Gates, Decisions, Messages.
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
Plus: Per-agent findings in separate files. Messages are never moved out or trimmed (append-only traceability); if a long collab needs a summary, copy lines into a separate digest file and leave the original collab intact.
Example: `brainlayer-v2-launch/collab.md` + `v2-fix-sprint/collab.md`

## Participation law (binding on every agent in this collab)

**A collab is a mailbox with no doorbell.** Writing to it makes a message durable, not delivered.
Full watch lifecycle: `/collab-monitor`. The short form, which a plan's collab
section MUST state so every joining agent inherits it:

- **T3 (default in T3): no watcher.** A child reports in its final message and appends its
  status line here; the `delegate_task` completion notification wakes the lead. "Codex seats
  must not poll collabs; T3 delegate completions already wake you." (Etan 2026-10-18, via orc collab)
- **cmux adapter: arm a watcher on this file before doing any work** — the moment you are named
  a participant. Claude: native Monitor per `/collab-monitor`. Codex: no collab watcher; the
  lead's process-exit watch covers you. Follow an engine-issued mailbox contract when present.
- **Waiting = armed watch + return** (cmux adapter) or **end the turn** (T3). Re-arm on expiry and
  after every compaction; never inspect another agent's pane to infer state.
- **Stop the watcher when you post your DONE** — its life is exactly your lane's life.
- **Pings are pointers**: one line, where to look + why it is urgent. Detail lives here, because
  this file survives restarts and panes do not.
- If a handoff looks unanswered, check whether the recipient had a watcher before concluding
  anything about the recipient.

