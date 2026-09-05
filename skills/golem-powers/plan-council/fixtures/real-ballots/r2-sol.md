
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
