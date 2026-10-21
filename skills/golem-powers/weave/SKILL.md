---
name: weave
description: "Orchestrator convergence: mine JSONLs, cite findings, route actions. Triggers: weave, run weave."
---

# `/weave`

> **Version: v1.3**

> **At convergence, fan out deep cross-session mining, then prove each finding
> turned into a real change — or kill it.**

`/weave` is an orchestrator-only convergence skill. Workers do not self-invoke
it. It mines across recent Claude and Codex sessions, verifies the findings, and
routes every finding through an action ledger. The ledger's strict
conversion-to-change metric is the anti-waste spine: fan-out without disposition
and verified change is not convergence.

## Non-negotiable law

- A weave run uses the formal skill through `skillcreator`; no ad-hoc "lite weave."
- The harness, high-importance routed conclusions, conversion metrics, registry
  transitions, and retro are committed artifacts. Scratch digests and findings
  may be regenerated; conclusions may not live only in `docs.local/`.
- Gather runs off-Claude; Claude performs judgment. `/agent-routing`
  `references/model-and-effort.md` § Decide From the Mission owns model/effort choice; quota-probe before launch,
  preserve worker lineage, and announce headless fan-out.
- New/manual dispatches give each miner K sessions with a STATIC-first prompt (centerpieces
  keep a dedicated miner; [cache shape](references/topology.md#fan-out-prompt-shape-cache-economics)),
  centerpieces first, in bounded waves. The existing cursor runner remains single-session
  and item-first; runtime migration is a follow-up (see run-lifecycle § Dispatch). Expand one
  flat frontier per depth; never nest `parallel()` calls.
- Loop until both gap and verification queues are dry. Caps are runaway
  backstops, never silent terminators. A zero-agent batch is a coverage defect.
- Disk artifacts outrank agent receipts. Missing miner outputs are re-mined.
- Every finding needs cited evidence and a disposition. "Never landed" claims
  require live `gh`/git verification.
- After synthesis, run the mandatory Red/Blue/Red fact-check until dry, apply
  corrections everywhere, discharge every skill edit, update the rule registry,
  and let the final boss—not the workflow—decide whether the loop may finish.
- Re-score the prior run against what actually landed. Re-poll terminal state at
  write time; stamps come from `date`; every write gets same-turn read-back.
- The successor reads the entire weave, corrections, discharge table, and every
  BROKEN-OPEN registry row, then ACKs them item by item.
- Keep this frontmatter `description` at 1024 characters or fewer; an over-long description silently
  skip-loads the skill (weave's own 1272-char description tripped this). [g1:86 → 2026-05-31.md:69]

## Trigger and decision table

| Situation | Action |
|---|---|
| **"weave"** | Arm the skill, run `scripts/convergence-gate.sh` with the fleet's mode, and wait. Never auto-fire. In a T3 fleet that means the §1.1 capture, then `--fleet t3 --t3-state <file> --t3-projects "<ids>"`. Inside T3 with `cmux` on PATH, `auto` checks both fleets. |
| **"weave now"** | Fire immediately, skipping the gate. Operator override — use only when the operator knows the fleet is quiet. |
| Gate path | Require 0 open fleet PRs, idle and settled workers, no in-flight Codex, RAM headroom, and explicit demo approval. Prefer orc's SENTINEL over raw PR count when present. |
| T3 fleet (leads/workers are T3 threads or `delegate_task` children) | Capture the `weave-t3-fleet/v1` snapshot (`references/run-lifecycle.md` §1.1): `t3_thread_list` for every fleet project, `task_status` per task, `t3_thread_read` per child the listing misses, `t3_pending_request_list` for your own thread. Then run the gate with `--fleet t3 --t3-state <file> --t3-projects "<ids>"`. It passes only when convergence is proven: any working, waiting or unknown state, missing field, duplicate row, unswept project or missing child blocks. A `result_available` task whose worker thread is unsettled blocks too: settle it first. |
| cmux fleet | Run the gate with `--fleet cmux`; it reads `cmux list-status` pane idleness. |
| Gate cannot detect a fleet | BLOCKED. Pass `--fleet` and its input; never treat "nothing to check" as converged. |
| Small corpus (about 10 sessions or fewer) | Flat fan-out may be appropriate; still verify on disk and loop until dry. |
| Large or centerpiece-heavy corpus | Use staged mining, with centerpiece digests first and later rounds seeded by earlier findings. |
| Finding is a failure | Add evidence-cited `cause_layer` and route the fix to code, instructions, or tool description. |
| Skill edit/new candidate | End APPLIED, DISPATCHED with acknowledged owner, or TRACKED with evidence; no fourth state. |
| Live sessions grow during the run | Run the delta wave and re-aggregate before close. |
| Roadmap-only model-change tracking | Do not block the run or claim it is implemented. |

## Phase gates

1. Enter through the fleet-canon-#7 claim/guard contract; `/collab-monitor` owns the concrete watcher.
2. Converge, discover, prepare, batch, mine, and verify files on disk.
3. Aggregate the ledger; report both strict and refined conversion metrics.
4. Re-score the prior run, red-team every load-bearing claim, and propagate corrections.
5. Discharge every edit, emit verified intent briefs and grill carryover, then run the delta wave.
6. Update the committed retro and rule registry, perform full relay, and exit only through the final boss.

## Read the relevant reference

- Running the gate (T3 snapshot schema: §1.1; cmux fleet: §1.2), discovery, mining,
  dispatch, delta wave, or miner contract? Read [references/run-lifecycle.md](references/run-lifecycle.md).
- Aggregating, re-scoring, red-teaming, correcting, discharging edits, or computing
  correction rates? Read [references/verification-and-discharge.md](references/verification-and-discharge.md).
- Emitting track intents, self-QA gates, grill carryover, name claims, or monitors?
  Read [references/outputs-and-coordination.md](references/outputs-and-coordination.md).
- Writing retros, model-change roadmap notes, registry transitions, or checking
  the artifact inventory? Read [references/continuity-and-registry.md](references/continuity-and-registry.md).
- Choosing flat versus staged topology, batch width, or centerpiece ordering?
  Read [references/topology.md](references/topology.md).

## Cross-skill routing

- `/skill-creator` owns the session-mining engine and skill evaluation.
- `/agent-routing` § Review routing owns review topology; never start a reviewer yourself.
- `/large-plan` receives mined track intents; domain leads author the plans.
- `/never-fabricate` owns evidence and verification discipline.
- `/pr-loop` owns PR conversion and review handling.
- `/orc` owns convergence detection and miner dispatch.
- Fleet canon #7 owns lead/orchestrator monitor law; `/collab-monitor` owns the concrete watcher.
