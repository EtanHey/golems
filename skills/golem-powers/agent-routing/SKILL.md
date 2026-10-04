---
name: agent-routing
description: "Route work to Cursor/Gemini/Codex/Claude; pick the fan-out engine. Triggers: delegate, who gathers, gemini gatherer, worker assignment, routing, Codex model/effort, subagents, /multitask, parallel agents, fan out, in parallel, batch classify/audit. NOT for one edit or dependent steps."
---

# Agent Routing

> This skill owns fleet routing rules, role selection, delegation checks, review ownership, and model/effort dispatch policy. `standards/model-roles.json` owns role → model; `/repogolem` owns launcher mechanics and canon #6 owns launcher law.

> **Auto-dispatch triggers** (canonical in `/orc` C4): batch reads >=3, transcription >=2,
> web research >=1, or any "in parallel" / "all of these" phrasing -> fan out sub-agents
> in the SAME message before asking permission.

## Routing rules (SSOT)

This section is the single source of truth for fleet routing. Fleet canon, global instructions, collab templates and other skills point here; models resolve through `standards/model-roles.json`.

### Gathering

Cursor or a `gemini.gather.*` gatherer gathers and verifies; Gemini handles the helper-eligible shapes described in the Role Matrix and decision rules below. A gatherer never implements, reviews or decides. Cursor, including `cursor-agent`, is Auto-only: never pass a model flag or model field; pinned Cursor drains its subscription pool.

### Implementation and review

| Work | Implements | Reviews | Plus |
|---|---|---|---|
| UX/UI | `claude.judgment` | Codex (`codex.implement`) | — |
| Security | `codex.security` at effort `high` | `claude.judgment` | a `codex-security` deep scan per security PR |
| Everything else (refactors, splits, deletions, tests, fixes, mechanical, docs) | `codex.implement` | `claude.judgment` | a deletion/test-edit decision by `claude.judgment` first (decision rule 2) |

The reviewer is always the other vendor.

Interim route (Etan 2026-09-30/10-01): Daybreak Blue requires a hardware security key from 2026-10-01. `codex.security` resolves to the interim model until Etan has keys; then one config line switches it back.

