---
name: false-green-gate
description: "'done/green/fixed' needs a live probe. Triggers: completion claim, pr-loop completion, deploy/render/dashboard 'done'."
disable-model-invocation: true
---

# Skill: False-Green Kill-Gate (gen-18 Track 2 — the gen-17 north star)

> Fleet law: canon #4 owns "done = user-visible". This skill is the mechanical same-turn live-outcome probe gate.

## Scope

The probe must be a same-turn live-outcome probe.

## What It Is

A deterministic detector over an agent transcript: a completion claim is **FALSE-GREEN** unless the same
turn carries the live-outcome probe its claim domain requires. This is the MECHANICAL gate that
`/deploy-verify` and `/never-fabricate` describe in prose — "manual gates drift, automated gates don't."
The pinned RED/GREEN transcript fixtures ARE the replayable gate (R-003/R-014 pattern, consumed in the
T6 deterministic-CU smoke-spec shape).

## The Rule — required same-turn probe by claim domain

| Claim domain | Required live probe (same turn) | Violation if missing |
|---|---|---|
| render / audio / mp3 | `ffprobe` proving **size>0 AND duration>0** on the claimed path | `FALSE_GREEN_FFPROBE` |
| …cloned / 2-voice render | `--reference` resolves to a registered clone (theo-c4/ben-c1), no system-TTS fallback | `FALSE_GREEN_VOICE` |
| dashboard / UI / site | **HTTP 200** on the served URL | `FALSE_GREEN_DASHBOARD_200` |
| | **AND** a signed-in **click-through** (200 alone is not enough) | `FALSE_GREEN_CLICK_THROUGH` |
| deploy / merged / installed | build-stamp that **POST-DATES the merge** | `FALSE_GREEN_STAMP` |
| | **AND** a live round-trip (pgrep/launchctl/health 200) | `FALSE_GREEN_LIVE_PROBE` |
| build / contract | the **operational entrypoint exercised** (wrapper dry-run / contract test) | `FALSE_GREEN_LIVE_PROBE` |
| generic "done" | at least one live round-trip | `FALSE_GREEN_LIVE_PROBE` |
| "rigorously verified manually" + no probe | — (ranked last, false-green-permitting) | `MANUAL_SUBSTITUTE` |

"Same turn" = the events since the last human message — the probe tool calls **and their results** the
agent ran before the claim. Negated/in-progress statements ("not done yet") are not claims.

## How /pr-loop Consumes It

`/pr-loop` already states the **Deploy Truth Gate** (merged ≠ serving) and **Post-Merge Verification** in
prose. This gate makes it mechanical: before a worker/lead emits `TASK_DONE` or a "done/deployed/green/
render-complete" message, run the gate on the turn — `/false-green-gate`
(`bun skills/golem-powers/false-green-gate/scripts/false-green-gate-cli.mjs <transcript|->`, exit 3 = FLAG).
A FLAG means the claim is not yet earned: run the missing probe, then claim. Compose with `/deploy-verify`
(the four-step deploy sequence) and `/never-fabricate` (read the output before reporting).

## Run It

```bash
bun test skills/golem-powers/false-green-gate/evals/false-green-gate.test.mjs   # replay (CI-safe)
python3 skills/golem-powers/false-green-gate/evals/run_suite.py                 # hook stdout-schema suite
bun skills/golem-powers/false-green-gate/scripts/false-green-gate-cli.mjs <transcript.jsonl|->
```

Programmatic: `import { detectFalseGreen } from "./src/false-green-gate.mjs"` → `{ verdict, claim, domains, violations }`.

## Stated Limits (honesty rule)

- Evidence is marker-anchored over the same-turn blob; a probe described but not actually run can read as
  present. The fixtures pin the known specimens; new evasion shapes are added as RED fixtures (R-003 model).
- "Same turn" is bounded by the last human message; a probe run two turns earlier does not count (by design
  — the false-green class is precisely a stale or absent same-turn probe).
- TODO(P2): Evidence-in-dashboard decision-answering claims belong in qa-verdict/render-done gates, not this generic false-green gate.

## Provenance

RED specimens: brainlayer/915ace6b#5 (stale BrainBar stamp), narrationlayer/e3a91210#1 ('give it a play',
no mp3), codex/019edebd#3 (REAPER build-green contract-broken), R-004 dashboard family, R-035 manual-
substitute. GREEN references: narrationlayer/019ee201#4 (ffprobe pass), voicelayer/019ed6c2#5 (daemon
round-trip), dashboard 200+click-through, clone-voice-resolved, contract-exercised, no-claim (N/A).
