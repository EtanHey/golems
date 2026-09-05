# Workflow: pending-RT routing (W3.3 decision tree)

> What to do with `(query_id, chunk_id)` pairs that don't lock cleanly in build-gold.py. Replaces ad-hoc red-team ad-libbing with a deterministic decision tree.

---

## What pending-RT means

Pending-RT (red-team) is the bucket build-gold.py assigns to any pair that:

- has `spread ≥ 2` across numeric labels, AND
- has no clear majority, AND
- has no tiebreaker fallback that's both present and validly numeric.

In v1.1's 4 runs, 14 pending-RT rows accumulated total (1 + 3 + 9 + 1 across Runs 1–4). Manually adjudicating each cost ~30 min × 14 = 7 h of Etan time.

W3.3's resolution: a decision tree that auto-routes most pending-RT rows and escalates only the genuinely ambiguous to Etan.

---

## The decision tree

```
For each pending-RT row (qid, chunk_id) with labels {j1: L1, j2: L2, j3: L3}:

  Compute: distinct_labels = sorted(set(L1, L2, L3))
           spread = max(distinct_labels) - min(distinct_labels)
           outlier_judge = the judge whose label differs from the other 2 (if exists)
           fm_union = union of failure_modes_observed across the 3 judges

  CASE 1 — single-judge outlier with high-confidence majority
    if len(distinct_labels) == 2 AND outlier_judge is unambiguous
       AND fm_union contains FM6 (PreCompact pollution)
       AND the 2 majority judges' confidence ≥ 80
    THEN route = cascade-opus
         (Opus-4-7 reads the chunk + rubric + 3 judge reasonings + outputs a label;
          empirically resolves 12 of 13 v1.1 cases.)

  CASE 2 — fully-distinct labels with spread 3
    if len(distinct_labels) == 3 AND spread == 3
    THEN route = discard-fm14
         (The corpus pair is too ambiguous to gold-lock. Tag FM14, drop from gold.jsonl.
          Logged in adjudication-log.md for future rubric iteration.)

  CASE 3 — genuine 3-way disagreement
    if len(distinct_labels) == 3 AND spread == 2
       OR (len(distinct_labels) == 2 AND outlier_judge ambiguous)
    THEN route = etan-adjudicate
         (Add to ETAN_QUEUE.md with the chunk + 3 reasonings + rubric anchor.
          Etan adjudicates manually; typically resolves in batches.)

  DEFAULT — anything not matching above
    route = etan-adjudicate
    (Conservative: when in doubt, escalate.)
```

---

## The router

```bash
python scripts/route-pending-rt.py \
  --gold <output>/phase-3-gold/gold.jsonl \
  --consensus <output>/phase-2-crossref/consensus-draft.jsonl \
  --cascade opus-4-7 \
  --out <output>/phase-3-gold/pending-rt-routing.md
```

Outputs:

1. `pending-rt-routing.md` — per-row routing decision with rationale citation.
2. `ETAN_QUEUE.md` (if any `etan-adjudicate` rows) — Etan's manual queue.
3. Updates `gold.jsonl` in place for `cascade-opus` and `discard-fm14` routes.

---

## Cascade-opus mechanics

Single cheap Opus-4-7 call per pending-RT row:

```
SYSTEM: You are an adjudicator for the agada-bench rubric v1.1.
        Read the rubric + chunk + 3 prior judge reasonings + verdicts.
        Output a single numeric label (0|1|2|3) with one-line rationale.

USER:   RUBRIC: <verbatim content of references/grading-rubric.md>
        CHUNK: <chunk_id, full body, adjacent context from corpus.jsonl>
        QUERY: <query string + tag>
        PRIOR JUDGE 1 (claudeJudge): label=0, reasoning="..."
        PRIOR JUDGE 2 (codexJudge):  label=2, reasoning="..."
        PRIOR JUDGE 3 (geminiJudge): label=0, reasoning="..."
        ...
```

Opus-4-7's label replaces the consensus label; `resolution_method` becomes `cascade-opus-resolved`; `notes` records the cascade rationale verbatim.

Cost per call: ≤ $0.10 with prompt caching on the rubric. 14 pending-RT rows from v1.1 ≈ $1.40 total. Compare to 7h of Etan time.

---

