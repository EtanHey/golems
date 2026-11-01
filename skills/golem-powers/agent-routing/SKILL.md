---
name: agent-routing
description: "Invoke before any git/gh/grep, even for context, to dispatch a worker/reviewer, hand off to Codex, delegate_task, fan out in parallel; who gathers, gemini gatherer, Codex model/effort, subagents, /multitask, batch classify/audit. NOT for fanning out one edit or dependent steps."
---

# Agent Routing

> This skill owns fleet routing rules, role selection, delegation checks, review ownership, and model/effort dispatch policy. `standards/model-roles.json` owns role → model; `/repogolem` owns launcher mechanics and canon #6 owns launcher law.

> **Auto-dispatch triggers** (canonical in `/orc` C4): batch reads >=3, transcription >=2,
> web research >=1, or any "in parallel" / "all of these" phrasing -> fan out sub-agents
> in the SAME message before asking permission.

## Kickoff contract

- **Claude seats:** invoke `/agent-routing` with the Skill tool before the first dispatch of a lane: a worker or helper, a `delegate_task`, a hand-off, or a provider/model choice. Make it the first tool call, before any git/gh/grep orientation: live misses open with `git status`/`gh pr` and never load the skill (PR15 trigger eval, 2026-10-19).
- **Codex seats:** read this SKILL.md body (a file read) before that action; Codex has no Skill tool.
- **A lead's kickoff brief** to a worker names the skills the worker invokes (`/large-plan`, `/agent-routing`, `/pr-loop`).
- Standing ask: "Once its PRs land, invoke the updated skills at the start of each plan, dispatch or PR action." (Etan 2026-10-18, via orc collab)
- Why: Claude T3 leads made 0 Skill calls on Oct 16–18 while all three lead skills sat in their catalog (skill-edits audit, 2026-10-18).

## Service tier and placement

- Lead launch prompts say: "Read and follow <repo>/LEAD.md and the global LEAD.md" (`~/.codex/LEAD.md`, installed from the private global instruction source). Neither shared instruction body imports the lead layer; delegates' briefs never name it.
- Every delegate/sub-agent explicitly passes Claude `fastMode:false` or Codex `serviceTier:"default"`. Elevated service requires Etan's explicit request for that task.
- Harness examples do not authorize elevated service.
- Lead threads use the repo root checkout (`t3_thread_launch` with `workspaceStrategy:{type:"root"}`); only worker threads bind worktrees.
- Use Theo's official T3 Code nightly; never build or install T3 from our fork.

Attribution: Etan, 2026-10-26.

## Routing rules (SSOT)

This section is the single source of truth for fleet routing. Fleet canon, global instructions, collab templates and other skills point here; models resolve through `standards/model-roles.json`.

### Gathering

Codex Luna/Terra or Claude Haiku may gather per the 2026-10-28 rule below. Cursor or a `gemini.gather.*` gatherer gathers and verifies; Gemini handles the helper-eligible shapes described in the Role Matrix and decision rules below. A gatherer never implements, reviews or decides. Cursor, including `cursor-agent`, is Auto-only: never pass a model flag or model field; pinned Cursor drains its subscription pool.

### Execution capability

A task that must RUN COMMANDS (shell, ffmpeg/media conversion, builds, tests, installs, or file writes) never goes to a read-only gatherer profile (agy `gatherer`, no shell). The brief names the execution profile and required tool access.

Gemini spawns select the agy profile by task: command execution uses the shell-capable `shell-worker` profile; media QA uses `video-qa`; read-only research uses `gatherer`. Never default to `gatherer`. Verify the named profile supports the whole task: `video-qa` has `run_command` and artifact writes, but forbids code edits and installs; route those to an executor with the required access.

### Implementation and review

#### Implementation default (Etan, 2026-10-29)

Historical quote (superseded by the 2026-10-28 default):

> "**EXPERIMENT, starting now for a few days: FLIP the roles.** Claude Opus 5.5 IMPLEMENTS and Codex gpt-6.1-sol REVIEWS." (Etan 2026-10-18, via orc collab)

- Historical metrics remain: "Track it in your STATUS: PRs merged per day, hours from open to merge, defects caught after merge. We compare at the end." (Etan 2026-10-18, via orc collab)
Etan (2026-10-28, via orc/PHX): use Sol/Terra/Luna for more of the work so the Claude 5-hour window survives; not all work needs Claude.

