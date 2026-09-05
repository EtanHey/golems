## R1 (Claude / Opus 5, 1M) — REAL round 2 · plan v2 · scored 2026-08-09 09:2xZ

### TABLE A — my rubric (own weights, sum 100)

| # | Dimension | W | Score | Why (one line, all live-verified) |
|---|---|---|---|---|
| 1 | **Deploy truth** — does the plan act on what actually EXECUTES? | 25 | **2** | The live watcher runs brew **1.5.2 (Aug 4)** — rejects `--version`, so it predates #660/#661/#664/#667/#678-#685. Zero wave-0/1/2 code is in the ingesting process. |
| 2 | **Data safety / reversibility** | 20 | **6** | 08-09 Drive backup is REAL (md5 match, 741,951 sentinel chunks) — but `"pragma":"skipped"`, 44.9GB orphan attempt files, no disk budget for 4 rehearsal copies. |
| 3 | **Diagnosis fidelity** — stated cause vs live evidence | 20 | **4** | 17,928 verified EXACTLY ✓. But "WAL 80MB / watchdog clean" is false live, and W2.5-R1 describes scheduling starvation when the pipeline is **fully stalled**. |
| 4 | **Sequencing & gate integrity** | 15 | **6** | Stop-line respected, order sane. Two preconditions are unfalsifiable as written ("verified backup", "writers stopped" — no proof-of-stop probe). |
| 5 | **Scope completeness** | 10 | **4** | wf_* over-exclusion unassigned; 99 dated-slug project rows unlisted and still growing; migration ledger gap not reconciled by 3d. |
| 6 | **Human-cost realism** | 10 | **5** | 4 migrations × 2 hosts × Etan-present-for-M1 is unsized. |
| | **WEIGHTED TOTAL** | 100 | **4.3 / 10** | |

### TABLE B — every wave/lane scored 1-10

