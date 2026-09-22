---
name: agent-routing
description: "Enforce Cursor=gather, Codex=implement, Claude=orchestrate. Triggers: delegate, worker assignment, routing, Codex model/effort, subagents."
---

# Agent Routing

> Fleet law: canon #1 owns Cursor=gather, Codex=implement, Claude=orchestrate. This skill owns role selection, delegation checks, review ownership, and the Codex model x effort choice. `/repogolem` owns launcher mechanics; canon #5/#6 own non-Codex model and launcher law.

> **Auto-dispatch triggers** (canonical in `/orc` C4): batch reads >=3, transcription >=2,
> web research >=1, or any "in parallel" / "all of these" phrasing -> fan out sub-agents
> in the SAME message before asking permission.

## Read Map

- Choosing a Codex model or effort, comparing model cost/context, dispatching a Codex child, or verifying its runtime? Read [references/model-and-effort.md](references/model-and-effort.md). That reference owns the GPT-6 default, per-job Luna choice, and 5.6 fallback policy; do not duplicate them here.
- Launching, reusing, monitoring, recovering, or closing a worker lane? Read [references/delegation-operations.md](references/delegation-operations.md).
- Creating or auditing a collab, diagnosing a routing failure, or copying a routing template? Read [references/verification-and-incidents.md](references/verification-and-incidents.md).

Read every reference triggered by the mission before dispatch. The live reference, not this summary,
owns its detailed procedure.

## Role Matrix

| Tool | Role | Does | Never does |
|---|---|---|---|
| **Cursor** | Gather | SQL, file/code scans, grep, read-only lookups and audits | Changes files, implements, opens PRs, decides |
| **Codex** | Implement | Code/docs changes, fixes, refactors, tests, PRs | Research, data gathering, orchestration |
| **Gemini CLI** | Visual heavy-lift | Frame batches, OCR, multi-screenshot/video analysis | Codebase changes or orchestration |
| **Claude** | Orchestrate | Coordinates, talks to users, decides, synthesizes, monitors, queries BrainLayer, and performs UX-taste review passes | Bulk reads/SQL or implementation |

Decision rules:

1. Read-only query, scan, search, audit, or lookup -> Cursor.
2. Any code or file change -> Codex.
3. Coordination, synthesis, monitoring, or decisions -> Claude.
4. Mixed gather + implement work -> Cursor returns read-only findings; coordinating Claude records them under `docs.local/`; Codex implements from that handoff.
5. Independent parallel units -> `/cursor-multitask` chooses the fan-out engine; fleet canon #1 owns Cursor model selection.
6. A pasted video URL to extract/analyze/process, frame OCR, multi-screenshot critique, or any plan to make Claude read many frames -> Gemini through `/qa-video`.

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
- `/cursor-multitask`: parallelism-engine selection after this skill chooses the role.
- `/qa-video`: Gemini visual workflow.
- `/whats-new`: tool-surface changes; they do not revise canon #1 by implication.