- Default implementers (2026-10-29, replaces the 2026-10-28 Sol/Terra default; Etan, via fleet control: Claude quality is generally higher on holistic work, Codex stays heavy on recon): holistic/product work (skill and doc text, UX/UI, product behaviour, multi-file feature work, anything where judgment and coherence matter) → Claude Opus implements. Sonnet/Haiku never implement; they are sub-agents only for trivial edits (changing some words). Narrow technical work (a bounded fix, a parser/guard/CI script, a mechanical refactor, a dependency bump) → Codex implements (Sol hard, Terra bounded). Claude also holds the leads. Codex workers keep fresh context, bounded lifetime (one PR or ~100 turns), explicit effort and `serviceTier:"default"`.
- Reviewers (2026-10-29) are always the other vendor: Sol reviews a Claude implementation, `claude.judgment` reviews a Codex implementation, with no exception. Gemini/Antigravity gather and never review.
- UI/UX (2026-10-28): Claude Opus implements and reviews taste; Codex handles only mechanical parts. A fresh taste reviewer and the other-vendor reviewer remain required.
- Leads are Claude only; Codex never holds a lead seat or long context. "I think codexes should just be workers and not leads and not hold long context." (Etan, 2026-10-28)
- Fan-outs, gathers and mechanical work (2026-10-28) use Luna/Terra/Haiku; Sonnet 5.5 is a valid worker tier between Haiku and Opus. Antigravity's pool is for research/gather.
- Keep the Claude 5h window alive (2026-10-28). Never fast/priority: explicitly pass `fastMode:false` / `serviceTier:"default"`. This supersedes the dated budget-pacing note; it does not revert at a window reset.

| Work | Implements | Reviews | Plus |
|---|---|---|---|
| UX/UI | `claude.judgment` | Codex (`codex.implement`) | — |
| Security | `codex.security` at effort `high` | `claude.judgment` | a `codex-security` deep scan per security PR |
| Holistic/product work (skill and doc text, product behaviour, multi-file features, anything where judgment and coherence matter) | `claude.judgment` (Opus; Sonnet/Haiku only as sub-agents for trivial wording edits), 2026-10-29 | Codex Sol (`codex.implement`) | a deletion/test-edit decision by `claude.judgment` first (decision rule 2) |
| Narrow technical work (a bounded fix, a parser/guard/CI script, a mechanical refactor, a dependency bump, tests, deletions) | Codex Sol (hard) / Terra (bounded), 2026-10-29 | `claude.judgment` | a deletion/test-edit decision by `claude.judgment` first (decision rule 2) |
| Ratchets and TLC/TLA+ specs (ratchet rows, budgets, runners and attestation; formal models and their invariants) | `claude.judgment` (Opus) designs and builds, 2026-10-29 (Etan, via orc: highest quality, thought through). Tiny exception: Codex may build a mechanical edit to an existing Opus-designed threshold or row (no new runner, attestation, model or invariant design) | Codex Sol (`codex.implement`) reviews an Opus build; a fresh `claude.judgment` reviews a tiny Codex build, including design conformance | this row wins over "CI script" above; any other Codex-built ratchet or model gets an Opus design-conformance review and rework before merge; a lead self-edit also stays inside the Lead Topology cap |

The reviewer is always the other vendor.

Interim route (Etan 2026-09-30/10-01): Daybreak Blue requires a hardware security key from 2026-10-01. `codex.security` resolves to the interim model until Etan has keys; then one config line switches it back.

Security effort is `high` on the interim route (Etan 2026-09-30: "6.1 Sol high implements"); a security phase records it like any other phase effort.
Deep scans run from `<repo>Codex --scan -E high` (workspace-write, no approvals, computer use off, Locals T3code on by default, Drive read-only and other connectors off, the `codex.security` model, a per-launch Deep Scan cost cap); a bypass seat cannot start one. XS/S security PRs get a diff-scoped Standard scan, M/L or anything touching auth/guards a full Deep scan; the PR body records the scan's reported token use, and cost is never a reason to skip it.

Proven T3 Deep-scan route (try it before the interim below): from the lead, `delegate_task` with `runtimeMode: "auto"` on the `codex` instance, gpt-6.1-sol at high effort, serviceTier `default`, scope `.` (Deep scans the whole target). `auto` gives the managed workspace-write profile Deep needs; `full-access` disables it. The child's completion wakes the lead, so no `t3_thread_send` is needed. The start call blocks until the scan aggregates, so don't wait for an early scan id. Also proven end to end: a top-level T3 Codex thread with runtimeMode `auto`. It can't `t3_thread_send` to a `full-access` lead (`runtime_mode_escalation_denied`), so its brief names a report path and the lead reads that report. Proven 2026-10-27 on etanheyman.com #127 and a delegated start probe.

**T3 seats (interim):** If the Deep scan can't start from a T3 seat ("the parent must provide a managed filesystem permission profile"), run a Standard scan with its scope widened to every touched auth/guard path, plus one full-repo Standard pass. Record in the PR body: "Deep scan unavailable from T3 (interim)", both scans' scope, and their reported token use. Tell the Claude security reviewer, before its round, that Deep was unavailable and which Standard scopes ran. Cost is never a reason to skip either pass.

