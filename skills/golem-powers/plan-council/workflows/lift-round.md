# Lift Round

Run this after the initial ballots are lint-clean and the conservative merge is calculated.

## Prompt

```text
For EVERY lane you scored below 8, return one row with:
1. the current score;
2. THE ONE artifact or action that would lift it above 8; and
3. whether external research would genuinely change the answer.

One artifact each, and it must be the thing whose absence is why the score is low — not a wish list.
For research, answer NO or give one narrow, explicit research question. Local inspection, a live
receipt, a rehearsal, or an executing-artifact probe is not external research.

Your FIRST output line must be the lift-table header; write no prose before it. Preserve your
R<n>/family signature and end with <LIFT_SENTINEL>.
```

## Merge the lift table

1. Keep one row per judge per sub-8 lane; do not synthesize a consensus artifact before exposing
   disagreement.
2. Route the conservative non-family artifact to the lane owner when proposals conflict.
3. Record research as `NO`, `YES — <narrow question>`, or `NEAR-MISS — <why not now>`.
4. Convert author-addressed conditions directly into owned work. Do not add a ratification wait.
5. Preserve independent HARD STOPs for irreversible state: receipts first, rewrite against those
   receipts, then re-review the rewrite.
