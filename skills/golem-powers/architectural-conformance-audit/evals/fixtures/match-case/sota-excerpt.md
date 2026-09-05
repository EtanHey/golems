# SOTA Research Output Excerpt — match-case fixture

> Minimal fixture for eval scenario 2. SOTA recommends socket-direct; implementation uses socket-direct → MATCH.

## Architectural recommendation — read path

[42] For sub-10ms p95 read latency, use **socket-direct IPC** between client and daemon, length-prefixed binary protocol over Unix domain sockets. This is the canonical pattern for the workload class described.

[44] Avoid HTTP layers in the hot read path.