When Daybreak Blue returns, evaluate its first security PRs: if they show more review rounds or more defects than the prior route, flip the pair (`claude.judgment` implements, Daybreak Blue reviews) and record the evidence in the PR bodies (carried from canon #1, 2026-09-29).

### Inner loop (sequential)

- The implementer goes first. The reviewer is spawned or briefed only after the implementer reports done: its DONE marker or report line, or for a cloud implementer, PR head stable ≥10 min with checks finished.
- A reviewer never reads a half-finished diff. They iterate until both are happy; then the implementer opens the remote PR and runs `/pr-loop`. Merge follows the lane's merge authority after the PR loop is happy.
- The LEAD routes the reviewer; a worker never starts its own. No reviewer pane means ask the lead. The lead is the escalation path, not a gate; its call is final when invoked, and it delegates the review decision to a reviewer worker.

This inner-loop pair review happens before the PR. `/pr-loop` bot and PR reviewers are separate. Pane mechanics live in `/collab-monitor` section "Completion -> Reviewer Handoff".

### Review sizing

Review is sized to risk; the PR's `size:*` label sets the tier.

- "XS/S: 1 reviewer, 1 round." (Etan 2026-10-18, via orc collab) That reviewer is the other vendor, per the table above; UI/style PRs follow the UI flow below.
- M: up to 2 rounds, and round 2 only for BLOCKING findings (canon #9).
- "Full panel only for L, data or security paths, and that panel = Opus + Cursor working as a team. **NO Gemini Argon as a reviewer** (it fabricates)." (Etan 2026-10-18, via orc collab) The panel is a fresh `claude.judgment` reviewer plus a read-only Cursor diff pass, giving one shared verdict; the Cursor pass is a read-only input to the Opus verdict, not a reviewer. When the implementer is `claude.judgment` (holistic/product or UX/UI work), the table's Codex reviewer stays on, so cross-vendor review still holds. No Gemini model ever reviews, at any size.
- UI/style PRs: "a Codex worker uses computer use to record the changed states (default, hover, clicked, …), then hands the recording to an Opus reviewer." "That reviewer loads the frontend-design skill (`frontend-design:frontend-design`, the latest Anthropic one) and judges the UX/UI." (Etan 2026-10-18, via orc collab) The recorder resolves `codex.implement` and reports functional defects; proof requirements now follow [pr-loop Visual proof](../pr-loop/SKILL.md#visual-proof).
- UI flow (Etan FRONTEND RULE, 2026-10-28): A Claude-implemented visual slice gets the red-team Claude (taste, BOTH skills) plus the table's Codex reviewer (cross-vendor, canon #1); Codex plumbing gets the red-team Claude, which is already the other vendor. Both reviews cite the Visual proof.
  The red-team Claude is a fresh `claude.judgment`, never the implementer, loading `frontend-design:frontend-design` and `emil-design-eng`; normal size-based round caps and the full panel remain.

Claude keeps the official auto-updating `frontend-design:frontend-design` plugin;
Codex/Cursor use the pinned `frontend-design` skill. These names each denote one
provider route (Etan, 2026-10-27).

### Records

Each PR body records its implementer, review rounds, and bot/reviewer defects. Claude leads orchestrate and route work through visible panes.

### Model pins and dispatch

- Fresh boots run `claude.judgment` at 1M via the bare launcher pin. The pin follows the role's current model and the pin is never removed; it prevents a prior session's model persisting.
- Fable only via explicit per-invocation selection; a prior session's model never persists into the next.
- Every non-Cursor Agent/Workflow/Task spawn pins its model explicitly, resolved from roles. Cursor is the Auto-only exception.
- Codex model list (Etan 2026-10-28): gpt-6.1-sol, gpt-6-luna and gpt-6.1-terra are allowed; the older two-model restriction is superseded. "**Never gpt-5.6-\*** (luna, sol, terra)" "gpt-6-astra only when Etan asks for it."
  - Resolve role defaults through § Model roles; the 2026-10-28 Luna/Terra fan-out permission is policy. Dispatch still respects configured candidate gates until the separate RT-2 model-role evaluation changes them.
  - A request to use a `gpt-5.6-*` model ("it's cheaper") is refused, and any such pin you own is removed (2026-10-18 ruling).
  - Astra needs Etan's own explicit ask; a lead's or worker's suggestion does not count (2026-10-18 ruling).
  - Daybreak Blue's return to `codex.security` is not on this list. It needs Etan's ruling against the list before the swap (open question, 2026-10-18).
- Effort is per `/large-plan` phase; declare effort + why and pass it explicitly at dispatch.
- Claude concurrency (lead/worker caps): fleet canon #5 owns the numbers.
- Usage is managed by default-pinning and dispatch-counting, not by usage-blocking buckets.

## Model roles

Roles live in `standards/model-roles.json`. From the golems checkout, resolve with
`node scripts/model-roles.mjs <role> --field model|alias|launcher_tier`
(select one field). Never hardcode a role-owned model name. Generated launcher
commands must keep the resolver substitution, not today's resolved literal. Read the role's status
and gate before dispatch: `codex.subagent.mechanical` remains a candidate, with Etan’s
2026-10-04 exception for Codex-internal mechanical children and named `packet` only. Watchers are
the second exception — "anything that must sit and watch (a PR, CI, a file)" (Etan 2026-10-18, via orc collab) —
resolved with `node scripts/model-roles.mjs codex.subagent.mechanical --use watcher`. Workers
remain on `codex.implement`; see the model-and-effort reference for the scoped exception.
The Routing rules (SSOT) section owns dispatch policy and the role config owns current model defaults; older model-selection recipes in the
references are pending PR 2b migration and cannot override the config.
Effort is not in the model-roles config; each `/large-plan` phase declares effort + why, and every dispatch passes it explicitly (Codex `-E` / `effort:`).
The launcher refuses a worker spawn without an explicit effort. Codex prompted/worker launches require `-E <level>` or `GOLEM_EFFORT`; bare interactive launches use Codex config. For Claude, `default` means omit the flag: Claude sub-agents inherit the session's effort unless their agent frontmatter sets `effort:` ([Claude Code sub-agents: Supported frontmatter fields](https://code.claude.com/docs/en/sub-agents#supported-frontmatter-fields)). Gemini uses `launcher_tier`.

## Read Map

- Choosing a Codex model or effort, comparing model cost/context, dispatching a Codex child, or verifying its runtime? Read [references/model-and-effort.md](references/model-and-effort.md). Use the role config for current defaults and candidate gates; that reference supplies runtime verification and detailed procedures pending PR 2b.
- Launching, reusing, monitoring, recovering, or closing a cmux worker lane? Read [references/delegation-operations.md](references/delegation-operations.md). Its monitor-loop and isolation mechanics are the cmux adapter.
- Creating or auditing a collab, diagnosing a routing failure, or copying a routing template? Read [references/verification-and-incidents.md](references/verification-and-incidents.md).
- Fanning out independent units, or asked about Cursor `/multitask`? Read [references/fan-out-engines.md](references/fan-out-engines.md) (recipes, gotchas, GUI prompt contract, dispatch hygiene).
- Dispatching child work from a T3 thread (`delegate_task`, review rounds, pending questions, PR watch)? Read [references/t3-native.md](references/t3-native.md). It owns the T3 child lifecycle (dispatch, wait, isolation, verify, settle), not delegation-operations.md: for a T3 child skip that file's monitor loop and no-worktree route.

Read every reference triggered by the mission before dispatch. The live reference owns its detailed procedure; Routing rules (SSOT) and the role config take precedence over conflicting routing or model-selection recipes.

## Role Matrix

| Tool | Role | Does | Never does |
|---|---|---|---|
| **Cursor** | Gather | SQL, file/code scans, grep, read-only lookups and audits | Changes files, implements, opens PRs, decides |
| **`codex.implement`** | Implement / review | Narrow technical implementation (Sol hard, Terra bounded) and cross-vendor review per SSOT (2026-10-29) | Research, data gathering, orchestration |
| **`codex.security`** | Implement (security) | Security implementation per SSOT | Gathering, orchestration, reviewing its own work |
| **`gemini.gather.text` gatherer** (`{repo}Gemini -m $(node scripts/model-roles.mjs gemini.gather.text --field launcher_tier)`; this matches the launcher default) | Gather (text) | Doc/link/copy audits, inventories/counts, doc fetch+quote, local digests, BrainLayer recall | Running commands, implementing, reviewing, deciding (including a deletion or a test edit), UX/UI judgment |
| **`gemini.gather.visual` gatherer** (`{repo}Gemini -m $(node scripts/model-roles.mjs gemini.gather.visual --field launcher_tier)`; Pro-High via `-m pro` only when explicitly requested) | Gather (visual) | Frame/screenshot reads, OCR, video state changes, optional bulk pre-sorting for `/qa-video` (its runner views the frames behind its findings itself) | Running commands, implementing, reviewing, deciding, UX/UI judgment |
| **`claude.judgment`** | Orchestrate / judgment | Coordinates, talks to users, decides, synthesizes, monitors, queries BrainLayer; holistic/product and UX/UI implementation and other-vendor pair review per SSOT | Bulk reads/SQL; narrow technical implementation (Codex's lane) |

Decision rules:

1. Read-only query, scan, search, audit, or lookup -> the fan-out/gather models permitted by the 2026-10-28 SSOT rule or Cursor; for docs/link/copy/inventory gathers only, a `gemini.gather.text` gatherer; Pro-High only when explicitly requested; never a Low tier; single-fact sub-agent lookups follow the bounded exception below.
2. Anything that decides a code deletion or a test edit (callers=0, dispatch sites, tool→test maps, "safe to delete") -> `claude.judgment`. A gatherer's grep may feed it; the gatherer never concludes it. This applies to Cursor gathers too.
3. Code or file changes follow the Routing rules (SSOT) table: UX/UI -> `claude.judgment`; security -> `codex.security`; holistic/product work (skill and doc text, product behaviour, multi-file features) -> Claude Opus (Sonnet/Haiku only as sub-agents for trivial wording edits); narrow technical work (bounded fix, parser/guard/CI script, mechanical refactor, dependency bump) -> Codex Sol (hard) / Terra (bounded); ratchets and TLC/TLA+ specs -> Opus designs and builds (the table's ratchet row owns the tiny exception); the reviewer is always the other vendor (2026-10-29).
4. Coordination, synthesis, monitoring, or decisions -> `claude.judgment`; pane mechanics and bounded verifiers follow the cheap sub-agent rule below.
5. Mixed gather + implement work -> the gatherer (Cursor or Gemini) returns read-only findings; coordinating Claude records them under `docs.local/`; the implementer selected by Routing rules (SSOT) implements from that handoff. A deletion or test edit gets its `claude.judgment` decision (rule 2) before implementation.
6. Independent parallel units -> § Fan-out engine chooses the engine; Routing rules (SSOT) owns Cursor model selection.
7. For video extraction/processing that runs commands, select the execution profile under § Execution capability first. Video QA, debrief or review -> `/qa-video`, whose runner views the contact sheets and the frames behind its findings itself and connects them over time; a `gemini.gather.visual` gatherer may pre-sort bulk frames, but its text is a lead, never evidence. Standalone frame OCR or bulk screenshot reads outside that pipeline -> a `gemini.gather.visual` gatherer; from an Agent-tool context, dispatch `visual-gatherer`; it runs `gemini.gather.visual` headless; use Pro-High only when explicitly requested.
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
- **Verifiers (one-shot):** rerun a claimed command once, check now whether an artifact exists, or read a report's DONE marker.
- **Deploy hops:** release → install → restart → live probe → seat reconnect go to the
  `deploy-local-prod` sub-agent (Agent tool `subagent_type: "deploy-local-prod"`, model pinned to the
  resolved `claude.subagent.cheap` alias). The lead routes the hop and verifies the artifact it reports.
  Deploy hops stay on the MBP/M4; the M1 is status-only for deploys. Test placement follows the M1 test-rig adapter (§ Dispatch Boundaries).

Anything that sits, polls or waits (CI, a PR, a file appearing, a sleep-then-check) is the mechanical
tier, never the lead; a one-shot check stays a cheap verifier above. From a Claude seat, pass
`node scripts/model-roles.mjs claude.subagent.mechanical --field alias` as the Agent tool's `model`; for
a Codex watcher, use `node scripts/model-roles.mjs codex.subagent.mechanical --use watcher --field model`.
`claude.subagent.cheap` keeps brain-worker recall, orc-helper and verifiers, per its 2026-09-29 evidence.

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
| Lead in a T3 thread; child work (implement, review, recon) owned by that thread | T3 `delegate_task` (§ T3-native dispatch) |
| One coherent edit, or step B needs step A's output | None: run serially in one agent |

Fan out the read-heavy discovery; make the changes in one agent that holds the whole picture.
Visible cmux fleets: § Dispatch Boundaries › cmux adapter.

## T3-native dispatch

A lead in a T3 thread dispatches child work through the T3 MCP, not panes. The lifecycle, as rules: [references/t3-native.md](references/t3-native.md).

1. **Discover:** call `orchestrator_capabilities` first; pin provider, model and effort in `target` from its live catalog (canon #5).
   For ordinary Codex implementers, recon and reviewers, explicitly name `target.providerInstanceId: "codex-worker"` every time.
   `codex` stays for: security (implementers + scans), UI / computer-use recorders, browser / web-QA workers and Etan (Codex has no lead seats).
   A Codex child inherits its parent's Codex instance. A Claude lead naming only the codex driver gets whichever codex instance T3 lists first; always name the instance.
   Remember: the role picks the model, the work type picks the instance. Codex reviewers on security or full-panel PRs stay on `codex`; ordinary Codex reviewers use `codex-worker`.
   Otherwise each Codex worker thread starts codex-security, computer-history, node_repl and cua_repl (~24.5 MiB, 4 processes), which T3 keeps until settle/idle release.
   Recreate, upgrade verification and missing-instance fallback: [Codex instances](references/t3-native.md#codex-instances).
2. **Dispatch:** follow the [worktree launch guard](references/worktree-launch.md) for exact-base preflight and preparation checks; `delegate_task` with `mode: "async"`; keep the `taskId`; one stable `clientRequestId` per round. Edits get `isolation: "worktree"`, which starts from the parent's committed HEAD, so the brief names absolute paths.
3. **Wait:** completion wakes the parent. End the turn; never poll or spawn a watcher for it.
4. **Settle:** at the PR's terminal state (merged or handed off; never at the first DONE — a PR in review rounds keeps its implementer) (a child with no PR, such as a reviewer or recon: as soon as its report is verified), read the report, verify the artifact (PR URL and head, files) before relaying, then conclude the child, `task_cancel` its `taskId`, `unwatch_pull_request` its PR, then `t3_thread_organize {action: "settle", threadId: <childThreadId>}`. Never omit threadId: an omitted threadId settles the calling lead thread. See § Goal Contract for provider release timing and the worktree caveat.
5. **Review rounds:** every round is a new `delegate_task` carrying prior findings; never `t3_thread_send` to the `childThreadId`.
6. **Questions:** a child's pending question is answered by the lead, never forwarded to Etan as a routing question.
7. **Workers:** `delegate_task` children of their lead, `isolation:"worktree"` for code, never top-level threads. `t3_thread_launch`/`create_threads` are only for a separate conversation explicitly requested by Etan. Cross-project work goes through that repo’s lead: `delegate_task` runs only in the caller’s project. "I thought codex workers were just like implementer threads ... we usually just delegate workers and not put them in threads, right?" (Etan, 2026-10-28)
   Messages to a RUNNING thread use `t3_thread_send` mode `auto`, never `queue`. Never settle, re-snooze or unsnooze a thread Etan snoozed himself.
8. **PRs:** `link_pull_request` every PR; the parent owns `watch_pull_request`.
9. **Who and how many:** Routing rules (SSOT) picks the vendors; fresh implementer per PR and the Codex cap live in § Lead Topology #5.

## Dispatch Boundaries

- Cursor model selection lives in Routing rules (SSOT).
- Claude Workflow/Agent-tool fan-out is read-only recon, verification, or synthesis except audio-dashboard builds.
- T3 child work follows § T3-native dispatch.
- Standalone read-only lanes may use the fan-out/gather models permitted by the 2026-10-28 Routing rules (SSOT), or Cursor.
- Skills, hooks, agent definitions, and global agent settings are skillCreator-domain work. If skillCreator is not already in the loop, stop and request its audit before patching.

- Superseded placement: "**The M1 Pro becomes a TEST RIG only.** Development stays on the MBP. … Nothing changes on the M1 for this yet." (Etan 2026-10-18, via orc collab) The 2026-10-28 placement below now governs.
- M1 placement (Etan, 2026-10-28): "I want the m1 pro to be used for tests." Full suites, E2E and XCUITest default to M1 Pro: ≥10 GiB guard, max 3 heavy lanes, never during a sync window, PHX admission required. Quick focused unit tests stay local.
- Dispatching to the other Mac (linked T3 environment, remote code writes, project ids, admission ledger)? Read [references/cross-machine.md](references/cross-machine.md). It replaces the m1-router launch transport.

### cmux adapter

Applies to visible cmux fleets only; T3 children follow § T3-native dispatch.

| Task shape | Engine |
|---|---|
| Visible, multi-vendor, long-running, human-watchable workers | cmux fleet (`/cmux-agents`) |

- Visible-worker launch law lives in fleet canon #6; `/repogolem` owns invocation mechanics and [delegation operations](references/delegation-operations.md#launcher-boundary) owns the `--fast` prohibition.
- Codex workers edit only their delegated worktree; their Claude lead owns acceptance.
- Pane monitoring and reviewer handoff: `/collab-monitor`.

### M1 test-rig adapter

Active placement follows the 2026-10-28 M1 rule in § Dispatch Boundaries.

- Codex workers only, until a recorded Claude-in-T3 proof passes (real `brain_search`, one skill invoked, no hook errors). Full suites, E2E and XCUITest use M1 Pro by default under the guard, lane cap, sync-window exclusion and PHX admission above.
- Each dispatch requires a same-turn BrainBar probe: the socket accepts and `brain_search` answers. A failed probe is reported to the lead; the work stays on the MBP.
- Leads never move. Vendor routing, inner-loop order and PR-body records are unchanged.

## Lead Topology

Domain leads are orchestrators one tier below orc:

1. Leads delegate implementation according to Routing rules (SSOT); fleet canon #7 owns their worker-monitor guard.
2. Lead goals preserve orchestration duties: delegate, maintain health gates, synthesize, and verify.
3. A lead is a managed `agent_id` with `role:"orchestrator"` and left-column placement.
4. Tiny lead self-edits are capped at <=20 changed lines, one single-purpose change, and zero new files. They require an isolated worktree plus same-post collab disclosure of what changed, why urgent, and line count. Urgency alone never qualifies; everything else follows Routing rules (SSOT).
5. **One PR = one fresh implementer.** A new PR gets a new implementer (a new `delegate_task` or a new pane, fresh context), even when a healthy idle worker exists in the same repo/workspace/role. Only that PR's own fixes (its review rounds) may reuse it. Dependent stacks are no exception: each stack layer is its own PR, so it gets its own implementer, handed a compact checkpoint; the 2026-10-18 rules supersede R6's dependent-stack exception. Why: "it re-uses workers instead of settling and opening new ones, like that ship 2246 chat that had 25 prs, 24 merged" (Etan 2026-10-18, via orc collab).
   - **Lifetime cap:** "No Codex session lives past one PR, or ~100 turns. After that, start a fresh delegate with a short brief and a compact checkpoint. Never re-inject full plans or logs." (Etan 2026-10-18, via orc collab)
   - **Reviewers:** "reviewers fresh per implementer (same PR may reuse them)" (Etan 2026-10-18, via orc collab).
   - **Concurrency:** "at most 4 Codex workers running at once per lead" (Etan 2026-10-18, via orc collab). A fifth queues until one settles; the Claude dispatch cap in § Model pins and dispatch is separate.
   - **Settle, then open new:** keep the implementer through its own PR's review rounds, not past them. At the PR's terminal state (merged or handed off, artifacts harvested) settle it, never at its first DONE; the next PR opens a new one.
   - **cmux adapter:** canon #7's "minimize pane churn" is cmux fd-leak hygiene. It means no needless pane open/close, never keeping one worker across PRs.

6. A lead's model is written in its lane brief, signature line and claim post; a mid-sprint tier change names its reason (budget | quality | stall).
7. **Leads never do ops themselves:** "Leads never do ops themselves: deploy hops go to the `deploy-local-prod` sub-agent; mechanical checks and waits go to Haiku or gpt-6-luna." (Etan 2026-10-19, via orc) A deploy, install, restart or reconnect hop is a `deploy-local-prod` dispatch; a sit/poll/wait task is a `claude.subagent.mechanical` or `codex.subagent.mechanical --use watcher` dispatch (§ Cheap sub-agents). Resolve both through `scripts/model-roles.mjs`; never write the model names. The lead's part is routing the hop and verifying the artifact it reports; the lead never runs the hop, the probe or the wait in its own session.

## Goal Contract

Every complex or multi-hour dispatch uses one absolute file-backed goal containing the full user
mission, constraints, green/no-green criteria, report path, and exact DONE marker. Name the CLI,
execution profile and required tool access, matched to the task under § Execution capability. Supersede an
implementer's goal only within its own PR (its review rounds); a new PR gets a fresh implementer (§ Lead Topology #5). A lane may
close only as verified `DONE`, file-backed `BLOCKED`/`NOT_GREEN`, or `TRANSFERRED` with successor
evidence. A DONE marker is only a prompt to verify the contracted artifact.

**Stay on task:** a worker reads only its brief, the files it names, and repo instruction files. Never read other agents' reports, inboxes, briefs or collab threads not addressed to it unless the brief explicitly allows it.

**Capability mismatch:** if the worker's profile/tools cannot do the task, stop and report one line to its lead: `BLOCKED: <task> needs <capability>; profile <x> lacks it`. Never substitute other work or explore.

**Questions go to the lead:** "workers never ask Etan routing questions" (Etan 2026-10-18, via orc collab). A worker
unsure about routing, scope, model or reviewer asks its lead. T3: the child's pending question, which the lead reads with
`t3_pending_request_read` and answers with `t3_pending_request_respond` ([t3-native § 6](references/t3-native.md#6-pending-questions)).
cmux adapter: one addressed collab line to the lead. The lead answers from this skill and escalates only a decision Etan
alone can make, as an `@etan` ask in the collab. Etan alone decides only true one-way doors (deleting
data/creds/accounts, money, messaging people); a tag, release, install, deploy or upgrade ships without asking (Etan
2026-10-19, via orc; `/pr-loop` § Hard Gates).

**Settle at the terminal state:** "settle idle workers" (Etan 2026-10-18, via orc collab). When a lane closes (verified
`DONE`, filed `BLOCKED`/`NOT_GREEN`, or `TRANSFERRED`), the lead settles its worker. T3: conclude the task (no new
sends), `task_cancel` its `taskId` so queued runs stop, and `unwatch_pull_request` the lane's PR, then `t3_thread_organize {action: "settle", threadId: <childThreadId>}`. Never omit threadId: an omitted threadId settles the calling lead thread.
This releases its provider session (Claude: MCP children exit at once; shared Codex: the thread unloads and its MCPs close after Codex's unload delay); `task_cancel` alone does not detach.
Settle once nothing still needs the child's worktree (a pending reviewer or fix round): T3's hourly cleanup removes settled threads' worktree checkouts (it keeps the branch).
Source: T3 `storageCleanup.ts:85-90,1017-1029,1236-1261`. cmux adapter: harvest,
then close the pane through the cmuxlayer MCP (`close_surface`). Idle with no artifact pending = settle now, not later.
A PR still in its review rounds is not idle; its implementer stays for those fixes (§ Lead Topology #5). The implementer
removes its own worktree at DONE (`/pr-loop` § Cleanup Receipt): `git worktree remove` (no `--force`),
then `git worktree prune`. Before lane close or settle, the lead verifies removal proof: the path is absent
from `git worktree list --porcelain`. Dirty files or local-only commits stay; name the path and reason
in the receipt and escalate to the lead. No proof or escalated exception = invalid receipt.

If the user questions why work is happening or corrects the route, pause spawning and patching,
explain the evidence-backed state, and store the correction separately.

## Cross-Skill Ownership

- `/repogolem`: launcher flags, defaults, resume behavior, and raw escape hatches.
- `/pr-loop`: branch through draft PR to ready-for-review; Routing rules (SSOT) above owns the inner-loop pair, which runs on the draft.
- `/collab-monitor`: cmux/collab-mail only: pane worker monitoring and reviewer handoff mechanics. T3 children use completion notifications instead (§ T3-native dispatch).
- `/qa-video`: video QA/debrief pipeline; its runner reads the frames itself, and Gemini gathering is optional pre-sorting.
- `/whats-new`: tool-surface changes; they do not revise Routing rules (SSOT) by implication.

## Installed design skill constraints

These fleet constraints apply independently of the usage proposal below:

- `improve-animations` is audit mode only (`quick` or `standard`). Its `execute`
  mode is **never** used in the fleet: it self-dispatches and self-reviews.
  Write plans only under `docs.local/animation-plans/`, never a tracked `plans/`
  directory. Send the plans to the lead, who routes implementation and review.
  Any authorized read-only helpers are capped at two and follow normal model/tier
  rules (default service, no fast; Cursor stays Auto-only).
- `animate` must use the repo's existing dependencies. `pick-ui-library` is not
  installed: never fetch it or a replacement library to satisfy that reference.

## Design skills usage — FRONTEND RULE, 2026-10-28

Etan: "Split: Claude for visual slices" (2026-10-28, via orc/PHX).
Claude (`claude-opus-5-5`, `fastMode:false`), loaded with BOTH
`frontend-design:frontend-design` and `emil-design-eng`, implements taste-heavy
visual slices; Codex does the plumbing. This is the taste-critical exception to
the Claude budget hold; keep visual slices small. A fresh red-team Claude
(`claude.judgment`, never the implementer) with BOTH skills reviews every visual
PR and cites [pr-loop's required proof](../pr-loop/SKILL.md#visual-proof).
Codex computer-use recorders may produce the artifacts and functional checks.
Claude uses the official plugin; Codex/Cursor use vendored `frontend-design`.
Plugin namespacing denotes one route, not a duplicate.

Sequence (lead guidance): `frontend-design` sets the holistic direction before planning
and reviews the assembled full page at the end. `emil-design-eng` handles each
interactive component/section inside that direction: feedback, keyboard/focus,
loading/empty/error states, gestures, interruption and reduced motion. Holistic
layout/tokens win on visual cohesion; Emil governs local interaction craft.

- VoiceBar and app UIs: holistic → every page/section with Emil → holistic review
  of the complete navigation/settings flow. Adapt web recipes to native conventions.
- BrainLayer, cmuxlayer, VoiceLayer, Golems and etanheyman.com websites: holistic
  frontend-design pass → `/large-plan` → each interactive row's implementer gets
  both skills, the shared tokens and required states → holistic assembled-page pass.
- Use `animate` to implement justified motion, `review-animations` explicitly for
  a motion diff, `improve-animations` to audit/write plans, and
  `find-animation-opportunities` for restrained proposals. Do not load the full suite
  into every worker; no animation is a valid decision. Give Emil a concrete task
  because a bare invocation only greets. `animate` references the uninstalled
  `pick-ui-library`; use existing repo dependencies and never fetch it. The
  audit-only, docs.local output and never-execute constraints above always apply.

Claude keeps the official auto-updating
frontend-design plugin and the five vendored Emil skills. Codex uses all six
vendored skills plus the upstream drift/updater path. Cursor has the six skills
for routed read-only review only, never implementation. Gemini/agy receive none.
Additional Emil skills await Etan's decision.
