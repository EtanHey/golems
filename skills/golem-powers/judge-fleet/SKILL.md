---
name: judge-fleet
description: "Bulk LLM-judging protocol for fleet-dispatched verdict runs. Triggers: judge fleet, bulk judge, R3 verdicts, kg-judge, RT gate, evidence_degraded. NOT for single reviews, Phoenix UX, or non-judge evals."
---

# /judge-fleet — bulk LLM-judging protocol

Routing: use `/judge-fleet` for bulk verdict fan-out; use `/plan-council` for a visible 3-seat cross-family review of one authored plan/spec.

> Three R3 runs (morning + evening 2026-06-06) proved seven non-negotiables.
> A generic "judge these N items" dispatch loses artifacts, degrades silently,
> and bulk-applies refuted merges. This skill encodes what the rerun briefs
> already harden — so agents don't re-learn from /tmp wipes and DB locks.

## Scope

Fleet-dispatched verdict runs means the KG cluster and the eval harness.

## When to use

- Dispatching or executing **bulk LLM judges** (J1, J2, red-team gate, Phase-2 sweep)
- Planning **fan-out** over hundreds of prompt files → verdict JSON/JSONL
- **Bulk-apply** or triage after a judge fleet completes
- Dispatcher writing worker briefs for brainlayer eval_results/ campaigns

NOT for: one-off PR review, Phoenix annotation UX, or skills that don't produce verdict artifacts.

## The seven rules (in dispatch order)

### 1. Pre-dispatch precondition validation

**Before fan-out**, verify:

- BrainLayer DB is **not enrichment-locked** — probe `brain_search` (MCP or CLI) on one stem; timeout/lock → **HOLD**, do not dispatch judges concurrently with enrichment
- Staging directory exists on disk and is **writable** (repo path under `eval_results/`, not ephemeral)
- Prompt inventory count matches brief (e.g. 154 + 154 + 70 RT stems)

Evidence: enrichment-locked DB nullified 308-verdict runs twice (79% morning, 100% evening `evidence_degraded`).

### 2. Durable staging — NEVER `/tmp`

All verdicts, sidecars, RT results, and DONE sentinels live under a **durable repo path**:

```text
eval_results/<campaign>/prompts/
eval_results/<campaign>/verdicts/
eval_results/<campaign>/rt-mandatory/
eval_results/<campaign>/DONE/
```

Multi-hour judge runs **never** stage in `/tmp` — overnight wipes lost 9/21 deliverables.

### 3. Per-prompt reasoning — no compiled judgment scripts

Each prompt gets **individual LLM reasoning** with cited evidence.

**Forbidden:** batch Python with hardcoded `TECHNOLOGY_STEMS` / lookup-table classifiers, regex-rule refutation scripts masquerading as RT, or collapsing "brain_search retry-once per stem" into 2–6 representative searches per batch.

Scripts for **validation** (schema check, set-diff coverage) are fine; scripts that **produce verdicts** are not.

### 4. Completion via durable DONE sentinel **files**

Cross-worker completion gates use **sentinel files**, not terminal grep or chat markers:

```text
eval_results/<campaign>/DONE/J1.done
eval_results/<campaign>/DONE/J2.done
eval_results/<campaign>/DONE/RT_MANDATORY.done
```

`R3_J1_DONE` printed only in final chat was **never observable** to RT — file-count heuristics are a fallback, not the protocol.

### 5. Append-only per-worker collab sections

Workers report learnings via **append-only writes** — one section per worker/batch:

```markdown
### 2026-06-06T09:35Z J2 (prompts 155-308)
...
```

**Forbidden:** concurrent `StrReplace` on a shared anchor in one collab file (6 workers → repeated anchor-miss retries). Prefer per-worker section files or atomic append to distinct headings.

### 6. `evidence_degraded` honesty flag

When `brain_search` fails (DB lock, timeout), every affected verdict MUST:

- Set `evidence_degraded: true`
- Cite only packet + on-disk grep evidence (never fabricate memory hits)
- Post degradation **loudly** in collab summary

Bulk-apply MUST treat `evidence_degraded` verdicts as a **filter** — do not silently merge degraded evidence as if live memory confirmed it.

### 7. Mandatory red-team gate before bulk-apply

**Never bulk-apply** straight from judge verdicts.

Run RT on the riskiest subset first (degraded + medium-confidence + merge recommendations). Phase-2 continuous sweep across all verdicts. **Re-judge REFUTE entries** before any merge. Historical refute rates: ~49% of RT-mandatory stems, ~41% Phase-2.

## Dispatcher checklist (copy into briefs)

```text
PRE-FLIGHT: brain_search probe OK? staging dir exists? prompt count verified?
STAGING: eval_results/<campaign>/ — NEVER /tmp
WORKERS: per-prompt LLM reasoning; validation scripts OK, verdict scripts NOT OK
DONE: write eval_results/<campaign>/DONE/<worker>.done — do NOT rely on chat markers
COLLAB: append-only per-worker sections — no shared-anchor StrReplace
HONESTY: evidence_degraded when brain_search fails — flag in collab
MERGE: RT gate complete; REFUTE re-judged; filter degraded before bulk-apply
```

## Integration

| Skill | Relationship |
|---|---|
| `/never-fabricate` | Read verdict files before claiming counts; no synthesized completion times |
| `/cron-payload-discipline` | Monitor ticks waiting on judge fleet use live file counts + DONE sentinels, not hardcoded "154/154 done" |
| `/cmux-agents` | Dispatch briefs must inline absolute staging paths and precondition steps |
| `/pr-loop` | Skill changes ship through full PR loop with eval scorecard in body |
| `/skill-creator` | RED/GREEN evals required before merge |

## Anti-patterns

| Don't | Evidence |
|---|---|
| Dispatch judges while enrichment holds DB lock | 100% `evidence_degraded`, ~500 duplicate judgments |
| Stage verdicts in `/tmp` | 9/21 deliverables lost to wipe |
| `judge_j2.py` lookup-table batch classify | Invalid enum + misclassifications; caught only post-hoc |
| RT polls `sleep 120` waiting on J1 chat DONE | R3_J1_DONE never in terminal; fragile gating |
| StrReplace shared collab anchor with 6 workers | Anchor-miss retries; luck-dependent no-duplicates |
| Bulk-apply without RT | 34/70 refuted (49%); ~126/308 Phase-2 REFUTE |
