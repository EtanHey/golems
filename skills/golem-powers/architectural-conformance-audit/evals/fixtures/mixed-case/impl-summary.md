# Implementation summary — mixed-case fixture

> Maps to sota-excerpt.md [01]–[10] + counter-example [12]. 9 MATCHes + 1 UNJUSTIFIED DIVERGE. Audit MUST surface the single divergence and BLOCK R0 regardless of the 9 matches.

| # | Primitive (per SOTA) | Implementation choice | Expected verdict |
|---|----------------------|-----------------------|------------------|
| 1 | Read-path framing — socket-direct | socket-direct (Unix domain socket + length-prefix) | **MATCH** |
| 2 | Write-path framing — socket-direct | socket-direct (same transport) | **MATCH** |
| 3 | Persistence — SQLite WAL | SQLite WAL (sqlite3 stdlib, PRAGMA journal_mode=WAL) | **MATCH** |
| 4 | Indexing — HNSW int8 | HNSW int8 (faiss IndexHNSWFlat with int8 quantization) | **MATCH** |
| 5 | Embedding model — bge-small-en-v1.5 | bge-small-en-v1.5 (loaded via sentence-transformers) | **MATCH** |
| 6 | Process supervision — launchd | launchd LaunchAgent plist at ~/Library/LaunchAgents/ | **MATCH** |
| 7 | Client library — stdlib socket+struct | stdlib socket + struct framing | **MATCH** |
| 8 | Logging — structured JSON to stderr | structured JSON to stderr | **MATCH** |
| 9 | Configuration — TOML at $XDG_CONFIG_HOME | TOML at $XDG_CONFIG_HOME/brainlayer/config.toml | **MATCH** |
| 10 | Concurrency — asyncio + worker pool for CPU | **FastAPI threadpool for ALL requests** (no asyncio; no CPU-bound pool separation) | **DIVERGE — UNJUSTIFIED** (uses FastAPI threadpool which subsumes [12] HTTP counter-example) |

## Gate decision

R0 BLOCKED on row #10 — concurrency model uses FastAPI threadpool, which also pulls in the HTTP counter-example from [12]. 9 MATCHes do NOT override this single UNJUSTIFIED divergence.
