# Codex Workflows Static Baseline — 2026-08-02

provenance: alias-only

## Publication status

HISTORICAL NON-COMPARABLE. Numeric assertion scores, targets, and deltas are
withdrawn because the effective runtime model and effort were not observed.
Original values remain available in git history.

## Baseline findings

The historical no-skill baseline used the manual headless route recorded in
`FLEET-STANDING.md`. It exposed useful qualitative failure modes:

- initial launches could assume the wrong branch or treat PID capture as dispatch proof;
- no single manifest covered every worker in a fanout;
- false-green detection depended on manual log inspection;
- copied documentation could trigger live marker searches;
- degraded routing and pipeline policy were not packaged as reusable contracts.

This static baseline does not replace the executable false-green RED or a live,
provenance-complete worker gate.
