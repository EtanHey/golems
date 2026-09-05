# phoenix-human-view — eval notes

Category: **encoded-preference** (the contract encodes ~25 live Etan corrections from
the gen-10 Phoenix sprint; baseline models design good generic UX but miss the
operator-specific calls).

## Method

RED/GREEN A/B on the canonical scenario ("design a Phoenix human-grading view +
pre-merge plan"), scored against 12 checks = the 10 contract items + the
operator-sign-off gate + the annotation-PII rule.

## Historical result (2026-06-05)

The original run did not record the effective runtime model or effort for each
arm. Its numeric scores and delta are therefore withdrawn. The raw result is
retained as non-comparable history at
`evals/results/contract-ab-2026-06-05.json`.

The historical baseline misses concentrated on the encoded preferences: frozen
suite-versioned datasets (vs live queues), hide-but-copyable IDs, turn-type
honesty, operator sign-off as the merge gate, and the PII rule. This qualitative
observation cannot support a comparative verdict until the run is repeated with
provenance-complete arms.

## Candidate contract additions (from the RED run — good ideas, route to PHX-LEAD)

- Critic-disagreement-first queue ordering + a small random calibration slice
  (human-vs-critic kappa).
- 1-tap "agree with critic" throughput target.
- Interrupt-tolerant optimistic annotation writes (grade persists immediately;
  resume at first ungraded).
