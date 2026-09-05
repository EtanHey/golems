# Collab: REAL council round 2 — migration plan v2 (post-stop-line, per Etan's ratified order)
Subject: $ORCHESTRATOR_REPO/collab/2026-08-09-brainlayer-MIGRATION-PLAN-v2.md
Receipts to validate against: 2026-08-09-brainlayer-wave2-close.md + CONVERGENCE.md + repo MAP.json
+ live repo (read-only). Each reviewer: OWN rubric+weights; score EVERY wave/lane 1-10; verify
claims against the repo; falsifiable findings; conditional verdict; **output MUST begin with your
scorecard TABLE** (Etan reads tables, not prose). Append here, sign family, end DONE_REALC_<R1|R2|R3>.
## Messages (append-only)

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

| Wave / lane | T 30 | K 25 | S 25 | L 20 | **Score /10** | Dispatch verdict |
|---|---:|---:|---:|---:|---:|---|
| **W2.5 aggregate** | — | — | — | — | **6.3** | GO only as residual work |
| W2.5-R1 embed-starvation | 9 | 5 | 4 | 3 | **5.55** | RESHAPE, then run |
| W2.5-R2 checkpoint/backup contention | 10 | 3 | 5 | 4 | **5.80** | RESHAPE, then deploy |
| W2.5-R3 backup deadline-to-reality | 9 | 7 | 8 | 5 | **7.45** | CONTINUE; not closed |
| **W3 aggregate** | — | — | — | — | **5.2** | **NO-GO** |
| W3 preconditions | 4 | 5 | 4 | 3 | **4.05** | BLOCK |
| W3 two-host runbook | 8 | 6 | 7 | 4 | **6.45** | HOLD; add artifact/rollback receipts |
| 3a `source_class` + policy | 8 | 5 | 4 | 3 | **5.25** | HOLD |
| 3b `branch` + normalizers | 9 | 5 | 6 | 3 | **6.05** | HOLD |
| 3c author/convention fields | 9 | 3 | 5 | 2 | **5.10** | BLOCK on capture contract |
| 3d #618 DDL ledger | 10 | 1 | 3 | 1 | **4.20** | REDESIGN; must precede 3a |
| **W4 aggregate** | — | — | — | — | **5.6** | **NO-GO behind W3** |
| 4a provenance repair | 5 | 4 | 5 | 2 | **4.15** | RESCOPE per host |
| 4b 100 date-project rows | 10 | 6 | 7 | 3 | **6.85** | HOLD |
| 4c 308 digest repairs | 9 | 7 | 7 | 2 | **6.60** | CONDITIONAL GO after W3 |
| 4d enrichment ON | 8 | 4 | 5 | 1 | **4.85** | ETAN-GATED / BLOCK |
| **W5 aggregate** | — | — | — | — | **5.3** | GO for design only, not build |
| 5a typed truth table | 7 | 5 | 6 | 1 | **5.05** | DESIGN SIT-DOWN |
| 5b occurrence tripwire | 7 | 4 | 6 | 1 | **4.80** | DESIGN SIT-DOWN |
| 5c supersession apply-mode | 8 | 6 | 8 | 1 | **6.10** | DESIGN/BENCH only |
| Standing-law block | 8 | 7 | 8 | 5 | **7.15** | KEEP; strengthen deploy gate |
| Gate: item 7 design sit-down | 9 | 7 | 10 | 1 | **7.15** | Correctly gated |
| Gate: item 8 execution | 8 | 6 | 9 | 1 | **6.35** | Correctly gated |
| Gate: archival mission cluster | 8 | 2 | 10 | 1 | **5.60** | Gate sound; contract absent |
| Gate: ITEM E MCP 2026-07-28 | 3 | 2 | 8 | 1 | **3.60** | Replace obsolete contract |
| Gate: ITEM F taste-pass | 7 | 2 | 9 | 1 | **5.05** | Gate sound; unspecced |
| **Overall lane average** | — | — | — | — | **5.6** | Conditional GO for W2.5 only |

R2 — Codex family, adversarial. Rubric: **T** premise truth/live evidence 30%; **K** complete,
falsifiable contract 25%; **S** data safety + dependency correctness 25%; **L** executing-artifact/live
proof 20%. Scores judge dispatch readiness, so an intentionally Etan-gated item can be directionally
right and still score low.

### Findings

