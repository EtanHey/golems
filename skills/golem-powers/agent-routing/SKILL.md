---
name: agent-routing
description: "Route work to Cursor/Gemini/Codex/Claude; pick the fan-out engine. Triggers: delegate, who gathers, gemini gatherer, worker assignment, routing, Codex model/effort, subagents, /multitask, parallel agents, fan out, in parallel, batch classify/audit. NOT for one edit or dependent steps."
---

# Agent Routing

> Fleet law: canon #1 owns Cursor/Gemini-gatherer=gather, Codex=implement, Claude=orchestrate. This skill owns role selection, delegation checks, review ownership, and the Codex model x effort choice. `/repogolem` owns launcher mechanics; canon #5/#6 own non-Codex model and launcher law.

> **Auto-dispatch triggers** (canonical in `/orc` C4): batch reads >=3, transcription >=2,
> web research >=1, or any "in parallel" / "all of these" phrasing -> fan out sub-agents
> in the SAME message before asking permission.

## Read Map

- Choosing a Codex model or effort, comparing model cost/context, dispatching a Codex child, or verifying its runtime? Read [references/model-and-effort.md](references/model-and-effort.md). That reference owns the GPT-6 default, per-job Luna choice, and 5.6 fallback policy; do not duplicate them here.
- Launching, reusing, monitoring, recovering, or closing a worker lane? Read [references/delegation-operations.md](references/delegation-operations.md).
- Creating or auditing a collab, diagnosing a routing failure, or copying a routing template? Read [references/verification-and-incidents.md](references/verification-and-incidents.md).
- Fanning out independent units, or asked about Cursor `/multitask`? Read [references/fan-out-engines.md](references/fan-out-engines.md) (recipes, gotchas, GUI prompt contract, dispatch hygiene).

Read every reference triggered by the mission before dispatch. The live reference, not this summary,
owns its detailed procedure.

## Role Matrix

| Tool | Role | Does | Never does |
|---|---|---|---|
| **Cursor** | Gather | SQL, file/code scans, grep, read-only lookups and audits | Changes files, implements, opens PRs, decides |
| **Codex** | Implement | Code/docs changes, fixes, refactors, tests, PRs | Research, data gathering, orchestration |
| **Gemini Flash-Low gatherer** (`{repo}Gemini -m flash-low`) | Gather (text) | Doc/link/copy audits, inventories/counts, doc fetch+quote, local digests, BrainLayer recall | Implementing, reviewing, deciding (including a deletion or a test edit), UX/UI judgment |
| **Gemini Pro-High gatherer** (`{repo}Gemini -m pro`) | Gather (visual) | Frame/screenshot reads, OCR, video state changes, `/qa-video` frame work | Implementing, reviewing, deciding, UX/UI judgment |
| **Claude** | Orchestrate | Coordinates, talks to users, decides, synthesizes, monitors, queries BrainLayer, and performs UX-taste review passes | Bulk reads/SQL or implementation |

Decision rules:

1. Read-only query, scan, search, audit, or lookup -> Cursor; a Gemini Flash-Low gatherer only for docs/link/copy/inventory gathers.
2. Anything that decides a code deletion or a test edit (callers=0, dispatch sites, tool→test maps, "safe to delete") -> Opus. A gatherer's grep may feed it; the gatherer never concludes it. This applies to Cursor gathers too.
3. Any code or file change -> Codex.
4. Coordination, synthesis, monitoring, or decisions -> Claude.
5. Mixed gather + implement work -> the gatherer (Cursor or Gemini) returns read-only findings; coordinating Claude records them under `docs.local/`; Codex implements from that handoff.
6. Independent parallel units -> § Fan-out engine chooses the engine; fleet canon #1 owns Cursor model selection.
7. A pasted video URL to extract/analyze/process, frame OCR, multi-screenshot critique, or any plan to make Claude read many frames -> a Gemini Pro-High gatherer through `/qa-video`.
8. UX/UI and design judgment stays on Opus 5.5. Open-ended research: a Gemini gatherer may draft; the lead verifies before it reaches Etan. A gatherer never implements, reviews, merges, or decides.

**Evidence (skill-creator eval, 2026-09-25; visible cmux workers, mechanical answer keys, lead-scored):** 40 bounded text-gather tasks: Flash-Low 40/40 and Opus 5.5 40/40, 0 fabricated claims each; higher Gemini effort on text gave the same accuracy 2.8–4.7× slower. 20 mixed tasks (8 image reads, 4 video): Opus 20/20, Pro-High 20/20 (2:35), Flash-High 20/20 (6:17), Flash-Low 19/20 (missed counting distinct screens across a video). An open-ended Pro research draft had a dead citation, a stale "recent" item, and missed the key release. Limits: screening sample (n=60) on one Mac; not evidence for judgment, design, review, or code.

