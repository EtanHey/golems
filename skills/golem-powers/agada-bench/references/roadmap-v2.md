# /agada-bench v2 Roadmap

> v1.1 SHIPS as-is. Per W1.7's skeptical pass, FM12 = 0/145 in production; v1.2/v2 work is justified only when specific flip conditions fire. This doc records the deferred bucket so future-Etan doesn't have to re-derive.

---

## v1 (this skill) is the current production target

v1 covers:
- The 7-phase pipeline (extract → judge → liveness → crossref → κ → gold-lock → pending-RT).
- The 3-judge default panel + W3.2-derived drop-cursor decision.
- Rubric v1.1 (FM1–FM14 catalog).
- FM13 liveness gate (W3.1).
- Pending-RT routing decision tree (W3.3).
- Eval coverage: 3+ fixture cases, regression test against tonight's Run 1 gold.

No labeling sprints, no LoRA training, no local-judge hosting. ≤ 1700 LOC total.

---

## v2 flip conditions

Re-open v2 work ONLY if any of the following empirical conditions fire on a future run:

| Trigger | Means | Action |
|---|---|---|
| Run 5+ shows `FM12 > 0` | One of the production judges started hallucinating off-corpus rows. | Investigate that judge's prompt drift; possibly add a verification step. |
| Second judge dies mid-run (FM13 confirmed beyond Run 4) | Liveness failure is a recurring pattern, not a one-off. | Add proactive PTY-attach validation at spawn time (W3.1 design Gap-1 candidate 3). |
| Pending-RT density > 20% of corpus on any new domain | Rubric doesn't generalize to that domain. | Bump to v1.2 with domain-specific examples (W1.3's per-domain calibration). |
| After FM6 PR A ships + re-bench, unanimous-3 convergence stays < 60% | Even with FM6 fixed, the panel is too disjoint OR rubric too ambiguous. | Investigate; possibly swap a judge or iterate rubric. |
| Mean κ jumps > 0.15 across two consecutive runs | Calibration drift in one or more judges. | Re-run W3.2's κ matrix; if confirmed, swap the drifting judge for next run. |

Until any of these fire, **don't build v2.** v1.1's empirical record (FM12 = 0/145, unanimous-3 = 56–66%) doesn't justify the cost.

---

## v2 buildout sketches (when triggered)

### Phase A.5 — chunk_id prefix → full resolution (discovered 2026-05-16)

**Goal:** extract-corpus.py currently uses BL-rendered prefix chunk_ids (e.g., `rt-0c2e3cb8-`) and BL-truncated one-line summaries. v2 should resolve those to full chunk_ids + verbatim bodies.

**Components:**
1. After extract-corpus.py builds the prefix-based corpus, fan-out a `brain_recall(chunk_id_prefix=X, limit=1)` per row to resolve to full chunk_id.
2. Use the resolved full id to fetch verbatim chunk_full_content (via direct SQLite or `brain_recall` content fetch).
3. Populate `adjacent_chunks` via the same DB lookup.

