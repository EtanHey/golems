# SOTA Research Output A — conflict-case fixture (favors socket-direct)

> Minimal fixture for eval scenario 4. Two SOTA files exist for the same sprint topic. They disagree. Audit MUST list both and hold the gate pending Etan's pick — NOT auto-canonicalize by date.

## Architectural recommendation

[15] **Use socket-direct IPC.** HTTP layers in the read path add 1.2–2.5ms per request overhead. Counter-example: Letta-on-FastAPI exhibits this exact overhead in production traces.

## Authorship metadata

- File timestamp: 2026-05-24
- Author: researcherClaude (R2 dispatch, sprint brainlayer-readpath-A)
