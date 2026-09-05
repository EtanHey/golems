---
name: agent-routing
description: "Enforce Cursor=gather, Codex=implement, Claude=orchestrate. Triggers: delegate, worker assignment, routing."
---

# Agent Routing — CLI Tool Assignment Matrix

> Fleet law: canon #1 owns Cursor=gather, Codex=implement, Claude=orchestrate. This skill keeps routing mechanics, delegation checks, eval-backed anti-patterns, and prompt templates. Launcher/model law lives in canon #5/#6 plus `/repogolem`.

> **Auto-dispatch triggers** (canonical in orc/SKILL.md C4): batch reads ≥3, transcription ≥2,
> web research ≥1, or any "in parallel" / "all of these" phrasing → fan out sub-agents
> in the SAME message before asking permission.

---

## Launcher Pointer

agent-routing chooses **who** does the work; `/repogolem` owns launch law, including default model pins, explicit `-m`/`-E`, resume continuity/failures, `-s`, `-w`, and raw-CLI escape hatches.

```bash
brainlayerCursor -s "one-sentence task prompt here"     # gather / read-only
brainlayerCodex  -s "one-sentence task prompt here"     # implement
```

Visible cmux pane workers use repoGolem launchers, not raw `cursor`/`codex`/`claude`, copied env vars, manual `cd`, or `--fast`. Internal ephemeral subagents are a separate harness, and `--fast` remains forbidden there too. This routing skill makes no broader non-Cursor model-selection rule. `cursor-agent` is Auto-only in every harness: never pass `-m`/`--model` or a model field, because pinned Cursor usage drains the shared subscription pool fast.

---

## Model & Effort: Decide From the Mission

> **Ownership flag (2026-08-12):** The launcher/model-utilization law from
> this section through the Task -> Model Override Table belongs in repoGolem,
> not agent-routing. It remains here for a separate review; this PR does not
> migrate or ratify it. The Cursor Auto-only constraint is the sole model rule
> this PR adds here.

Effort is a mission choice, not a model personality trait. **Default to `high` so
the seat is never accidentally too low, then pass `-E` explicitly for every
repoGolem Codex mission.** When `high` fits, make that choice explicit with
`-E high` and explain why it fits; do not rely on inheritance.

Do not treat omission as neutral: if you omit `-E`, inheriting the default is a
decision you are making silently. A dispatch that does not name the effort and
the mission-shaped reason for it is defective.

The failure to avoid is a whole fleet booting at `xhigh` for everything. As the
answer shape becomes more known and the room for judgment disappears, effort
should come down with it.

Ask these questions in order:

1. **Is the task below the bounded-implementation bar?** Use the literal launcher
   value `low` (not `light`) when the answer shape is already known, the work is a
   direct mechanical transformation, and a deterministic check can settle it
   without judgment. A rename sweep, fixture regeneration, mechanical backfill,
   or document reformat can fit here when there are no design choices hiding
   inside the brief. `low` is the lowest rung for work beneath a normal
   implementation lane, not the new default for every bounded task.
2. **Is the lane bounded, mechanical, and independently verifiable?** Exact diff
   shape, established pattern, focused tests, binary rubric, and trivial rollback
   all point to `medium`. This is Etan's settled floor for well-specified
   implementation lanes; important work does not become `xhigh` merely because it
   matters.
3. **Does the lane still contain open-ended implementation or judgment?** Novel
   decomposition, error semantics, or non-trivial review defaults to Sol at
   `high`.
4. **Is the reasoning genuinely hard in a way more tokens can help?**
   Nondeterministic debugging, contradictory evidence, adversarial verification,
   or design under conflicting requirements can justify Sol at `xhigh`. Do not
   turn that exception into a fleet default.
5. **Would `max` materially beat `xhigh` here?** The general answer is **NOT
   KNOWN**. Use `max` only when a mission-specific eval proves the extra spend
   pays. repoGolem can now carry `-E max`, but reachability is not evidence that
   the rung improves the result.
