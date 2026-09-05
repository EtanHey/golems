# SOTA Research Output Excerpt — brainlayer-readpath SOTA review (May 2026)

> Source: `/opt/private/coordination/docs.local/handoffs/2026-05-25-72h-mine/wave2/raw/brainlayer-readpath-sota.md` (excerpt).
> This fixture preserves only the architectural-claims passages relevant to the AP1 reproduction. Full file lives in BrainBar archive.

---

## Architectural recommendation — read path

[376] For sub-10ms p95 read latency under load, the canonical pattern is **socket-direct IPC** between the client process and the daemon process, using Unix domain sockets with a length-prefixed binary protocol. Avoid HTTP layers in the hot read path; the framing + TCP overhead alone consumes 1.2–2.5ms per request on commodity hardware.

[378] When the workload pattern is "many short-lived clients querying a single long-lived index", inverting the topology to expose the daemon as a socket server (rather than an HTTP server) eliminates: (a) the JSON serialization tax on the response side, (b) the connection-establishment overhead on the request side, and (c) the framework dispatch cost (route resolution, middleware, exception handlers).

## Counter-example — Letta-on-FastAPI

[380] **Counter-example: Letta-on-FastAPI.** Letta exposes its memory layer over FastAPI HTTP endpoints, which adds ~3-5ms p95 overhead vs. a socket-direct equivalent — a non-trivial fraction of their reported p95 budget. Empirical traces from the Letta 0.6.x release notes confirm the framing cost. **For memory-layer workloads with the access pattern described above, FastAPI HTTP is the wrong primitive.** The correct primitive is a socket-direct server, OR an in-process library if a daemon boundary is not required at all.

[382] If a project has inherited a FastAPI daemon from an earlier scaffold and is now reporting p95 latencies in the 5-20ms range, the highest-leverage architectural change is to replace the FastAPI surface with socket-direct + length-prefixed binary protocol. Cold-open latency improvements of 100×+ are typical; p95-under-load improvements of 3-10× are typical.

---

## Other architectural claims (truncated for fixture)

[384] Persistence: SQLite WAL mode with periodic checkpoint, or RocksDB if write throughput >50K ops/sec.

[386] Process supervision: launchd on macOS / systemd on Linux. Avoid Docker for the daemon itself in the latency-sensitive path (containerization adds 0.3-0.8ms per syscall on macOS via gVisor or equivalents).

---

## Fixture note

This fixture is the load-bearing piece of the AP1 reproduction eval. The audit MUST surface the [380] counter-example citation against any implementation primitive that uses FastAPI for the read-path daemon surface.