**F1 — v2 says all Wave-2.5 residuals precede migrations, then its `Preconditions (ALL)` gates only
R1. BLOCKER.** R2 and R3 disappear from the gate. Live evidence makes that omission material:
`brainlayer status --json` reports `operational_green=false`, drain and watcher stale, queue depth
1,279; the WAL is 1,323,035,032 bytes; `wal-checkpoint` last exit is 1; and the currently running
backup LaunchAgent says `last exit code = (never exited)`. The 80MB WAL and clean-watchdog receipts
were true moments, not durable preconditions.

**Falsifier:** before slot N, require all three Wave-2.5 close receipts: missing-embedding debt falling
under sustained high-priority arrivals without regressing store latency; the installed staggered
checkpoint job exiting 0; and `DONE_W0_BACKUP` from an unattended natural run. Add two fresh
`operational_green=true` probes with watcher/drain fresh.

**F2 — “merged” still substitutes for “deployed” in the plan preamble. BLOCKER.** The canonical venv
reports `brainlayer 1.5.3`, but `/opt/homebrew/bin/brainlayer` still points at Cellar 1.5.2 and rejects
`--version`. The receipt explicitly withholds `DONE_RELEASE_LANE`: notarization, tap merge, brew install,
and HIGH-4 live proof remain blocked. W3 does not require that lane to close even though writers execute
mixed artifacts.

**Falsifier:** require either `DONE_RELEASE_LANE` plus brew `--version == 1.5.3` and zero doctor drift,
or an explicit artifact-table proof that every writer/reader was repointed away from brew and that no
1.5.2 process can reopen the migrated DB.

**F3 — 3d cannot satisfy #618 with the table it names. BLOCKER.** `schema_migrations` has only
name/time/details (`vector_store.py:821-826`). More importantly, current `migration_events` is the
git-learning invalidation table: `from_pattern`, `to_pattern`, `commit_hash`, `repo`, confidence, and
`memories_weakened` (`vector_store.py:1519-1532`; writer at `git_learning.py:134-141`). It cannot record
#618's actor, affected objects, prior/result fingerprint, or truthful failure. “Assert it in each” repeats
the round-1 defect; the audit primitive must exist before the first DDL.

**Falsifier:** land a dedicated, backward-compatible DDL-event ledger first; mutation-test one successful
and one failed repair on a production-DB copy, with the failed event omitting a resulting fingerprint;
then make 3a/3b/3c call it atomically.

**F4 — 3c's capture premise is already false in Codex, and the lane omits the writer matrix and
backfill.** The Codex parser sets `model` to provider `"openai"` at `ingest/codex.py:153`, then
`if not model` at `:159-161` prevents the actual turn model from replacing it. BrainBar's native insert
paths omit all proposed identity fields (`BrainDatabase.swift:1118-1125,1355-1359`), while the runtime
schema contract has none (`runtime_store.py:70-133`). The approved live model-switch experiment is not
a W3 precondition, and W4 contains no author-model/harness/effort/role backfill lane.

**Falsifier:** a two-turn live fixture that switches models and stores the correct model per resulting
chunk; a writer matrix covering Claude watcher, Codex adapter, durable queue/drain, BrainBar direct store
and replay; and a separately gated raw-JSONL backfill with per-host counts.

**F5 — 3a still leaves today's workflow-memory loss ownerless.** Main still has
`DEFAULT_INGEST_DENYLIST=("~/.claude/projects/**/wf_*/**",)` (`ingest_denylist.py:14`), so the path glob
returns before attribution (`:160-166`) and excludes every workflow, not only session-miner/weave.
#680 fixed ordinary Task-subagent handling; it did not close this ratified drift. A new column cannot
recover sources rejected before insert.

**Falsifier:** before 3a, run end-to-end append/restart tests for ordinary implementation workflow,
weave/session-miner, ordinary subagent whose attribution arrives after the first line, and exact
brain-worker. Assert saved-to-disk versus indexed/default-visible behavior per class, then backfill only
the indexed populations.

**F6 — W5 preserves the right C→B→A order but is not yet a build contract.** The repo already contains
an unintegrated bitemporal mechanism that adds `valid_from`/`invalid_at`, `_chunks_history`, and UPDATE/
DELETE triggers (`bitemporal.py:11-17,32-49,104-160`), while the live chunks schema lacks those columns.
The proposed truth table never states whether it replaces, consumes, or coexists with that mechanism or
with `entity_facts`; 5b also drops the judged ledger's explicit timestamp even though “new/escalating” and
per-day accumulation require it.

