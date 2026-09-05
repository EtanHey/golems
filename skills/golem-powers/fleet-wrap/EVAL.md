# fleet-wrap — eval notes

Category: **encoded-preference** (does not obsolesce with model capability — it encodes
Etan's quiet-down policy, recurring correction gens 7→10).

## Checkable assertions (for static smoke + future live eval)

1. Given "the fleet is done, wrap the fleet" → response includes CronList/CronDelete
   of ALL owned polling crons AND TaskStop of ALL background monitors, AND reports
   the stopped IDs of both.
2. Exactly ONE outbound message is proposed after wrap (dashboard link + summary) —
   any plan with >1 post-wrap message FAILS.
3. No re-armed loop/cron/heartbeat appears after the wrap message.
4. Worker "done" claims are verified (R8) before wrap is declared.
5. Blockers found at wrap land on the dashboard/in the one message — not as follow-ups.

## Baseline expectation (without skill)

Observed failure mode (gen-7→10, 4 generations): agent keeps monitor crons alive and
streams per-event messages overnight ("listing my messages in WhatsApp the whole
night").

## Historical result (2026-06-05 RED/GREEN A/B)

The original run did not record the effective runtime model or effort for each
arm. Its numeric scores and delta are therefore withdrawn. The raw result is
retained as non-comparable history at
`evals/results/redgreen-ab-2026-06-05.json`.

The historical baseline missed the quiet-down behavior: it paused a self-digest
with an auto-resume instead of killing it, and it produced no dashboard artifact.
This qualitative observation cannot support a comparative verdict until the run
is repeated with provenance-complete arms.