## Override conditions

Override the default `cascade opus-4-7` only when:

- **`etan-adjudicate`-only mode** (`--cascade etan-adjudicate`): use when running an audit of a domain Etan is personally calibrating (e.g., the first run of a new domain). Forces every pending-RT row into ETAN_QUEUE.md.
- **`discard-fm14`-only mode** (`--cascade discard-fm14`): use when running a quick smoke test where pending-RT rows aren't worth resolving. Drops all pending-RT rows from gold with FM14 tag. Reduces gold row count proportionally.

Anything else (custom cascade model, conditional routing) is a v2 feature — not in v1.

---

## ETAN_QUEUE.md format

```markdown
# Etan Adjudication Queue — <run dir>

Generated: <timestamp>
Source: scripts/route-pending-rt.py from <run dir>

## Row 1: (qid=7, chunk_id=rt-abc...)

**Query**: "<full query text>"  (tag: <tag>)

**Chunk body** (verbatim from corpus.jsonl):
> <chunk content here, 500 char max — full body in corpus.jsonl>

**Adjacent context** (if any):
> <chunk_before, chunk_after if present>

**Judge verdicts**:
- claudeJudge: label=0, conf=85 — "<reasoning>"
- codexJudge:  label=2, conf=75 — "<reasoning>"
- geminiJudge: label=3, conf=60 — "<reasoning>"

**FM tags observed (union)**: FM6, FM8

**Routing rationale**: 3-way distinct (0, 2, 3), spread=3 but case CASE 2 doesn't apply because FM tags suggest semantic mismatch, not pure ambiguity. Escalating.

**Your verdict**: __

---

## Row 2: ...
```

Etan fills in `**Your verdict**: <label>` for each row. A separate script ingests the filled queue and writes back to `gold.jsonl`:

```bash
python scripts/ingest-etan-verdicts.py \
  --queue <output>/phase-3-gold/ETAN_QUEUE.md \
  --gold <output>/phase-3-gold/gold.jsonl
```

(Implemented as part of v1; small wrapper around `gold.jsonl` row updates.)

---

## Discard-FM14 mechanics

Rows routed to `discard-fm14`:
- Are NOT written to `gold.jsonl`.
- Are logged in `adjudication-log.md` under "Discarded — FM14":

```markdown
## Discarded pairs (FM14 — fully-distinct judge labels with spread 3)

| qid | chunk_id (short) | labels (claude/codex/gemini) | rationale |
|---:|---|:---:|---|
| 12 | rt-ab1...c2d | 0/2/3 | spread=3, distinct labels, no clear FM6 outlier — corpus pair too ambiguous |
```

- Are surfaced in STATUS.md as `discard_fm14: N` so the eventual rubric iteration can examine the pattern (typical signal: this domain needs a domain-specific FM tag or better adjacent-context coverage).

---

## v1.1 empirical baseline

From W3.3's analysis of Runs 1–4:

| Run | Domain | Pending-RT count | Routed |
|---|---|---:|---|
| 1 | TechGym | 1 | cascade-opus (1) |
| 2 | Freelance | 3 | cascade-opus (3) |
| 3 | Recruiting | 9 | cascade-opus (8), etan (1) |
| 4 | Architecture | 1 | discard-fm14 (1) |

So 12 cascade-opus, 1 etan, 1 discard. Expect similar proportions on new domains; if pending-RT density > 20% of corpus rows, the rubric mismatch with the domain is the real issue (run `workflows/add-domain.md`).

---

## Composability

This workflow is referenced by:
- `workflows/full-sweep.md` (Phase 3.5)
- `scripts/run-agada.sh` (after build-gold.py)

It can be invoked standalone to re-route an existing pending-RT set after rubric edits.

---

## Provenance

- W3.3 design: `$ORCHESTRATOR_ROOT/docs.local/plans/2026-05-16-agada-v1.2-wave3-pending-rt.md`
- W1.5 (abstention τ rationale): `$ORCHESTRATOR_ROOT/docs.local/plans/2026-05-16-agada-v1.2-wave1.5-abstention.md`
- Original Run 1 red-team example: `$ORCHESTRATOR_ROOT/docs.local/plans/2026-05-15-agada-bench-4way-judge/phase-3-gold/adjudication-log.md`