**Falsifier:** the item-7 sit-down must publish one ownership map for chunks lifecycle, bitemporal history,
entity facts, and typed assertions; then test origin traversal, expiry/current selection, many-to-many
invalidation, archive behavior, and occurrence dedupe across sessions before any W5 migration.

### Conditional verdict

**GO now:** Wave 2.5 diagnosis/fixes and Etan's W5 design sit-down. **NO-GO now:** every W3/W4 mutation
and every W5 build. Promote to conditional GO only after F1/F2 close, the #618 audit primitive lands
before slot N, 3a/3c gain full writer/capture contracts, and W4 publishes re-counted per-host mutation
manifests. The strongest part of v2 is ordering; the weakest is treating receipts and schema nouns as
behavioral gates.

— R2 · Codex family · adversarial council seat · Codex harness

DONE_REALC_R2

---

## R1 — LIFT TABLE (Etan's follow-up: one artifact per sub-8 lane + research call)

Rule I applied: **one** artifact each, and it must be the thing whose absence is why the score is
low — not a wish list. "Deep research?" = would `/gemini-research` genuinely change the answer.

| Lane | Now | THE ONE artifact/action that lifts it above 8 | Deep research? |
|---|---|---|---|
| **W2.5-R0** (new blocker) | — | **A green deploy probe on `com.brainlayer.watch`**: `/opt/homebrew/bin/brainlayer --version` prints `1.5.3` AND a chunk lands <60s after a live JSONL append. Cask bump or repoint the LaunchAgent — either, but prove it. | **No.** Nothing to learn; it's a symlink. |
| **W2.5-R1** embed starvation | 5 | **A stall trace of the live process** — `py-spy dump --pid 58381` (or sample) while it spins at 48% CPU committing nothing, taken on the DEPLOYED artifact. Every design option in the lane is guesswork until we see the stuck frame. | **No.** The answer is in RAM on his Mac. |
| **W2.5-R2** checkpoint contention | 7 | **A 7-day contention timeline**: `wal-checkpoint` exit code + WAL bytes sampled q15min, overlaid on the 00:03/03:17 backup and enrichment windows. Turns "stagger or coordinate" into a chosen slot with evidence. | **YES — narrow.** Real prior art on WAL checkpoint starvation under long-lived readers + `F_FULLFSYNC` on APFS. One tight question, not a sweep. |
| **W2.5-R3** backup deadline | 7 | **One nightly run that completes with `"pragma":"ok"`** — integrity_check back ON, inside the deadline. That single log line closes the lane. | **No.** |
| **W3 preconditions** | 4 | **The per-host ARTIFACT TABLE, checked in and regenerated by a command**: launchd label → binary → venv → version → sha, one green deploy probe per row. I asked for this in round 1; it still does not exist, and it is the single thing standing between "merged" and "true". | **No.** Pure local inventory. |
| **3a** `source_class` | 5 | **A class-truth test that runs against the deployed artifact**: five fixture sessions, one per class, asserting ingest + default-visibility + expansion match the letter. The column is only as good as the classifier feeding it — and the deployed classifier currently excludes all subagents. | **No.** The taxonomy is Etan's, already ratified. |
| **3b** `branch` column | 6 | **The enumeration output itself, before any write** — full distinct `project` × `branch` inventory with a proposed mapping per row. Also the cheapest way to catch the 99 dated slugs. | **No.** |
| **3c** `author_model` | 6 | **A widened #655** (or a sibling) whose acceptance criteria include effort + harness + role — plus the one-line sibling read at `ingest/codex.py:159-162` that already has the data and discards it. Today the issue is model-only, so the lane can close while the goal stays unmet. | **No** — but route the "what fields do current harnesses expose" question to `/whats-new`, not research. |
| **3d** #618 ledger | 3 | **A reconciliation script + its output**: live schema diffed against the 3 recorded migrations, the gap written back as retroactive entries, and a test that fails when `PRAGMA table_info(chunks)` drifts from the ledger. Recording forward from a ledger that is already wrong ships a liar. | **No.** |
| **Two-host runbook** | 5 | **One timed DRY RUN on the M1 against a DB copy.** It converts a paragraph into a rehearsed procedure and — the part that matters to you — produces the actual wall-clock number for how long you have to sit there, four times. | **No.** |
| **4a** provenance backfill | 4 | **A population census in one table**: 5,137 (the window) vs 64,107 (`provenance_resolve_queue`) vs 526,421 (`provenance_class IS NULL`), with a stated policy per band. Right now the lane repairs a window and reads like it repairs the population. | **No.** |
| **4b** date-projects | 6 | **The producer fix + its regression test, landed BEFORE the backfill** — project must resolve to the repo, never a worktree directory name. Then 199 is a finite number instead of a treadmill. | **No.** Law already ratified 2026-08-02. |
| **4c** 308 digest rows | 6 | **The located-originals manifest** — 308 rows → source JSONL/Drive path + offset — verified before a single write. If it cannot reach 308/308, the lane's shape changes and you should know that before the executor starts. | **No.** |
| **4d** enrichment ON | 7 | **A green `brainlayer doctor` on the deployed artifact with #623/#621/#617 closed.** The gating is already right; the gates just aren't closed. | **No.** |
| **5b** occurrence tripwire | 7 | **The prior-art + adversarial-validation memo you already ordered** (CONVERGENCE Decision 3: "goes to a small COUNCIL for adversarial validation + online prior art, per Etan's explicit ask"). It is the lane's missing artifact and it is literally a research deliverable. | **YES — and already ordered by you.** Alert fingerprinting / dedup / alert-fatigue prior art. |
| **Standing law block** | 7 | **One added line, mechanized**: "no lane ships against an artifact it did not prove it deploys to" + a CI or pre-push check that fails a brief with no named executing artifact. Law that isn't mechanized is a preference. | **No.** |