**Evidence for rule 2 (cmuxlayer CX-3 real recon slices; one repo, 28 tools, scored against a truth table from fresh `rg`):** callers=0 for 28 tools about to be deleted: Opus surfaced 3/3 deletion hazards; Flash-High and Haiku 0/3, and Flash-High called all 28 safe, which would have broken a by-name engine accessor used by 23 test files; Pro made 59 false positives. Tool→test-file map errors: Opus 1, Flash-High 16, Pro 21, Haiku 23. Docs/link audit: Opus, Flash-High and Flash-Low 0 errors (82 s, 87 s, ≈270 s); Pro 47 false positives from a gitignored build directory; Haiku 20 substring-match errors. The eval above passed callers=0 because its tasks were literal greps against a known answer key; deciding a deletion needs reachability reasoning (by-name lookups, policy tables, agent-facing text).

## Fan-out engine

Once the work is known to be N independent units, pick the parallelism engine. Full recipes and
evidence: [references/fan-out-engines.md](references/fan-out-engines.md).

**Cursor `/multitask` is an in-editor GUI slash command, not a `cursor-agent` CLI feature.** Sent to
a headless agent, it degrades to one plain prompt answered by ONE agent that may claim it ran in
parallel. A terminal/cmux orchestrator never uses it.

| Task shape | Engine |
|---|---|
| Human in the Cursor editor, independent read-heavy prompts | Cursor `/multitask` (GUI; `\|\|\|`-separated; no write locking) |
| Headless / scripted / CI / terminal orchestrator; want determinism + per-agent tokens | `cursor-agent -p --force --output-format json … &` + `wait` (Auto model, never `-m`) |
| Inside a Claude session; let the parent decide the split | Claude Workflow / Agent tools |
| Visible, multi-vendor, long-running, human-watchable workers | cmux fleet (`/cmux-agents`) |
| One coherent edit, or step B needs step A's output | None: run serially in one agent |

Fan out the read-heavy discovery; make the changes in one agent that holds the whole picture.

## Dispatch Boundaries

- Visible-worker launch law lives in fleet canon #6; `/repogolem` owns invocation mechanics and [delegation operations](references/delegation-operations.md#launcher-boundary) owns the `--fast` prohibition.
- Cursor model selection lives in fleet canon #1.
- Claude Workflow/Agent-tool fan-out is read-only recon, verification, or synthesis except audio-dashboard builds.
- Codex children may edit only inside their visible Codex parent's worktree; that parent owns acceptance.
- A standalone read-only lane remains Cursor even though a named Codex `recon` child exists for bounded fan-out inside a Codex lane.
- Skills, hooks, agent definitions, and global agent settings are skillCreator-domain work. If skillCreator is not already in the loop, stop and request its audit before patching.

## Lead Topology

Domain leads are orchestrators one tier below orc:

1. Leads delegate implementation to Codex; fleet canon #7 owns their worker-monitor guard.
2. Lead goals preserve orchestration duties: delegate, maintain health gates, synthesize, and verify.
3. A lead is a managed `agent_id` with `role:"orchestrator"` and left-column placement.
4. Tiny lead self-edits are capped at <=20 changed lines, one single-purpose change, and zero new files. They require an isolated worktree plus same-post collab disclosure of what changed, why urgent, and line count. Urgency alone never qualifies; everything else follows Review routing.
5. Reuse an existing healthy worker for the same repo/workspace/role lane; supersede its goal instead of spawning a duplicate.

## Review routing

**Temporary budget rule — sprint beginning 2026-09-22, usage-driven, expires at sprint end:**
the LEAD opens both implementation panes: a Codex implementer and a Codex reviewer. They iterate
until both are happy; then the implementer opens the ready-for-review PR and runs `/pr-loop`.
Claude is reserved for UX-taste review passes during this sprint. When the sprint ends, reviewer
routing reverts to a Claude pair-reviewer under fleet canon #1 (`standards/fleet-canon.md`).

The durable core is unconditional: the LEAD routes the reviewer, and a WORKER never starts any
reviewer for its own work. No reviewer pane means ask the lead.

This inner-loop pair review happens before the PR. `/pr-loop` bot and PR reviewers are separate.
Pane mechanics live in `/collab-monitor` section "Completion -> Reviewer Handoff".

## Goal Contract

Every complex or multi-hour dispatch uses one absolute file-backed goal containing the full user
mission, constraints, green/no-green criteria, report path, and exact DONE marker. Reuse and
supersede before spawning. A lane may close only as verified `DONE`, file-backed
`BLOCKED`/`NOT_GREEN`, or `TRANSFERRED` with successor evidence. A DONE marker is only a prompt to
verify the contracted artifact.

If the user questions why work is happening or corrects the route, pause spawning and patching,
explain the evidence-backed state, and store the correction separately.

## Cross-Skill Ownership

- `/repogolem`: launcher flags, defaults, resume behavior, and raw escape hatches.
- `/pr-loop`: branch through ready-for-review PR; Review routing above owns the pre-PR pair.
- `/collab-monitor`: worker monitoring and reviewer handoff mechanics.
- `/qa-video`: Gemini visual workflow.
- `/whats-new`: tool-surface changes; they do not revise canon #1 by implication.
