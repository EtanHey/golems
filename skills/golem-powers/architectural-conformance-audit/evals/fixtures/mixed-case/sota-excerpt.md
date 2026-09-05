# SOTA Research Output — mixed-case fixture

> Minimal fixture for eval scenario 5. Multiple architectural primitives; 9 expected MATCH, 1 expected UNJUSTIFIED DIVERGE. Audit MUST list all and BLOCK R0 on the single divergence regardless of the 9 matches.

## Architectural recommendations (multi-primitive)

[01] Read-path framing: **socket-direct IPC**.
[02] Write-path framing: **socket-direct IPC**.
[03] Persistence: **SQLite WAL mode**.
[04] Indexing: **HNSW with int8 quantization**.
[05] Embedding model: **bge-small-en-v1.5 (or equivalent)**.
[06] Process supervision: **launchd on macOS**.
[07] Client library: **stdlib socket + struct framing**.
[08] Logging: **structured JSON to stderr**.
[09] Configuration: **TOML at $XDG_CONFIG_HOME/brainlayer/config.toml**.
[10] Concurrency model: **single-process + asyncio for IO; CPU-bound work to a worker pool**.

## Counter-example flagged

[12] **Avoid raw HTTP for the read path daemon surface.** Letta-on-FastAPI is the canonical counter-example (same as the AP1 case).
