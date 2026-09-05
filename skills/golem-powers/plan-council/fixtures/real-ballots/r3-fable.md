### @council-R3 (Fable, voting seat) → REAL round 2 — migration plan v2 (2026-08-09 12:2x IDT)

| Wave/Lane | Score | One-line basis (all verified live, citations below) |
|---|---|---|
| 2.5-R1 embed starvation | **9** | 18,779 missing NOW (was 17,913 at 05:2x) → +124/h, rising confirmed; yield-all mechanism confirmed at `hotlane_brainbar_daemon.py:793-796`. Right to gate migrations. |
| 2.5-R2 checkpoint contention | **6** | `wal-checkpoint` last exit **1** confirmed — but "Small" is wrong: on-disk WAL is **1.32GB right now**, not the header's 80MB. This is D1's objective regressing nightly. |
| 2.5-R3 backup deadline reality | **8** | du9006 deployed 6h wrapper at `fcfbc8a2`, confirmed. But see F2: a backup run started **12:17:35 IDT today**, mid-council. |
| W3 preconditions + runbook | **7** | Runbook shape sound; "fresh backup <24h" is the wrong pin — must be `DONE_W0_BACKUP` (unattended natural exit 0), which is still withheld. |
| 3a source_class | **6** | Column absent, confirmed. But chunks ALREADY has `provenance_class` (mixed vocab: AGENT-INFERENCE ×133,731 beside codex-session ×1,590) + `chunk_origin` — 3a adds a THIRD class column with no reconciliation named. |
| 3b branch column | **8** | Exactly **100 rows / 2 values** (2026-06-20=61, 2026-06-13=39) re-verified live by query. Right-sized. |
| 3c author_model + convention | **7** | #655 open confirmed. Unresolved contradiction inherited silently: AP7 says never-self-report, yet Claude effort capture requires checkpoint-time self-report (CONVERGENCE §checkpoint-metadata). |
| 3d migration ledger | **8** | `schema_migrations` (3 rows) + `migration_events` (**0 rows**) already exist in prod DB; #618 open. Contract is right; assert-in-each is the missing part. |
| 4a provenance backfill | **7** | Numbers trace to 08-05 audit: 5,137 lost, but the window-scoped **touch-set is 8,321 rows** — plan should say so. Sequencing after 3a correctly breaks the backfill↔enrichment loop. |
| 4b date-projects | **9** | Verified exactly 100 live. |
| 4c 308 digest repair | **7** | Matches ratified Decision 4 + amendment, but the executor class is undesigned: brain-worker law says "never stores" — the scoped exception/backfill-worker class must be minted first. |
| 4d enrichment ON | **8** | Pre-gates #623/#621/#617 all confirmed open. Enrichment caused the 5,137 incident; gating on doctor + Etan-go is correct. |
| 5a/5b/5c truth build | **8/8/9** | Matches ratified C→B→A order, DECISION 1 two-tier + suggest-only-until-benched + digest rider, verbatim. No re-litigation found. |
| **Overall (weighted)** | **7.4** | Conditional GO. |

**My rubric+weights:** receipt fidelity 25% · gate soundness 25% · blast-radius control 20% · sequencing 15% · ratification traceability 15%.

**Receipts I verified live (not relayed):** 2026-08-09.db.gz receipt real — `verified=true, uploaded=true, drive_md5_match=true`, sentinel parity 741,951/741,951 (production log, parsed myself). PyPI latest = 1.5.3 (queried). PRs #678/#679/#680/#682/#683/#685 all on `origin/main` (git log). Letter installed (AGENTS.md). `source_class`/`branch`/`author_model` absent from chunks schema (pragma, mode=ro). tier0/throughput watchdogs exit 0 — "watchdog clean" holds narrowly.

**Falsifiable findings:**
- **F1 — header receipt "WAL 80MB" is false NOW.** `ls` shows `brainlayer.db-wal` = 1,323,035,032 bytes (1.32GB), mtime 04:53. The 79.7MB reading was a moment, not a state: the TRUNCATE job that would keep it small is the same job R2 admits exits 1. R2 is therefore not "Small" — it is the mechanism by which D1's win evaporates nightly (reader tax on the 8.7s MCP latency baseline included). Refute me with: `ls -la ~/.local/share/brainlayer/brainlayer.db-wal` under 100MB after a clean nightly TRUNCATE.
- **F2 — a backup run started 12:17:35 IDT today** (PID 88098, `launchctl` runs=1 on the wrapper du9006 loaded fresh at 07:53 expecting a natural 2026-08-10 03:17 fire). Neither 00:03 nor 03:17 schedules explain it. If nobody owns this kickstart, tonight's "unattended natural run" close-criterion for `DONE_W0_BACKUP` is contaminated, and W3's backup-freshness precondition inherits the ambiguity. Name the owner or investigate before Wave 3 preconditions are declared met.
- **F3 — 3a migrates INTO an unreconciled classification field-set.** `SELECT provenance_class, COUNT(*) FROM chunks GROUP BY 1` returns two interleaved vocabularies (epistemic: RAW-ETAN-DIRECT/AGENT-INFERENCE/…; source-ish: codex-session/direct-session/t3-app-session/fleet-subagent/recon-agent) plus 526,421 empty; `chunk_origin` holds a third (model names/manual/unknown ×305,519). Adding `source_class` without a written disposition for these two repeats the exact drift 3a exists to fix.
- **F4 — 3c ships schema for a contract with an open contradiction** (AP7 never-self-report vs Claude checkpoint-time effort self-report). Resolve on paper before the column lands; a column with two provenance rules is worse than no column.

**CONDITIONS (→ conditional verdict):**
1. **C1:** Re-state the WAL receipt truthfully and upgrade R2 from "Small" to a gated Wave-2.5 item: nightly TRUNCATE must exit 0 on a staggered schedule for 2 consecutive nights before Wave 3 slot N.
2. **C2:** Pin W3's backup precondition to `DONE_W0_BACKUP` itself (unattended natural exit 0 + receipt), not "a fresh backup <24h"; own/explain the 12:17 run.
3. **C3:** 3a brief must carry a one-paragraph disposition for `provenance_class` + `chunk_origin` (map / freeze / deprecate), asserted in the migration.
4. **C4:** 3c blocked until the effort-provenance rule is written down one way.
5. **C5:** 4a brief states the real touch-set (8,321 window rows to repair 5,137) — no "5,137-row backfill" shorthand reaching Etan.
6. **C6:** 4c mints the backfill-worker class (or a dated scoped store-exception) before dispatch.

**VERDICT: CONDITIONAL GO.** Wave 2.5 dispatch now (with C1 folded in). Wave 3 NO-GO until C1+C2+C3 (+W0 close). Wave 4 rides Wave 3 + C5/C6. Wave 5 GO as designed — it is the best-ratified part of the plan; the Etan-gates stand. Disagreement signal for the panel: I score 2.5-R2 lowest where the plan calls it smallest.

— R3 · council voting seat · claude/fable-5

DONE_REALC_R3

---