### The honest research call

**13 of 16 rows: No.** That is the finding, not a dodge. This plan's weak lanes are weak because of
**unread local state** — a symlink, a stuck stack frame, a launchd inventory, three SQL counts — not
because the fleet lacks knowledge. Sending them to deep research would buy literature where the
answer is sitting on your disk, and would cost the one thing the stop-line is protecting: time.

**Two genuine YES rows,** both narrow and both with a stated question:
1. **W2.5-R2** — "SQLite WAL checkpoint starvation with long-lived readers and `F_FULLFSYNC` on
   APFS at multi-GB WAL: which checkpoint strategy actually converges?" Prior art exists.
2. **5b** — the tripwire-shape research you already ordered at Convergence. Not new scope, just
   unstarted.

**One near-miss worth naming:** if Wave 3 ever un-blocks, the question *"what breaks when you
`ALTER TABLE` alongside `sqlite-vec` virtual tables and their shadow tables at 17GB"* is genuinely
under-documented and would earn a research pass — but it is wasted effort while F1/F2 stand, so I
am not spending it now.

— R1 · Claude/Opus 5 (1M) · council seat, review role · Claude Code harness

DONE_REALC_R1_LIFT

| R2 lane below 8 | R2 score | THE ONE artifact/action that lifts it above 8 | `/gemini-research`? |
|---|---:|---|---|
| W2.5-R1 embed-starvation | **5.55** | **A sustained live scheduler-soak receipt** showing missing-embedding debt falling while high-priority arrivals continue, with queue age and store-latency bounds intact. | **Unnecessary.** This is a local scheduler/telemetry question. |
| W2.5-R2 checkpoint/backup contention | **5.80** | **A two-night deployed checkpoint receipt** showing the installed staggered job exits 0 twice and keeps WAL below its declared bound while backup and enrichment also run. | **Genuinely helpful, narrowly.** Research SQLite WAL convergence under long-lived readers and APFS durability before choosing the final strategy. |
| W2.5-R3 backup deadline-to-reality | **7.45** | **The natural-run `DONE_W0_BACKUP` receipt** from one unattended scheduled run: exit 0, verified upload/MD5, sentinel parity, and no manual kickstart ambiguity. | **Unnecessary.** Only the real scheduled run can close it. |
| W3 preconditions | **4.05** | **A generated slot-N admission manifest** binding exact deployed artifact hashes to all three W2.5 close receipts, `DONE_RELEASE_LANE`, stopped-writer proof, fresh backup, and two green operational probes. | **Unnecessary.** It is local release-state reconciliation. |
| W3 two-host runbook | **6.45** | **A successful timed two-host rollback-rehearsal packet** produced on production-DB copies, including row reconciliation and post-rollback live probes. | **Unnecessary.** Rehearsal evidence dominates literature. |
| 3a `source_class` + policy | **5.25** | **An executable source-class truth matrix** covering ordinary workflows, weave/miners, late-attributed ordinary subagents, and brain-workers end to end, while recording the disposition of `provenance_class` and `chunk_origin`. | **Unnecessary.** Etan's class policy is already ratified; implementation truth is local. |
| 3b `branch` + normalizers | **6.05** | **An all-writer branch-capture conformance pack** that inventories every normalizer and proves with golden events that `project=repo` and branch is captured at event time, including the enumerated repair population. | **Unnecessary.** The law and data are local. |
| 3c author/convention fields | **5.10** | **An all-writer identity conformance pack** proving a live model switch and correct turn-scoped model/harness/effort/role through Claude, Codex, durable replay, and BrainBar, with a per-host backfill manifest. | **Unnecessary.** Inspect current harness payloads and writers directly; deep web research adds little. |
| 3d #618 DDL ledger | **4.20** | **Land the dedicated DDL-event ledger primitive first**, with production-DB-copy mutation tests for one successful and one failed change and atomic use by every later migration. | **Unnecessary.** This is a concrete local schema-contract defect. |
| 4a provenance repair | **4.15** | **A per-host DB-copy mutation manifest** enumerating the exact repair/touch set, before/after provenance, outside-window checksums, and rollback IDs before production approval. | **Unnecessary.** The decisive evidence is the real data copy. |
| 4b 100 date-project rows | **6.85** | **A producer-first DB-copy repair receipt** proving every offending population was re-enumerated and repaired only after all normalizers stopped emitting dated project slugs. | **Unnecessary.** The repo-naming law and offending rows are known locally. |
| 4c 308 digest repairs | **6.60** | **A 308/308 repair manifest** mapping every row to its source locator, before/after content and vector hashes, and rollback ID. | **Unnecessary.** Source recovery is a local provenance exercise. |
| 4d enrichment ON | **4.85** | **An Etan-approved live enrichment-canary receipt** after #623/#621/#617 and deployed-doctor gates close, proving no `source_class` regression before wider enablement. | **Unnecessary.** Only the canary can establish safety. |
| 5a typed truth table | **5.05** | **An Etan-ratified truth-ownership decision record** mapping typed assertions against chunk lifecycle, bitemporal history, and `entity_facts`, with current-selection and origin-traversal invariants. | **Genuinely helpful.** A narrow SOTA pass on temporal/provenance truth models can expose missing invariants before ratification. |
| 5b occurrence tripwire | **4.80** | **An executable occurrence-ledger benchmark** that fixes timestamp and fingerprint scope, then tests cross-session dedupe, escalation, and per-day `/weave` accumulation. | **Genuinely helpful.** Alert fingerprinting, incident dedupe, and alert-fatigue prior art can materially improve the contract. |
| 5c supersession apply-mode | **6.10** | **A corrections gold-set benchmark report** with promotion thresholds, a false-positive budget, rollback rules, and the exact Etan digest sample used for approval. | **Unnecessary.** Local correction history—not external literature—determines whether apply-mode is safe. |
| Standing-law block | **7.15** | **A machine-enforced lane-brief schema** that rejects any brief missing its executing artifact, deploy/mechanism probe, review identity, worktree, or monitor-stop step. | **Unnecessary.** This needs enforcement, not research. |
| Gate: item 7 design sit-down | **7.15** | **The Etan-ratified item-7 decision record** resolving ownership, lifecycle, provenance, and current-truth invariants before any W5 DDL. | **Genuinely helpful.** Use the same narrow temporal/provenance research pass as 5a to challenge the sit-down options. |
| Gate: item 8 execution | **6.35** | **An Etan-ratified item-8 execution manifest** pinning order, owners, backfill-executor class/exception, rollback boundaries, and slot admission criteria. | **Unnecessary.** The unresolved choices are fleet policy and execution authority. |
| Gate: archival mission cluster | **5.60** | **An executable archival contract pack** specifying embed-before-archive, reader parity, no-auto-delete, restore drill, and rollback acceptance criteria. | **Genuinely helpful.** Prior art on transactional archive/index lifecycles can reveal failure modes before the mission is scoped. |
| Gate: ITEM E MCP 2026-07-28 | **3.60** | **A final-spec compatibility matrix with live conformance probes** replacing the obsolete contract across Python MCP and BrainBar native paths. | **Unnecessary.** Read the official final specification and SDK directly; a broad research sweep would dilute the primary source. |
| Gate: ITEM F taste-pass | **5.05** | **An Etan-signed taste-pass packet** containing the rubric and accepted before/after decisions on representative real screens. | **Unnecessary.** External taste research cannot substitute for Etan's acceptance signal. |

— R2 · Codex family · adversarial council seat · Codex harness

DONE_REALC_R2_LIFT
