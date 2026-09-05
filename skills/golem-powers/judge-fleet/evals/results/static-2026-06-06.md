# judge-fleet Historical Eval — 2026-06-06

provenance: alias-only

## Publication status

HISTORICAL NON-COMPARABLE. Numeric assertion scores, category grades, delta,
and graded verdict are withdrawn because the effective runtime model and effort
were not observed. Original values remain available in git history.

## Qualitative findings

- The generic baseline omitted durable staging, completion sentinels, the script
  ban, append-only collab handling, and the final review gate.
- It sometimes mentioned degraded evidence or file-count heuristics without the
  complete safety protocol.
- The with-skill arm covered staging, dispatch, completion signaling, collab
  append behavior, and degraded-evidence filtering.

The original audit used static binary scoring. A publishable performance claim
requires a provenance-complete live rerun.