**Cost estimate**: ≤ 1 sprint. Gated by MCP tool availability — the resolver script needs MCP access to brain_recall (cmux can do this; CLI can't easily).

**Trigger**: when judges report "chunk content seems truncated" or when comparing gold to live BL recall reveals prefix mismatch.

### Phase A — Calibration (W1.1 + W1.3)

**Goal:** Platt-scaled verbalized confidence + per-domain labeled validation set.

**Components:**
1. **Platt scaling**: For each judge, fit `P(correct | confidence)` on a labeled subset. Replace raw `confidence_0_100` in `gold.jsonl` with calibrated probability.
2. **Per-domain calibration set**: Etan labels 300–650 corpus rows across TechGym (100), Freelance (75), Recruiting (75), Architecture (50 cold-start), plus any new domain at ≥50 rows.
3. **Uncertainty-sampling active loop**: Pick rows where the panel is least confident, label those first (10× more informative than random).

**Cost estimate**: 10–22h Etan labeling + 1 sprint eng. Defer until calibration drift surfaces.

### Phase B — Abstention τ (W1.5)

**Goal:** Add abstention threshold so low-confidence consensus rows are surfaced rather than locked.

**Components:**
1. **Normalized ensemble entropy** per row: `H = -Σ p_label × log(p_label)` where `p_label` is the panel's empirical label distribution.
2. **Risk-coverage curve sweep** to find optimal τ. v1.5 candidate: τ = 0.55 (rows with H > 0.55 abstain). Calibrate via labeled holdout from Phase A.
3. **Cascade-then-HITL escalation**: abstained rows → cascade Opus → if still abstain → Etan queue. (Already partly implemented as W3.3's pending-RT routing; Phase B formalizes the abstention metric.)

**Cost estimate**: 1 sprint after Phase A.

### Phase C — Reasoning-tree audit (W1.2 ADOPT-LITE)

**Goal:** Thin tree-audit module for high-disagreement chunks.

**Components:**
1. **Local sentence-transformer** (e.g., `all-MiniLM-L6-v2`): embed every chunk + query; surface near-duplicates and paraphrase candidates for the FM1/FM2 detectors.
2. **Prompted anti-consensus critic**: an Opus pass that argues AGAINST the majority for each near-consensus row, flagging suppressed dissent.
3. **No ACPO LoRA**: the published codebase is a stub. Skip the LoRA fine-tune; the prompted critic is ≥80% as effective at <5% the cost.

**Cost estimate**: 1 sprint after Phase B.

### Phase D — Production-modal hardening (W1.6 applicable subset)

**Goal:** Ongoing process improvements vs one-shot eng.

**Components:**
1. **3× repetition per judge per rubric Q** (Scale SEAL VLU pattern): each judge grades each pair 3× independently; take median. Reduces variance ~30%.
2. **Quarterly human-calibration loop**: Etan re-grades a 50-row sample every quarter; track drift over time.
3. **brain_store every τ recalibration** with rationale.

**Cost estimate**: ongoing process change; no concentrated sprint cost.

---

## What v2 will NOT touch (per W1.7)

These v1.1 design choices are working — don't change them:

- Harness-side `set(jsonl.chunk_id) - set(corpus.chunk_id)` validation for FM12. Works, leave it.
- 3-primary + 1-shadow split for runs that want full reproducibility. Primary convergence stable at 56–66%.
- Live SQLite enrichment for brain_search context. Reproducible, clean.
- /clear-cycle surface reuse. Saves cold-spawn overhead.
- Rubric v1.1 FM1–FM11 definitions. Coverage is adequate; v2 only adds FM tags discovered in production.
- claudeJudge as tiebreaker. Empirical calibration justifies it.

---

## Estimated total v2 buildout (when triggered)

- Phase A: ~2 sprints + Etan labeling.
- Phase B: ~1 sprint.
- Phase C: ~1 sprint.
- Phase D: ongoing.

**Total: ~4 sprints + 10–22h Etan labeling.** Don't start any of it without a flip condition firing.

---

## Provenance

- W1.1 (linear-probe / Platt scaling): `$ORCHESTRATOR_ROOT/docs.local/plans/2026-05-16-agada-v1.2-wave1.1-linear-probe.md`
- W1.2 (AgentAuditor / reasoning tree): `$ORCHESTRATOR_ROOT/docs.local/plans/2026-05-16-agada-v1.2-wave1.2-agentauditor.md`
- W1.3 (per-domain calibration data): `$ORCHESTRATOR_ROOT/docs.local/plans/2026-05-16-agada-v1.2-wave1.3-per-domain.md`
- W1.5 (abstention τ): `$ORCHESTRATOR_ROOT/docs.local/plans/2026-05-16-agada-v1.2-wave1.5-abstention.md`
- W1.6 (production patterns): `$ORCHESTRATOR_ROOT/docs.local/plans/2026-05-16-agada-v1.2-wave1.6-production-patterns.md`
- W1.7 (skeptical premise check — THE motivating doc): `$ORCHESTRATOR_ROOT/docs.local/plans/2026-05-16-agada-v1.2-wave1.7-skeptical.md`
- Wave 2 synthesis: `$ORCHESTRATOR_ROOT/docs.local/plans/2026-05-16-agada-v1.2-wave2-synthesis.md`
