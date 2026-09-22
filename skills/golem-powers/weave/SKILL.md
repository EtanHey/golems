---
name: weave
description: "Orchestrator convergence: mine JSONLs, cite findings, route actions. Triggers: weave, run weave."
---

# `/weave`

> **Version: v1.2**

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
- Gather runs off-Claude; Claude performs judgment. Pin model and effort per
  node, quota-probe before launch, preserve worker lineage, and announce headless
  fan-out.
- Mine one session per miner, centerpieces first, in bounded waves. Expand one
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
| **"weave"** | Arm the skill, run `scripts/convergence-gate.sh`, and wait. Never auto-fire. |
| **"weave now"** | Fire immediately, skipping the gate. Operator override — use only when the operator knows the fleet is quiet. |
| Gate path | Require 0 open fleet PRs, idle workers, no in-flight Codex, RAM headroom, and explicit demo approval. Prefer orc's SENTINEL over raw PR count when present. |
| Small corpus (about 10 sessions or fewer) | Flat fan-out may be appropriate; still verify on disk and loop until dry. |
| Large or centerpiece-heavy corpus | Use staged mining, with centerpiece digests first and later rounds seeded by earlier findings. |
| Finding is a failure | Add evidence-cited `cause_layer` and route the fix to code, instructions, or tool description. |
| Skill edit/new candidate | End APPLIED, DISPATCHED with acknowledged owner, or TRACKED with evidence; no fourth state. |
| Live sessions grow during the run | Run the delta wave and re-aggregate before close. |
| Roadmap-only model-change tracking | Do not block the run or claim it is implemented. |

## Phase gates

1. Arm the inbound collab monitor and claim a stable name.
2. Converge, discover, prepare, batch, mine, and verify files on disk.
3. Aggregate the ledger; report both strict and refined conversion metrics.
4. Re-score the prior run, red-team every load-bearing claim, and propagate corrections.
5. Discharge every edit, emit verified intent briefs and grill carryover, then run the delta wave.
6. Update the committed retro and rule registry, perform full relay, and exit only through the final boss.

## Read the relevant reference

- Running the gate, discovery, mining, dispatch, delta wave, or miner contract?
  Read [references/run-lifecycle.md](references/run-lifecycle.md).
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
- `/cmux-agents` owns the canonical lead/orchestrator monitor law.