6. **Is the model choice measured for this work shape?** Luna
   (`gpt-5.6-luna`) is a reasonable candidate for bounded mechanical, pattern, and
   audit work; Sol (`gpt-5.6-sol`) is the default for open-ended implementation.
   That Luna direction rests on one qualified head-to-head at `medium`: Luna
   scored ACCEPT and tied code taste at roughly 21x lower reported cost, but the
   inputs were cumulative session totals including cache reads. Treat the ratio
   as an upper-bound datapoint, measure output tokens and wall-clock as well as
   token price, and do not generalize it into universal doctrine.

What is **NOT KNOWN**: a measured Terra task-tier assignment, a broad
per-task-class Sol/Luna benchmark, Luna-at-`max` performance, a general rule for
choosing `max` over `xhigh`, or whether selecting supported `low`, `max`, or
`ultra` values materially changes observed behavior. `codex debug models
--bundled` verifies those rungs are supported; launcher passthrough and
session-config echo still do not prove behavioral effect. Do not fill those gaps
with vendor-tier intuition.

### Apply the choice, then verify it

- repoGolem passes effort correctly. Use, for example,
  `brainlayerCodex -s -E low "<known-output mechanical task>"`,
  `brainlayerCodex -s -E medium "<bounded implementation mission>"`, or
  `brainlayerCodex -s -E high "<open-ended mission>"`.
- Cursor has no model-pin carve-out: visible, headless, and internal
  `cursor-agent` runs all stay on Auto with no model flag or model field.
- cmuxlayer `spawn_agent.model` now preflights explicit Codex model names against
  the runtime model list before spawn. For every pinned run, still record the **requested and
  effective** model plus effort from the run log/session metadata. The effective
  values, not the prompt or agent's self-identification, are the routing evidence.

Before dispatch, write one sentence for each field:

```text
Mission shape: bounded/mechanical | open-ended | contradictory/adversarial
Choice: <effective-model target> at <low|medium|high|xhigh|max|ultra>
Why: <signals from the mission, not task importance alone>
Dispatch: <launcher/raw internal path and explicit effort pin>
Verification: <where the effective model+effort will be read>
Unknowns: <anything not measured; write NOT KNOWN rather than extrapolating>
```

---

## Task -> Model Override Table

Use this table after the role matrix chooses the worker type. It is a deliberate
override surface, not a quota-saving excuse: defaults are not limits, judge
output quality instead of price tag, and apply `intelligence > taste > cost`.
Cost is a tie-breaker only; in this column, a higher score means more economical
or more available for the task.

`model-pin-gate` blocks accidental Fable inheritance. When it blocks, pin one of
the exact rows below, or use explicit Fable only from an apex orchestration seat.
The gate block message already points here; this table points back to that pin
law without duplicating its hook logic.

| model | cost | intelligence | taste | default work |
|---|---:|---:|---:|---|
| `gpt-5.5` (via `codex exec`) | 9 | 8 | 5 | Bulk/mechanical work, implementation, refactors, debugging, tests, verification, and an extra review perspective. For visible workers, still use `{repo}Codex -s`; `codex exec` is only for an internal harness/thin `sonnet` wrapper that writes a self-contained Codex prompt and returns a digest. |
| `gpt-5.3-codex-spark` | separate pool; score pending | measure-first | measure-first | Weekly-pool wall override for implementation-shaped load only. For visible workers, still use repoGolem launcher policy; the explicit example `codex exec -m gpt-5.3-codex-spark -c model_reasoning_effort="medium" ...` is internal-harness only, as is the equivalent Codex model field. Pin `model_reasoning_effort` per call, verify the session `"model"` field, and do NOT route bulk transcript grep-and-cite mining to Spark until an effort-pinned retest clears it. |
| `sonnet` | 5; floor ~$0.03/call | 5 | 7 | Thin Claude wrappers, low-cost coordination, routine synthesis, and user-facing work that needs taste >=7 but not Opus-level reasoning. |
| `claude-opus-5[1m]` | NOT KNOWN for Opus 5; measure-first | measure-first | measure-first | Reviews, contested decisions, taste-sensitive writing, long-context synthesis, and reasoning where the extra judgment beats the token cost. Do not use it for token-grinding intake. **The cost and scores here are NOT KNOWN:** the prior row's `4; floor ~$0.09/call`, intelligence `7` and taste `8` were measured against **Opus 4.8** and were never re-derived for Opus 5. They are withheld rather than inherited — a renamed row carrying old figures reads as a verified current scorecard and is worse than an obviously stale one. Bench before restoring numbers. |
| `haiku` | floor ~$0.01/call; no policy score | measure-first | measure-first | Retained only as a measurement candidate. No policy default until benched; "never Haiku" is a hypothesis to test, not dogma. |