Security effort is `high` on the interim route (Etan 2026-09-30: "6.1 Sol high implements"); a security phase records it like any other phase effort.
When Daybreak Blue returns, evaluate its first security PRs: if they show more review rounds or more defects than the prior route, flip the pair (`claude.judgment` implements, Daybreak Blue reviews) and record the evidence in the PR bodies (carried from canon #1, 2026-09-29).

### Inner loop (sequential)

- The implementer goes first. The reviewer is spawned or briefed only after the implementer reports done: its DONE marker or report line, or for a cloud implementer, PR head stable ≥10 min with checks finished.
- A reviewer never reads a half-finished diff. They iterate until both are happy; then the implementer opens the remote PR and runs `/pr-loop`. Merge follows the lane's merge authority after the PR loop is happy.
- The LEAD routes the reviewer; a worker never starts its own. No reviewer pane means ask the lead. The lead is the escalation path, not a gate; its call is final when invoked, and it delegates the review decision to a reviewer worker.

This inner-loop pair review happens before the PR. `/pr-loop` bot and PR reviewers are separate. Pane mechanics live in `/collab-monitor` section "Completion -> Reviewer Handoff".

### Records

Each PR body records its implementer, review rounds, and bot/reviewer defects. Claude leads orchestrate and route work through visible panes.

### Model pins and dispatch

- Fresh boots run `claude.judgment` at 1M via the bare launcher pin. The pin follows the role's current model and the pin is never removed; it prevents a prior session's model persisting.
- Fable only via explicit per-invocation selection; a prior session's model never persists into the next.
- Every non-Cursor Agent/Workflow/Task spawn pins its model explicitly, resolved from roles. Cursor is the Auto-only exception.
- Effort is per `/large-plan` phase; declare effort + why and pass it explicitly at dispatch.
- Keep to ≤2–3 concurrent Claude dispatches, staggered.
- Usage is managed by default-pinning and dispatch-counting, not by usage-blocking buckets.

## Model roles

Roles live in `standards/model-roles.json`. From the golems checkout, resolve with
`node scripts/model-roles.mjs <role> --field model|alias|launcher_tier`
(select one field). Never hardcode a role-owned model name. Generated launcher
commands must keep the resolver substitution, not today's resolved literal. Read the role's status
and gate before dispatch: `codex.subagent.mechanical` is a candidate, bench before use.
The Routing rules (SSOT) section owns dispatch policy and the role config owns current model defaults; older model-selection recipes in the
references are pending PR 2b migration and cannot override the config.
Effort is not in the model-roles config; each `/large-plan` phase declares effort + why, and every dispatch passes it explicitly (Codex `-E` / `effort:`).
The launcher refuses a worker spawn without an explicit effort. Codex prompted/worker launches require `-E <level>` or `GOLEM_EFFORT`; bare interactive launches use Codex config. For Claude, `default` means omit the flag: Claude sub-agents inherit the session's effort unless their agent frontmatter sets `effort:` ([Claude Code sub-agents: Supported frontmatter fields](https://code.claude.com/docs/en/sub-agents#supported-frontmatter-fields)). Gemini uses `launcher_tier`.

## Read Map

- Choosing a Codex model or effort, comparing model cost/context, dispatching a Codex child, or verifying its runtime? Read [references/model-and-effort.md](references/model-and-effort.md). Use the role config for current defaults and candidate gates; that reference supplies runtime verification and detailed procedures pending PR 2b.
- Launching, reusing, monitoring, recovering, or closing a worker lane? Read [references/delegation-operations.md](references/delegation-operations.md).
- Creating or auditing a collab, diagnosing a routing failure, or copying a routing template? Read [references/verification-and-incidents.md](references/verification-and-incidents.md).
- Fanning out independent units, or asked about Cursor `/multitask`? Read [references/fan-out-engines.md](references/fan-out-engines.md) (recipes, gotchas, GUI prompt contract, dispatch hygiene).

Read every reference triggered by the mission before dispatch. The live reference owns its detailed procedure; Routing rules (SSOT) and the role config take precedence over conflicting routing or model-selection recipes.

## Role Matrix

| Tool | Role | Does | Never does |
|---|---|---|---|
| **Cursor** | Gather | SQL, file/code scans, grep, read-only lookups and audits | Changes files, implements, opens PRs, decides |
| **`codex.implement`** | Implement / review | Non-UX/UI, non-security code/docs changes, fixes, refactors, tests, PRs; UX/UI pair review per SSOT | Research, data gathering, orchestration |
| **`codex.security`** | Implement (security) | Security implementation per SSOT | Gathering, orchestration, reviewing its own work |
| **`gemini.gather.text` gatherer** (`{repo}Gemini -m $(node scripts/model-roles.mjs gemini.gather.text --field launcher_tier)`; this matches the launcher default) | Gather (text) | Doc/link/copy audits, inventories/counts, doc fetch+quote, local digests, BrainLayer recall | Implementing, reviewing, deciding (including a deletion or a test edit), UX/UI judgment |
| **`gemini.gather.visual` gatherer** (`{repo}Gemini -m $(node scripts/model-roles.mjs gemini.gather.visual --field launcher_tier)`; Pro-High via `-m pro` only when explicitly requested) | Gather (visual) | Frame/screenshot reads, OCR, video state changes, `/qa-video` frame work | Implementing, reviewing, deciding, UX/UI judgment |
| **`claude.judgment`** | Orchestrate / judgment | Coordinates, talks to users, decides, synthesizes, monitors, queries BrainLayer; UX/UI implementation and other-vendor pair review per SSOT | Bulk reads/SQL; non-UX/UI implementation |

Decision rules:

1. Read-only query, scan, search, audit, or lookup -> Cursor; for docs/link/copy/inventory gathers only, a `gemini.gather.text` gatherer; Pro-High only when explicitly requested; never a Low tier; single-fact sub-agent lookups follow the bounded exception below.
2. Anything that decides a code deletion or a test edit (callers=0, dispatch sites, tool→test maps, "safe to delete") -> `claude.judgment`. A gatherer's grep may feed it; the gatherer never concludes it. This applies to Cursor gathers too.
3. Code or file changes follow the Routing rules (SSOT) table: UX/UI -> `claude.judgment`; security -> `codex.security`; everything else -> `codex.implement`.
4. Coordination, synthesis, monitoring, or decisions -> `claude.judgment`; pane mechanics and bounded verifiers follow the cheap sub-agent rule below.
5. Mixed gather + implement work -> the gatherer (Cursor or Gemini) returns read-only findings; coordinating Claude records them under `docs.local/`; the implementer selected by Routing rules (SSOT) implements from that handoff. A deletion or test edit gets its `claude.judgment` decision (rule 2) before implementation.
6. Independent parallel units -> § Fan-out engine chooses the engine; Routing rules (SSOT) owns Cursor model selection.
7. A pasted video URL to extract/analyze/process, frame OCR, multi-screenshot critique, or any plan to make Claude read many frames -> a `gemini.gather.visual` gatherer through `/qa-video`; from an Agent-tool context, dispatch `visual-gatherer`; it runs `gemini.gather.visual` headless; use Pro-High only when explicitly requested.
8. UX/UI and design judgment stays on `claude.judgment`. Open-ended research: a Gemini gatherer may draft; the lead verifies before it reaches Etan. A gatherer never implements, reviews, merges, or decides.

**Evidence (skill-creator eval, 2026-09-25; visible cmux workers, mechanical answer keys, lead-scored):** 40 bounded text-gather tasks: Flash-Low 40/40 and Opus 5.5 40/40, 0 fabricated claims each; higher Gemini effort on text gave the same accuracy 2.8–4.7× slower. 20 mixed tasks (8 image reads, 4 video): Opus 20/20, Pro-High 20/20 (2:35), Flash-High 20/20 (6:17), Flash-Low 19/20 (missed counting distinct screens across a video). An open-ended Pro research draft had a dead citation, a stale "recent" item, and missed the key release. Limits: screening sample (n=60) on one Mac; not evidence for judgment, design, review, or code. 2026-09-25 ruling: Low tiers are not used for gathering. On a real narrated QA review Flash-Low found 15–16/22 vs Flash-High 21/22, with an invented quote.

Visual re-bench 2026-09-30 (22 visual items incl. 10 harder: near-dup screens, one-frame flash, 10 px OCR, contact-sheet diffs; n=2, headers verified): Flash-High 44/44, 0 fabrications, ~11 min per batch; Pro-High 43/44, ~3 min, fabricated its self-reported timing in 2/2 runs → visual tier = Flash-High.

### Evidence: deletion reachability

**Evidence for rule 2 (cmuxlayer CX-3 real recon slices; one repo, 28 tools, scored against a truth table from fresh `rg`):** callers=0 for 28 tools about to be deleted: Opus surfaced 3/3 deletion hazards; Flash-High and Haiku 0/3 (Flash-Low, a lower tier, was not run on this slice), and Flash-High called all 28 safe, which would have broken a by-name engine accessor used by 23 test files; Pro made 59 false positives. Tool→test-file map errors: Opus 1, Flash-High 16, Pro 21, Haiku 23. Docs/link audit: Opus, Flash-High and Flash-Low 0 errors (82 s, 87 s, ≈270 s); Pro 47 false positives from a gitignored build directory; Haiku 20 errors (16 misses, 4 substring-match false positives). The eval above passed callers=0 because its tasks were literal greps against a known answer key; deciding a deletion needs reachability reasoning (by-name lookups, policy tables, agent-facing text).

## Cheap sub-agents

Every `claude.judgment` seat (leads and workers) delegates parity tasks to
`claude.subagent.cheap`; pass its resolved alias as the Agent tool's `model`:
`node scripts/model-roles.mjs claude.subagent.cheap --field alias`.

- **brain-worker:** single-fact recall ("when did X merge", "what did Etan rule on Y"); use one cheap child instead of the judgment seat's own context.
- **orc-helper:** spawn/resume/send/read/wait/close pane mechanics; the packaged agent's `role:` pins its alias through the drift lint.
- **Verifiers:** rerun a claimed command, check an artifact exists, or read a report's DONE marker.

Keep `claude.judgment` for multi-source or decision-grade history, deletion decisions,
PR-gating reviews, and UX/UI judgment. Reserve judgment → 3× cheap fan-out for
high-stakes history only: it costs 3.4× and runs 2.6× slower. Pass this rule into
every judgment worker's brief. This is the bounded exception to general lookup routing.

### Evidence: sub-agent and cleanup routing

`skill-creator/docs.local/evals/2026-09-29-subagent-routing/RESULTS.md`: plain brain-worker recall parity at 0.46×; orc-helper 4/4 at 0.47×; verifiers 0 wrong at 0.55× (bounded cases; multi-source losses remain).
`skill-creator/docs.local/evals/2026-09-29-cleanup-routing/ROUTING-R2.md`: deletion hazards Opus 6/6 vs every Sol arm 4/6; `codex.implement` effort medium, never default xhigh (n=2 per arm/case).

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
- Cursor model selection lives in Routing rules (SSOT).
- Claude Workflow/Agent-tool fan-out is read-only recon, verification, or synthesis except audio-dashboard builds.
- Codex children may edit only inside their visible Codex parent's worktree; that parent owns acceptance.
- A standalone read-only lane remains Cursor even though a named Codex `recon` child exists for bounded fan-out inside a Codex lane.
- Skills, hooks, agent definitions, and global agent settings are skillCreator-domain work. If skillCreator is not already in the loop, stop and request its audit before patching.

## Lead Topology

Domain leads are orchestrators one tier below orc:

1. Leads delegate implementation according to Routing rules (SSOT); fleet canon #7 owns their worker-monitor guard.
2. Lead goals preserve orchestration duties: delegate, maintain health gates, synthesize, and verify.
3. A lead is a managed `agent_id` with `role:"orchestrator"` and left-column placement.
4. Tiny lead self-edits are capped at <=20 changed lines, one single-purpose change, and zero new files. They require an isolated worktree plus same-post collab disclosure of what changed, why urgent, and line count. Urgency alone never qualifies; everything else follows Routing rules (SSOT).
5. Reuse an existing healthy worker for the same repo/workspace/role lane; supersede its goal instead of spawning a duplicate.

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
- `/pr-loop`: branch through ready-for-review PR; Routing rules (SSOT) above owns the pre-PR pair.
- `/collab-monitor`: worker monitoring and reviewer handoff mechanics.
- `/qa-video`: Gemini visual workflow.
- `/whats-new`: tool-surface changes; they do not revise Routing rules (SSOT) by implication.