| Lane | Score | Verdict | Falsifiable basis |
|---|---|---|---|
| W2.5-R1 embed starvation | **5** | RESHAPE | Count exact (17,928). Cause wrong: not starvation — **7.5h total stall**. |
| W2.5-R2 checkpoint/backup contention | **7** | GO | `com.brainlayer.wal-checkpoint` last exit **1**; contention real, lane correct, sized right. |
| W2.5-R3 backup deadline | **7** | GO (in flight) | 08-09 backup verified end-to-end; residual is the skipped pragma. |
| **W2.5-R0 (MISSING — I add it)** | **—** | **BLOCKER** | Ingestion dead 7.5h + watcher runs 1.5.2. Nothing below matters until this is true. |
| W3 preconditions | **4** | NO-GO | Never names which ARTIFACT migrates, or proves writers stopped. |
| 3a `source_class` | **5** | HOLD | Right column. But the class it encodes is contradicted by the deployed denylist (below). |
| 3b `branch` column | **6** | HOLD | Sound; enumeration-then-fix is the right shape. |
| 3c `author_model` (#655) | **6** | HOLD | #655 OPEN, scope still model-only; effort field still unwidened. |
| 3d #618 ledger | **3** | RESHAPE | `schema_migrations` has **3 rows** (newest 2026-05-27); `migration_events` has **0**. Plan makes future migrations write it and never reconciles the existing gap. |
| Two-host runbook | **5** | HOLD | Imports a requirement CONVERGENCE parked ("the two Macs do not share a DB"). Unsized human cost. |
| 4a backfill 5,137 provenance | **4** | RESCOPE | Live: `provenance_resolve_queue` = **64,107**; `provenance_class IS NULL` = **526,421**. 5,137 is a window, not the population — say so. |
| 4b backfill 100 date-projects | **6** | RESCOPE | 100 rows / 2 values verified EXACTLY. But 99 more rows / 13 values of the same law-break sit beside them, newest **2026-08-04** — still being produced. |
| 4c 308 digest rows | **6** | GO (gated) | Shape correct (ingest-excluded executor). 308 not independently re-verified by me. |
| 4d enrichment ON | **7** | GO (gated) | Pre-gates named, Etan-gated. Correct to be last. |
| 5a typed truth table | **8** | GO | Best-designed lane in the plan. Carries origin links + m2m edges per R3. |
| 5b occurrence tripwire | **7** | GO | Correct that it accumulates for an invoked /weave. |
| 5c supersession apply-mode | **8** | GO | Suggest-only until benched + Etan digest = right. |
| Standing law block | **7** | GO | Good. Add: "no lane ships against an artifact it did not prove it deploys to." |

### THE FOUR FINDINGS (all reproducible)

**F1 — The ingesting process is not running your code. BLOCKER.**
`/opt/homebrew/bin/brainlayer -> ../Cellar/brainlayer/1.5.2/bin/brainlayer` (symlink dated **Aug 4 16:37**). LaunchAgent `com.brainlayer.watch` pid 58381 executes exactly that path. `brainlayer --version` on it still **errors** — so it predates PR #660 (merged 08-08 13:03Z) and therefore every fix after it. Plan v2's preamble reads "all wave-0/1/2 PRs merged" as a deploy receipt. It is not one.
*Sharpest consequence:* the deployed 1.5.2 denylist is
`("~/.claude/projects/**/wf_*/**", "~/.claude/projects/**/subagents/**")` — **ALL subagents excluded right now.** #680 removed that blanket on main. The letter-serving fix is merged and not running.

**F2 — BrainLayer has recorded nothing for 7.5 hours, including this council. BLOCKER.**
Newest chunk by rowid: `ingested_at` = **1786240276 = 2026-08-09T01:51:16Z**. Last hotlane commit: `writer-telemetry.jsonl` `txn_finished` **01:53:15Z**. `brainlayer.db-wal` untouched since **01:53Z**. Meanwhile **9** session JSONLs were appended this morning (newest 09:18Z — this session). Watcher pid 58381 elapsed **05:27** at 48.6% CPU — restarted 5 min ago, spinning, persisting nothing. This is D1's freeze recurring, on an artifact that does not contain D1.
Corollary: missing-embeddings is not "RISING" — it is **frozen at 17,928** because the pipeline is dead. Worse, not better.

**F3 — Two of the plan's three headline receipts are false as of now.**
- "WAL 80MB" → live `brainlayer.db-wal` = **1,323,035,032 bytes (1.32GB)**. Your own receipts file records the regression at line 3121 ("at its check WAL was 817MB"); v2's preamble cites only the 79.7MB reading from line 3114.
- "watchdog clean" → `tier0-watchdog.log` last 12 entries are all `com.brainlayer.health-check reason=state_stale`, ages to **14,038s** against a 900s threshold; `launchctl` shows last exit **1** for health-check, maintenance-nightly, throughput-watchdog, decay, wal-checkpoint, and **2** for repair-fts. Seven services non-zero.
- (Fair is fair: "backup real on Drive" and "v1.5.3 on PyPI" both **verified true**, and **17.9k is exact**. The plan is honest where it is checkable — it is stale where it was transcribed.)

**F4 — Three inherited defects have no owner in v2.**
- `src/brainlayer/ingest_denylist.py:14` + `:160-163` — `DEFAULT_INGEST_DENYLIST = ("~/.claude/projects/**/wf_*/**",)` still excludes **every** workflow agent on main. AGENTS.md itself flags this as shipped drift owned by "the brainlayer lane." v2 has no such lane. Legitimate workflow memory is being dropped every day the stop-line holds. Also `unknown_subagent_is_denylisted=True` (`:156`) fails **closed** — unknown attribution = memory dropped, against the letter's "normal subagents: indexed, labeled."
- The 99 dated-slug projects (`2026-07-31-t3layer-...`, `2026-08-03-worker-dock`, newest row 2026-08-04) break the same ratified law as 4b's 100 and are still being produced. 4b repairs 100 and leaves the producer running.
- AGENTS.md instruction-truth: "929 tests" (real: **2,057** `def test_` in `tests/`), "~8GB" DB (real: **17.4GB**), and the wf_* note now half-stale.

### MY CONDITIONS (conditional verdict)

**Wave 3: NO-GO.** Unchanged from round 1, for a new reason — not "the backup is fictional" (it isn't anymore, you fixed it) but **"we cannot deploy to the thing we would be migrating around."** Migrating schema under a watcher running 5-day-old code is how you get a schema the writer doesn't know about.

**Wave 2.5: GO, with R0 inserted ahead of R1:**
1. **W2.5-R0 (new, blocking):** bump the cask / repoint the LaunchAgent so `com.brainlayer.watch` executes 1.5.3. RED = `/opt/homebrew/bin/brainlayer --version` prints 1.5.3 **and** a new chunk lands within 60s of a live JSONL append. This is Etan's "stupid-simple-install" ruling arriving as a blocker.
2. **W2.5-R1 re-diagnose before designing.** The starvation design solves the wrong failure. Find why pid 58381 spins without committing, on the deployed artifact, first.
3. **Precondition, add to Wave 3:** each migration brief names the artifact that executes it AND proves ingestion is live after (chunk-lands-within-60s probe), per your own standing "deploy+mechanism gate."
4. **Precondition, tighten:** define "verified backup" now that `pragma` is optional — for a migration gate it must be `integrity_check`, not gzip+md5.
5. **3d must reconcile, not just record.** 3 ledger rows / 0 events vs ~10 columns added since May is the gap; write the reconciliation as part of 3d or it ships a ledger that lies from row one.
6. **Give F4's three orphans a lane.** The wf_* over-exclusion is losing memory *today* and costs one line plus a test.

**Where I disagree with myself from round 1:** I scored the backup gate "fictional" then. It is real now — verified full-mode, md5-matched, on Drive. That lane worked. My score is still low because the failure moved, not because nothing was fixed.

— R1 · Claude/Opus 5 (1M) · council seat, review role · Claude Code harness

DONE_REALC_R1
