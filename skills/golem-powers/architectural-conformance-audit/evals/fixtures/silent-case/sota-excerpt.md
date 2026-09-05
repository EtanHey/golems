# SOTA Research Output Excerpt — silent-case fixture

> Minimal fixture for eval scenario 3. SOTA discusses ONLY the read-path framing primitive (socket-direct). It says NOTHING about persistence backend. Implementation uses SQLite. Audit must produce N/A for the SQLite primitive — NOT a divergence.

## Architectural recommendation — read path framing only

[12] Use socket-direct IPC with length-prefixed binary protocol for the read path.

[14] Framing adds <50µs overhead on modern hardware.

## (Truncated — this fixture deliberately omits any persistence guidance.)
