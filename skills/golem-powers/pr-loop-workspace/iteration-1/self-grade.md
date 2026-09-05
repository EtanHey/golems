# PR-Loop Eval Self-Grade — Historical Iteration

## Publication status

HISTORICAL NON-COMPARABLE. The original self-graded scores and differentials are
withdrawn because the effective runtime model and effort were not observed.
Original values remain available in git history.

## Qualitative findings

The daemon case found that the skill recognized socket/MCP changes, required a
real-client test, rejected a short-lived socket probe as sufficient evidence,
and delayed PR creation until verification. The ordinary frontend case found
that the daemon gate stayed out of the way while the standard review loop still
applied.

The audit also identified weak discrimination in the daemon-gate negative case,
relative fixture paths, and a missing intermediate socket-change scenario.
A publishable performance claim requires an independent, provenance-complete rerun.
