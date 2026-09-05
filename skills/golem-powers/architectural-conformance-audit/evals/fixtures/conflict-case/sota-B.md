# SOTA Research Output B — conflict-case fixture (favors FastAPI)

> Minimal fixture for eval scenario 4. Conflicts with sota-A.md. Newer by 2 days. Audit MUST NOT auto-pick this just because it's newer (date-based tiebreak is the AP1 root cause).

## Architectural recommendation

[8] **Use FastAPI HTTP.** Operational simplicity of HTTP middleware outweighs the latency cost for the workload described, especially given existing platform tooling for HTTP-based observability.

[10] FastAPI patterns are well-documented and Letta-on-FastAPI demonstrates the pattern's viability at production scale.

## Authorship metadata

- File timestamp: 2026-05-26
- Author: researcherCodex (R2 dispatch, sprint brainlayer-readpath-B)
- Discrepancy note: this file directly contradicts sota-A.md re: Letta-on-FastAPI characterization. Reconciliation required.