Fable is apex-orchestration only; post-2026-07-07 Fable usage spends usage
credits. Do not add a scored Fable row for general worker routing; current
pricing-floor lint uses ~$0.18/call as the Fable floor when it appears in gate
configs.

Reasoning effort is per tool call and should follow work shape, not model name.
Use the Model & Effort questions above for mission-shaped escalation through
`xhigh`. Act as though nothing right of `xhigh` exists unless a specific eval
proves the extra spend pays for itself; `ultracode` means `high` plus more spins,
not a blank check for `max` or `ultra` effort.

Grounding: Theo Gem-6 table (`docs.local/sprint/weave-2026-07-06-drift/sources/theo-fable-video-gems.md`), runbook delta notes (`docs.local/skills-audit-notes.md:151,177`), budget-floor pricing (`skill-creator/hooks-lab/gates/budget-floor-lint/SKILL.md`), and the paired pin law in `skill-creator/hooks-lab/gates/model-pin-gate`.

---

## The Routing Matrix

| Tool | Role | What It Does | What It NEVER Does |
|------|------|-------------|-------------------|
| **Cursor** | Data gathering | SQL queries, file scanning, codebase search, grep, read-only lookups, audit scans | Code changes, implementations, PRs, decisions |
| **Codex** | Implementation | Code changes, bug fixes, refactoring, test writing, PRs | Research, data gathering, orchestration |
| **Gemini (CLI)** | Visual heavy-lift | Frame batches, OCR, image-heavy /qa-video work, screenshot review, visual UI critique | Codebase changes, multi-file refactors, long human-fluid sessions |
| **Claude** | Orchestration | Coordination, user interaction, decisions, synthesis, BrainLayer queries, monitoring, long human-fluid sessions | SQL queries, bulk file reads, code implementation, bulk image reads |

Use this matrix to split mixed tasks: Cursor gathers, Codex implements, Claude orchestrates and reviews. Keep role-specific exceptions in the goal/collab brief.

## Lead Topology

Domain LEADs (brainlayerClaude, voicelayerClaude, phx-LEAD, skillCreatorClaude, …) are orchestrators one tier down from orc. The same routing matrix applies to them:

