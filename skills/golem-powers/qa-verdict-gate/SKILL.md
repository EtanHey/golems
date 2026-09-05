---
name: qa-verdict-gate
description: "Kill-gate: QA PASS/FAIL/INCONCLUSIVE + qa-report.md. Triggers: QA verdict, QA done/complete, pre-merge QA, false-FAIL."
disable-model-invocation: true
---

# Skill: QA Verdict-Integrity Kill-Gate (gen-18 Track 2 #6)

> Fleet law: canon #4 owns user-visible completion; canon #3 owns evidence. This skill enforces QA verdict integrity, report artifacts, and rendered-state evidence.

## Scope

FAIL is only for confirmed-observed failures; INCONCLUSIVE is for when the path couldn't be reached. A qa-report.md artifact must exist.

## What It Is

A deterministic detector over a QA transcript/verdict: a QA result is a **verdict-integrity violation**
unless the agent's stated verdict matches the OBSERVED evidence in the same turn AND a terminal
`qa-report.md` artifact exists. This is the MECHANICAL gate that `/qa-video` and `/never-fabricate`
describe in prose. The pinned RED/GREEN transcript fixtures ARE the replayable gate (R-003/R-014 pattern,
T6 deterministic smoke-spec shape). Sibling of `/false-green-gate` — same `lib/transcript.mjs`, same
`buildEvidence` discipline (evidence comes from tool calls + tool_result OUTPUTS, never assistant prose).

## The Rule — tri-state, evidence-anchored

| Detector code | Fires when | The honest verdict instead |
|---|---|---|
| `QA_FAIL_WITHOUT_OBSERVATION` | a **FAIL** with no same-turn observed-failure evidence (no screenshot, no click that reached the surface, no observed error in a `tool_result`) — the failing path was never shown to be exercised | `INCONCLUSIVE` |
| `QA_UNREACHED_NOT_INCONCLUSIVE` | the transcript shows the path **couldn't be reached** ("couldn't load", "element not found", "blocked at step 0", `net::ERR_*`), but the verdict is **FAIL or PASS** | `INCONCLUSIVE` |
| `QA_NO_REPORT_ARTIFACT` | a QA **"done/complete"** claim with no `qa-report.md` written this turn carrying the checklist items (≥2) | write the report first |
| `QA_DECISION_CLAIM_NO_VISUAL_EVIDENCE` | a terminal QA/completion answer that feeds an Etan merge/ship/QA decision has no screenshot/dashboard/rendered-state reference embedded in that same answer | embed the visual evidence reference where Etan answers |
| `QA_USER_VISIBLE_WITHOUT_RENDERED_EVIDENCE` | a **PASS/ready/done** verdict about a user-facing surface is backed only by merge/plumbing state, with no same-turn screenshot/click/rendered page/HTTP 2xx probe | probe the rendered user-visible surface first |

PASS = the stated verdict matches the observed evidence **and** the `qa-report.md` artifact exists.
"Same turn" = the events since the last human message — the probe tool calls **and their results** the
agent ran before its verdict. Negated/in-progress statements ("not done yet") are not verdicts. An explicit
`Verdict: INCONCLUSIVE` line is authoritative over loose pass/fail words elsewhere in the prose.

## Why FAIL is reserved

A false-FAIL (codex `019ee5ea#1`) and a truncated QA with no artifact (`019ee493#2`/`#4`) are the two
specimens this closes. A FAIL emitted when the regression path was never reached is *worse than no QA* —
it sends a worker chasing a phantom bug. FAIL must come from a confirmed observation; everything the run
could not actually exercise is `INCONCLUSIVE`, surfaced honestly.

## How /pr-loop + /qa-video Consume It

Before a QA seat emits a verdict or a "QA complete" message, run the gate on the turn — `/qa-verdict-gate`
(`bun skills/golem-powers/qa-verdict-gate/scripts/qa-verdict-gate-cli.mjs <transcript|->`, exit 3 = FLAG).
A FLAG means the verdict is not yet earned: reach the surface and observe, or downgrade FAIL→INCONCLUSIVE,
write the missing `qa-report.md`, embed the visual reference in decision-feeding answers, or probe the
rendered user-visible surface. Compose with `/false-green-gate` (live-outcome probe for completion claims)
and `/never-fabricate` (read the output before reporting).

## Run It

```bash
bun test skills/golem-powers/qa-verdict-gate/evals/qa-verdict-gate.test.mjs   # replay (CI-safe)
python3 skills/golem-powers/qa-verdict-gate/evals/run_suite.py                # hook schema + fail-open
bun skills/golem-powers/qa-verdict-gate/scripts/qa-verdict-gate-cli.mjs <transcript.jsonl|->
```

Programmatic: `import { detectQaVerdict } from "./src/qa-verdict-gate.mjs"` → `{ verdict, claim, qaVerdict, violations }`.

## Stated Limits (honesty rule)

- Evidence is marker-anchored over the same-turn blob; a probe described but not actually run can read as
  present. The fixtures pin the known specimens; new evasion shapes are added as RED fixtures (R-003 model).
- "Same turn" is bounded by the last human message; a probe run two turns earlier does not count (by design).
- Observed-error / screenshot tokens in a `tool_result` only count when a Bash command or a browser tool
  actually drove a surface this turn — a passive `Read` of an old log cannot supply them (same-turn-scope).
- Decision-feeding evidence is checked on the terminal answer text: a screenshot mentioned only earlier in
  the turn does not help Etan answer the decision prompt.

## Provenance

RED specimens: codex/`019ee5ea#1` (false-FAIL, path unreachable), codex/`019ee493#2`/`#4` (truncated QA,
no artifact), a FAIL with zero observed-failure evidence. Evasion REDs: prose-bypass (narrative "observed
error"), passive-read-supplies-error (same-turn-scope), false-PASS over an unreachable surface,
report-stub (artifact with no checklist), prose-unreached-still-FAIL (negation), namespaced-MCP-Write
(tool-name normalization), navigate-only-clears-FAIL (cursor-bugbot L195 — bare `browser_navigate` does
not exercise the failing flow), decision-feeding bare verdict with no visual evidence reference,
user-facing dashboard ready claim backed only by merge state. GREEN references: FAIL with an observed-error
screenshot + report, INCONCLUSIVE correctly used when unreachable, PASS with a full report, in-progress
(N/A), verdict-pending (cursor-bugbot L260 — "step 1 done, verdict still pending" is not a settled verdict),
decision-feeding claim with the screenshot/dashboard reference embedded in the same terminal answer.