1. LEADs delegate implementation to Codex workers and keep their own worker monitor loop (canon #1/#7).
2. Lead goals must preserve orchestration duties: spawn/delegate, maintain health gates, synthesize, and verify.
3. Lead topology must be managed: a lead is an `agent_id` with `role:"orchestrator"` and left-column placement.
4. Tiny lead self-edits must be bounded, disclosed in the active collab, and isolated; larger work routes to a Codex+Claude pair.
5. Workflow/subagent fan-out is read-only recon/verification/synthesis except audio-dashboard builds; code implementation uses visible Codex-implements + Claude-reviews pairs.

## GOAL DELEGATION CONTRACT (2026-06-26 cmux remediation)

Routing is not only tool choice. A correct route must preserve the full user mission and attach it to the right existing worker.

Before delegating or re-delegating a lane:

1. **Reuse before spawn.** If the user references an existing cmux pane/agent, or the same repo/workspace/role lane already has a managed worker, reuse it unless it is dead, unhealthy, or the user explicitly asks for a replacement. Do not spawn a duplicate just to get a cleaner prompt.
2. **Supersede narrow goals, don't fork the lane.** If the existing worker has a stale or too-narrow prompt, send one explicit superseding goal to that same `agent_id`.
3. **Preserve the full delegation.** Copy the user's whole mission into the goal contract. Do not shrink a broad baseline/cleanup/planning request to the next local blocker. For BrainLayer baseline work, include PR/branch/worktree state, service health, queue/deferred-store replay, watcher coverage, real stats, data-retention constraints, and green/no-green criteria when those are part of the ask.
4. **Use a file-backed goal contract.** For complex or multi-hour work, write an absolute goal file first. Delivery syntax is harness-specific:

```text
Codex, only when verified: /goal Read and execute this goal file until complete: /abs/path/to/goal.md
Gemini/Antigravity: Read and execute this goal file until complete: /abs/path/to/goal.md
Cursor: use its verified goal command or a plain file-contract message; if the UI shows a duplicated footer prompt, verify accepted/working state before resending.
```

The goal file must include hard constraints, success criteria, report path, exact DONE marker, and green/no-green decision criteria.

5. **Monitor artifacts, not vibes.** After the goal is delivered, conserve lead context: wait on the report file/DONE marker and low-frequency health checks. Do not repeatedly read large pane scrollback unless debugging delivery, registry/screen disagreement, or a wedged prompt.
6. **File completion beats pane silence.** If the contracted report exists and ends with the required DONE marker, read the report and advance synthesis. If cmux `wait_for`/registry/pane state disagrees, record that as cmux health evidence; do not rerun the lane just because the pane did not send a final chat message.
7. **Zero workers must mean terminal state.** Do not close/stop/archive a worker just to make a workspace clean. A lane may disappear only after its collab row records `DONE` with verified report marker, `BLOCKED`/`NOT_GREEN` with file-backed handoff, or `TRANSFERRED` with successor `agent_id` and delivery evidence. Otherwise record `closure_without_artifact` and keep the lane visible.
8. **Green means real green.** PRs merged, CI green, or a UI showing 100% are insufficient for infra baseline claims. Verify the domain-specific health criteria in the goal file before saying green. If queue/deferred stores, unwatched roots, missing vectors, or probe/coverage gaps remain, say `NOT_GREEN`.
9. **User confusion is a stop sign.** If the user asks why work is happening, says the agent is confused, or corrects the route, pause further spawning/patching and explain current state from evidence before taking more tool actions. Store the correction separately; do not use memory capture as permission to keep doing unrelated work.
10. **Raw/orphan escape hatches must converge back to managed routing.** If a raw surface send, interrupted spawn, or orphan pane is used to unblock a lane, immediately recover/register or replace it with a managed `agent_id` and correct role/topology before treating it as production.

## Delegated Authority

Fleet law for approved queues, permission parking, and route-through-leads lives in canon #8. Routing mechanics:

1. Checkpoint branch, commit/PR, worker `agent_id`, report path, DONE marker, service/MCP state, and exact blocker.
2. If in scope and recoverable, continue through `/pr-loop`, restart/reload/re-index, or rebuild as needed.
3. If the current agent cannot reconnect after a restart, spawn or resume a managed successor with the same goal file and handoff path.
4. Verify with the real post-operation probe before reporting green.
5. Ask Etan only for truly irreversible or outside-mission actions: destructive data deletion, force-push/history rewrite, unowned-work cleanup, credential/account changes, paid external actions, or human-only license/ToS acceptance.

## Gemini Visual Exception

The user has explicitly named Gemini for these triggers (this is policy, not Claude's preference):

- User pastes a video URL + says "extract" / "analyze" / "process this video"
- Frame-by-frame OCR / vision read across many frames (`/qa-video`)
- Visual UI critique / screenshot review when there are multiple screenshots
- Anything where the natural plan is "spawn `claude` to read 30 frames" — switch to `gemini` and save Claude's 1M context for orchestration

`/qa-video` owns the Gemini-for-visuals workflow. Tool-surface changes (Cursor SDK, model IDs, vendor defaults) route through `/whats-new`; they do not change canon #1 without an explicit policy update.

---

## DECISION TREE

When you have a task to assign, walk this tree:

```
Is it a READ-ONLY operation? (query, scan, search, audit, lookup)
├── YES → CURSOR
│   Examples: SQL queries, grep patterns, file listing, codebase audit,
│   "what does this function do?", "find all usages of X"
│
└── NO → Does it change code or files?
    ├── YES → CODEX
    │   Examples: bug fix, refactor, new feature, test writing,
    │   "implement X", "fix the bug in Y", "add tests for Z"
    │
    └── NO → Is it coordination, synthesis, or decision-making?
        ├── YES → CLAUDE (you)
        │   Examples: plan review, collab kickoff, agent monitoring,
        │   BrainLayer queries, user interaction, research routing
        │
        └── UNCLEAR → Default to CURSOR for the data-gathering phase,
            then CODEX for any resulting implementation.
            Split into 2 tasks if needed.
```

**Split rule:** If a task has BOTH a gathering phase and an implementation phase, split it into two tasks. Cursor gathers, writes findings to `docs.local/`. Codex reads findings and implements. Claude reviews.

**Fan-out rule (parallel units → `/cursor-multitask`):** when a task decomposes into
N independent parallel units (classify N files, audit M things, tests+docs+examples,
parallel verification passes), invoke `/cursor-multitask` to pick the engine —
Cursor `/multitask` (in-editor GUI, `|||` syntax), headless `cursor-agent` shell
fan-out, the Claude Workflow tool, or the cmux fleet (visible multi-vendor workers →
`/cmux-agents`). A historical A/B record exists at
`cursor-multitask/evals/results/headless-ab-2026-06-05.json`, but its effective
runtime model and effort were not observed. It is non-comparable history and
must not be cited as numeric evidence.

Every Cursor engine in that choice is Auto-only and never model-pinned.

---

## VERIFICATION GATES

### Gate 1: Pre-Collab — Routing Declaration

Every collab file MUST include a routing section that declares which tool handles which task:

```markdown
## Agent Routing
| Task | Tool | Agent ID | Surface/Workspace | Goal File | Report Path | DONE Marker | Status |
|------|------|----------|-------------------|-----------|-------------|-------------|--------|
| Scan BrainLayer DB schema | Cursor | agent:abc | surface:XX / workspace:1 | goals/schema.md | reports/schema.md | DONE_SCHEMA | PENDING |
| Implement FTS5 fix | Codex | agent:def | surface:YY / workspace:1 | goals/fts5.md | reports/fts5.md | DONE_FTS5 | PENDING |
| Coordinate + review | Claude (orcClaude) | self | self | collab.md | final-report.md | DONE_ORC | IN_PROGRESS |
```

If a collab lacks this section, add it before spawning agents. If a row points to an existing cmux worker, reuse that `agent_id` and supersede with a full goal file instead of spawning a duplicate.

### Gate 2: Mid-Sprint — Worker Utilization Check

Every monitoring cycle (cron or manual), check:

1. **Is the Claude agent's context >50%?** If yes:
   - Check if its Cursor/Codex workers have received tasks
   - If workers are idle while Claude is burning context → VIOLATION
   - Action: nudge the Claude agent to delegate remaining data work

2. **Are Cursor/Codex surfaces alive?** Run `list_surfaces`:
   - If a worker surface is gone (crashed/closed) → respawn immediately
   - Don't wait for the Claude to notice — orcClaude owns surface health

3. **Is the Claude doing Cursor work?** Check if Claude is running:
   - `sqlite3` or SQL queries → should be Cursor
   - `grep` or `find` across many files → should be Cursor
   - `git log` analysis across repos → should be Cursor

4. **Does EACH dispatching LEAD have its own monitor loop on its workers?** A lead that
   dispatched a worker and went idle without a `/loop`/cron on it = fired-and-forgot
   violation. Flag the LEAD, not just the worker. orc's fleet monitor catches
   lead-busy/codex-idle inversions but does not replace the lead's own loop.

5. **Is the lead over-polling instead of waiting on file-backed completion?** If a goal file defines a report path and DONE marker, prefer that artifact. Large pane scrollback reads are for delivery failures, wedged prompts, or health disputes, not routine status narration.

6. **Did the lead preserve the user's full delegation?** Compare the goal file to the user's ask. If a broad baseline/cleanup mission was narrowed to one issue or one PR, mark the route invalid and supersede the same worker with the full goal.

### Gate 3: Post-Sprint — Utilization Audit

After a sprint completes, check:
- Did each Claude agent actually use its assigned workers?
- What % of data-gathering was done by Cursor vs Claude?
- If Claude did >30% of the data gathering → flag for process improvement

---

## ANTI-PATTERNS (from real sessions)

### AP1: Claude Does Everything Itself
> "So no cursors were run, it seems. Am I correct?" — User, L4357
> "Correct. brainClaude spawned one but never executed... skillCreatorClaude never spawned one at all." — orcClaude, L4357-4360

**Pattern:** Claude agent spawns a Cursor surface but never sends it work. Does all SQL/file scanning itself, burning 70%+ context on mechanical data extraction.

**Fix:** After spawning a Cursor worker, the FIRST action must be sending it a task. Verify delivery within 15 seconds (read_screen token count check).

### AP2: Cursor Used for Code Changes
> "I stopped Cursor because it seems like it sent it to do things I'm not looking for anyone to do things. This is research." — User, L4514-4517

**Pattern:** Cursor agent receives a task that includes implementation instructions, starts making code changes.

**Fix:** Cursor prompts must include: `"READ-ONLY: Do NOT modify any files. Report findings to [output path]. Exit when done."`

### AP3: Wrong Model on Worker

> "brainlayer cursor scan is GPT-5.4. What the hell?" — User, L3822

**Pattern:** Worker launched with a specific expensive model when Auto/default would suffice.

**Fix:** For visible workers, route by role here and use launcher/model policy from canon #5 plus `/repogolem`. Cursor data-gathering is Auto-only with no model override.

### AP4: Claude Implements When It Should Orchestrate
> brainClaude started implementing code fixes when it should only orchestrate — L4525-4548

**Pattern:** A Claude agent assigned as coordinator starts writing code itself instead of dispatching to Codex.

**Fix:** Claude agents in a collab with assigned Codex workers must NEVER use Write/Edit tools for implementation. Exception: collab file updates, docs, research prompts.

### AP5: Orc Burns Context on Content Creation
> orcClaude spent hundreds of lines writing research prompts, project files, and context docs directly — L343-598, 876-895

**Pattern:** Orchestrator writes long documents (research prompts, project descriptions) instead of delegating to a subagent or worker.

**Fix:** If a document will be >50 lines, delegate writing to a subagent. orcClaude should outline (5-10 bullet points) and assign, not draft 100-line documents.

---

## INTEGRATION WITH OTHER SKILLS

This skill is a **building block** used by higher-level skills:

| Skill | How It Uses Agent Routing |
|-------|--------------------------|
| `/orc` | Iron Rules R28+ reference this routing matrix |
| `/cmux-agents` | spawn-agent uses routing to pick CLI type |
| `/large-plan` | Phase assignment uses routing for tool selection |
| `/pr-loop` | Implementation phases route to Codex, review to Cursor |
| `/collab` | Collab template includes routing declaration section |

---

## AP6: False Tool Limitations (April 6, 2026)
> brainClaude: "Cursor Pro hit usage limit — can't use for audits this cycle"
> User: "CORRECTION: Cursor Pro does NOT have a usage limit"

**Pattern:** Agent assumes Auto has a usage cap and skips work. brainClaude skipped Cursor audits on PR #212-216 citing a nonexistent blanket "Cursor Pro usage limit." Pinned/Max Mode usage consumes the limited subscription pool fast; regular Auto remains the required path.

**Fix:** Cursor Pro limitations:
- `cursor agent "prompt"` (default model) — **UNLIMITED**. Use for all audits.
- Any Cursor invocation carrying `-m`/`--model` or a model field — **FORBIDDEN**. Pinned Cursor drains the shared subscription pool fast; use Auto.
- **NEVER skip audits citing "usage limit."** Switch to default model instead.

## AP7: Trusting Codex's Text Response About Its Own Model (April 15, 2026)

> Codex output: "I'm running as gpt-5.4..."
> Actual session metadata: `"model":"gpt-5.3-codex-spark"`

**Pattern:** Agent asks Codex which model it is, or reads Codex's self-description, and treats that text as authoritative. Codex's text response consistently says "gpt-5.4" regardless of which model is actually running. This masks misrouted launches because the self-id stays the same even when the actual session model changes.

**Fix:** Never trust Codex's self-identification. The **source of truth** is the session JSONL, and you must read the `"model"` field directly:

```bash
# Today's sessions — model field is the source of truth
grep -h -E '"model":' ~/.codex/sessions/$(date +%Y/%m/%d)/*.jsonl | sort -u

# Specific date
grep -h -E '"model":' ~/.codex/sessions/2026/04/15/*.jsonl | sort -u
```

`"model":"gpt-5.3-codex-spark"` confirms Spark. Check immediately after the task starts — don't ask Codex.

## AP9: Using Raw `codex` Instead of repoGolem Launchers (April 15, 2026)

> 19/19 sessions violated — 100% bypass rate.

**Pattern:** Agent spawns `codex "prompt"` directly instead of using `{repo}Codex -s` launcher.

**Why it's wrong:** No cd to repo dir, no iTerm profile, no model preset, no workspace isolation.

**Fix:** ALWAYS use `{repo}Codex` launcher (e.g., `golemsCodex -s`, `brainlayerCodex -s`). Use `--raw` escape hatch for edge cases only.

**Evidence:** `batch-M6-codex.md` — 0/19 used launchers.

## AP10: Skill/Hook Authorship Bypassing skillCreator (2026-05-16, incident-2026-05-16)

> Source: yashClaude + MainCodex session-mining 2026-05-16. brainbar-c95a8f3a-508 (audit), brainbar-9e70b920-079 (yashClaude mine), brainbar-fab97680-5ea (MainCodex mine), brainbar-ff137da8-e10 (routing-violation log).

**Pattern:** An orchestrator agent (yashClaude here) dispatches an implementation agent (MainCodex) with a mission that includes editing or creating files under `~/.claude/skills/**` or `~/.claude/hooks/**` — bypassing skillCreator (whose domain those paths are).

**Concrete example from 2026-05-16:** yashClaude at L3191 of its session sent MainCodex the full 4-layer Daemon Verification Gate mission, which included modifying `~/.claude/skills/golem-powers/pr-loop/SKILL.md` + creating `~/.claude/hooks/daemon-gate-precheck.py` + registering it in `~/.claude/settings.json`. MainCodex shipped all four layers cleanly — but the work passed through ZERO skillCreator audit before merge. Quality was fine in this case (skillCreator post-hoc audit found SHIP-grade hygiene per brainbar-c95a8f3a-508) but the ROUTING was wrong.

**Why it's wrong:** Skills + hooks are skillCreator's domain. The skillCreator agent has the expertise for skill description-triggering, hook PreToolUse stdout protocol (the legacy `sys.exit(0)` empty-stdout pattern was a bug fixed at brainbar today), failure-mode catalog discipline, and `/skill-creator` audit standards. Sending these to Codex or any other agent risks shipping with a stale convention or missing audit step.

**Fix — orchestrators MUST route-check before dispatch:**
1. Before sending a mission to ANY worker, grep the mission text for path patterns: `~/.claude/skills/`, `~/.claude/hooks/`, `~/.claude/agents/`, `~/.claude/CLAUDE.md`, `settings.json`.
2. If ANY match: re-route the touching parts of the mission to skillCreator (spawn skillCreator subagent if needed), OR add an explicit skillCreator-audit step BEFORE the worker's PR merges.
3. If the orchestrator IS skillCreator, no re-route needed.

**Fix — workers MUST route-check before patching:**
1. When a worker receives a mission, before its first Edit/Write to a `~/.claude/skills/**` or `~/.claude/hooks/**` path, brain_search("agent-routing skillCreator domain") to confirm.
2. If skillCreator is NOT already in the loop, send the orchestrator a route-check signal: "`This task touches skillCreator-domain files. Re-route or add skillCreator audit?`"
3. Pause the patch until orchestrator confirms.

**Evidence:** Two acknowledgements landed only POST-incident — MainCodex's retirement brain_store ("future changes under ~/.claude/skills/** and ~/.claude/hooks/** should route through skillCreator ownership") and yashClaude's handoff note. Catching it mid-flight would have prevented the routing violation (output quality was fine, but the principle matters for next time).

**Test for compliance:** When you (the orchestrator OR the worker) are about to Edit a file under `~/.claude/skills/**` or `~/.claude/hooks/**`, did skillCreator review the change first? If no → STOP. Route through skillCreator.

## AP11: Verbose Launcher Invocation Instead of `{repo}{Tool} -s` (2026-05-21, severity-10 user mandate)

**Pattern:** Agents dispatch visible cmux pane workers with raw CLIs, manual `cd`, copied env vars, or ad hoc flags instead of repoGolem launchers.

```bash
{repo}{Tool} -s "prompt"
```

Model-selection mechanics live in canon #5 plus `/repogolem`; detailed flag behavior, headless mode, worktree launching, and registry precedence live in canon #6 plus `/repogolem`. agent-routing only checks that the worker type matches the task.

Launchers handle cwd, MCP wiring, env vars, iTerm profile, secrets, and tab metadata; duplicating that ceremony is a routing smell.

## SPAWN INFRASTRUCTURE DEFAULTS (added 2026-04-29)

Launcher skip-perms and registry precedence live in canon #6 plus `/repogolem`. Routing still decides when isolation is needed:

| Scenario | Use |
|---|---|
| Sequential specialist (one at a time, like W13 → W22 → W23) | `git checkout -b fix/foo` in main repo. No worktree, no sandbox. One canonical app. |
| Truly parallel work, NO file overlap (Round 1-style sprint) | Native `git worktree` is fine. Verify MCP/config paths explicitly. Still no restrictive sandbox. |
| Parallel work WITH file overlap | Force serialize. Don't try to parallelize. |

### Cross-references
- Native `git worktree`: create only for real isolation needs, then verify MCP/config paths
- `/repogolem` skill: launcher flag reference (`-s` mappings already correct)
- `/orc` skill: pre-relay verification rule (Rule added 2026-04-29 to stop relaying stale evidence from workers)

## Usage Budget

Fleet model/usage law lives in canon #5. For routing, manage usage by dispatch-counting, splitting broad work into bounded workers, and avoiding unnecessary duplicate spawns.

## Self-Inflicted Quota Attribution

An agent that exhausts a shared quota through its own dispatch reports that
dispatch as the cause. It never presents the resulting `resource_exhausted`
state as an external root-cause finding.

---

## SELF-CHECK: Am I About to Violate R28?

**Run this check before EVERY Write/Edit/Bash-with-code-changes:**

```
PAUSE. Am I about to Write/Edit code?
├── Am I an orchestrator (orcClaude, or coordinating a collab)?
│   ├── YES → VIOLATION. Route to Codex/Cursor via cmux.
│   │   Exception: collab files, docs, research prompts, or Rule 7 tiny-unblocker edits
│   └── NO → Am I a domain agent (taskowlClaude, voiceClaude, etc.)?
│       ├── YES + no Codex worker assigned → OK (you ARE the implementer)
│       └── YES + Codex worker assigned → VIOLATION. Send to your Codex.
└── Does this exceed ANY Rule 7 tiny-unblocker bound? → Route to a Codex+Claude pair.
```

**From JSONL data (April 1-6, 2026):** Orchestrator sessions averaged 80+ Write/Edit calls per session. The worst had 190. The R28 target is <30 for orchestrators.

---

## QUICK REFERENCE — Copy-Paste for Collab Templates

```markdown
## Agent Routing (MANDATORY)

| Task | Tool | Rationale |
|------|------|-----------|
| [data gathering task] | Cursor (read-only) | Scanning, no changes needed |
| [implementation task] | Codex | Code changes, needs reasoning |
| [coordination task] | Claude | Orchestration, user interaction |

**Rules:**
- Cursor prompts MUST include "READ-ONLY: Do NOT modify any files"
- Cursor runs MUST stay on Auto with no `-m`/`--model` or model field
- Codex gets findings from Cursor's output, not raw data
- Visible worker launch form is `{repo}{Tool} -s "prompt"`; `/repogolem` owns launcher details.
- Reuse existing managed workers before spawning; if the mission changed, supersede with one file-backed goal contract using that harness's adapter syntax
- Goal files preserve the full user delegation and include report path, DONE marker, and green/no-green criteria
- Workflow/subagent fan-out is read-only recon/verification/synthesis except audio-dashboard builds; code implementation uses visible Codex-implements + Claude-reviews pairs, except for the bounded tiny-unblocker carve-out in Rule 7
- Leads monitor report files/DONE markers and low-frequency health, not high-frequency pane narration
- Zero worker panes means every lane is DONE, BLOCKED/NOT_GREEN with handoff, or TRANSFERRED; never close unfinished work for cleanliness
- Claude reviews Codex's PR, doesn't implement itself
- If a worker crashes, respawn within 60 seconds
```
