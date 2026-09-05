# Relevance Grading Rubric — agada-bench / BrainLayer Recall Test

> Shared rubric for the **3-judge default ensemble** (claudeJudge, codexJudge, geminiJudge) — and the 4-way `+cursorJudge` panel for reproducibility checks.
> Goal: measure model bias, not prompt-interpretation bias. Every judge reads this exact file.
> Version: **v1.1** · canonical · sourced verbatim from `2026-05-15-agada-bench-4way-judge/phase-0a-rubric/grading-rubric.md`.
> Used by: `/agada-bench` (this skill) — all phase-1 judges read this file via `adapters/<judge>.md`.
> Note: section 8's FM table is augmented in `references/failure-modes.md` with FM12 (judge-integrity-failure), FM13 (judge-liveness-failure), and FM14 (fully-distinct-spread-3). Read both.

---

## 1. Role

You are a **relevance judge for BrainLayer recall results**. For each `(query, chunk)` pair you receive, decide whether reading that chunk would help a downstream agent (or the benchmark operator) answer the original query. You read the FULL chunk body — not the summary, not the auto-generated description, not the tags. Your output is a single grade on the scale below plus a 4-line reasoning trace. Be conservative: BrainLayer over-retrieves and judges who reward generously will mask the real recall problem.

---

## 2. Rating Scale

| Grade | Meaning | When |
|---|---|---|
| **0 IRRELEVANT** | Chunk does not address the query at all. Wrong domain, wrong topic, pure noise, or a self-referential brain_search invocation log (FM11). | Reader would gain nothing from this chunk. |
| **1 MARGINAL** | Chunk touches the query's topic but is the wrong granularity or wrong slice. Tool-call log when the user wants semantic content; metadata stub when the user wants the underlying message. | Reader could maybe extract a hint but it isn't usable as-is. |
| **2 RELEVANT** | Chunk directly addresses part of the query and would be useful in a synthesis. May not be complete on its own. | Reader would cite this chunk in an answer. |
| **3 HIGHLY RELEVANT** | Chunk is the literal answer, or contains the literal answer verbatim. | A single-chunk reply works. |
| **🤷 CAN'T TELL** | Chunk has so little context that even with the full body + adjacent chunks the judge cannot decide. **This is a meta-finding**: the chunk needs better metadata (`source_file`, `conversation_id`, `position`, `summary`). Log it — don't guess. | Use sparingly; if you'd lean toward 0 or 1, use 0 or 1. |

---

## 3. Reasoning Template (mandatory per grade)

Every grade must be accompanied by these four lines:

1. **What the query is actually asking for**: \<one sentence of literal intent\>
2. **What this chunk actually contains**: \<one sentence summarising the FULL content, not the summary field\>
3. **Bridge**: would reading this chunk help answer the query? \<yes / partial / no, and why\>
4. **Verdict**: `<0|1|2|3|cant-tell>` because \<one specific reason — cite a failure mode tag if applicable\>

Then a **confidence 0–100** that is calibrated. Not all 100s. If you flipped between two grades while reasoning, the right confidence is 50–70, not 95.

---

## 4. Output Format — JSONL (one line per `(query, chunk)` pair)

```json
{"query_id": 1, "chunk_id": "rt-0c2e3cb8-...", "label": 0, "reasoning_short": "self-referential brain_search log; doesn't answer query (FM11)", "confidence_0_100": 90, "judge_agent_name": "claudeJudge", "failure_modes_observed": ["FM11"]}
```

Fields:
- `query_id` (int) · `chunk_id` (string, full ID) · `label` (one of `0|1|2|3|"cant-tell"`)
- `reasoning_short` ≤ 120 chars · `confidence_0_100` (int) · `judge_agent_name` (e.g. `claudeJudge`, `codexJudge`, `cursorJudge`, `geminiJudge`)
- `failure_modes_observed` (array of FM tags from §8, can be empty)

---

## 5. Few-Shot Examples — covering Agent A's failure modes

### Example A — FM11 (self-referential query echo) → grade 0
- **Query**: `coach handoff pending items` (tag=coach)
- **Chunk** (`rt-0c2e3cb8-…`): *"The user is initiating a search for pending items related to a 'coach handoff' and has tagged the search with 'coach'."*
- **Verdict**: `0` because the chunk is a paraphrase of the query itself, not an answer to it. The auto-summarizer ate the original message and replaced it with a description of the tool call. Confidence 95.

### Example B — FM1 (duplicate stubs inflating recall) → grade 3, but flag the duplication
- **Query**: `Example Academy lecture deck STRUCTURE NotebookLM mining slides`
- **Chunks**: `brainbar-43b…`, `brainbar-1c9…`, `brainbar-ac4…`, `brainbar-657…` — four chunk IDs, **identical content** ("Example Academy lecture deck STRUCTURE … 13 slides, 45 min talk …").
- **Verdict**: each gets `3` (it IS the literal answer) but `failure_modes_observed: ["FM1"]` on each, because recall@4 looks great while only one distinct chunk exists. Confidence 90.

### Example C — FM6 (PreCompact pollution) → grade 0
- **Query**: `example workshop two sentence hook opener intro notebook`
- **Chunk** (`brainbar-5b6…`): a PreCompact Checkpoint for session `feb75b2b…` dated 2026-04-21. Content is session-restore boilerplate with no hook opener text.
- **Verdict**: `0` because PreCompact checkpoints are session-restoration metadata, not lecture content. They surface because their content overlaps with everything ever discussed in that session. Confidence 92. `["FM6"]`.

### Example D — FM8 (importance=0 outranking importance=7) → grade 1
- **Query**: `Example Academy workshop title abstract reviewer`
- **Top hit** (`rt-b3cdba46-…`, score 49.69, **importance 0**): a skillCreator handoff briefing tagged `correction:factual,auto-detected` — mentions the lecture but is not the title/abstract.
- **Verdict**: `1` — touches the right topic but wrong granularity (briefing about prep, not the title/abstract itself). Note that `imp:0` chunk outranked `imp:7` `rt-90b5298a` ("Lecture preparation for Example Academy cohort…") which is closer. Confidence 75. `["FM8"]`.

### Example E — FM2 (paraphrase miss) → record under `missing_expected`, not per-hit
- **Query**: `laptop liquid spill lost local index no backup recovery` → **zero results**.
- The DB does contain the fictional laptop-spill scenario (rephrased), e.g. `rt-b3cdba46-…` mentions "laptop damaged / liquid spill / repair center" in the context of a Example Academy workshop briefing. BL's dense embedder did not bridge the paraphrase.
- **Verdict**: no per-hit grades. Record in `missing_expected`: *"chunk rt-b3cdba46-… mentions the fictional laptop-spill incident — should have surfaced via paraphrase / synonym bridging"*. Tag `["FM2"]` on the query-level row.

### Example F — clean grade 3 (positive control)
- **Query**: `10 architectural concepts workshop stage-ready answers practice`
- **Chunk** (`rt-548771d3-…`): *"A fictional presenter is preparing for an Example Academy workshop on retrieval systems, requiring practice on 10 architectural concepts and stage-ready answers…"*
- **Verdict**: `3` — literal answer in the first sentence. Confidence 95. No FM tags.

### Example G — 🤷 can't tell (meta-finding)
- **Query**: `sample-app collaborator repository-specific rules context`
- **Result**: BL returned only an **entity card** for `sample-app` (connections to fictional collaborators) and zero chunks.
- **Verdict**: `cant-tell` for the entity card because an entity card isn't a chunk and the query is about *rules* not *people*. Tag `["FM-entity-leak"]`. Confidence 85. Record under `missing_expected`: *"per-repo rules for sample-app/collaborator — should live as bricks tagged `project-rules`, currently missing"*.

---

## 6. Anti-Pattern Warnings — do NOT

1. **Do not grade the `summary` field.** Read the FULL `content`. Summaries are auto-generated and frequently misrepresent the chunk (this is one of the things we're measuring).
2. **Do not reward keyword overlap alone.** FM2: a bag-of-nouns match is not a semantic match. If the chunk has the query terms but discusses a different scenario, grade 0 or 1.
3. **Do not penalize Hebrew or RTL content.** A Hebrew chunk answering a Hebrew query is `3`, not `1`. Mixed He+En is normal in this corpus.
4. **Do not reward chunks that are tool-call self-references** (FM11). A chunk that paraphrases the query itself is noise, not signal — `0`.
5. **Do not reward PreCompact-checkpoint chunks** (FM6) unless the checkpoint specifically contains the answer. Generic session-restore boilerplate is `0`.
6. **Do not promote `imp:0` chunks** above genuinely relevant `imp:5+` chunks just because score is higher (FM8). Score reflects vector similarity, not human relevance.
7. **Do not collapse duplicates silently** (FM1). Grade each duplicate honestly; let the per-query aggregator flag the duplication.
8. **Do not skip the reasoning template.** A bare grade with no reasoning is unverifiable and gets discarded in cross-judge red-teaming.

---

## 7. Calibration Pass (mandatory before final JSONL)

After grading all chunks, **re-read your own JSONL** and answer:

1. Did I grade chunk X at `2` but a near-identical chunk Y at `0`? Pick one and resolve.
2. Are my `3`s actually literal answers, or did I drift into "useful for context"? Demote drift to `2`.
3. Are my confidences calibrated? If every line is 95+, recalibrate — you cannot be that sure. Aim for a spread between 50 and 95 with no single value dominating.
4. Did I tag failure modes consistently? Same anti-pattern should always carry the same FM tag.
5. Did I escalate too eagerly to `cant-tell`? If full content + adjacent chunks gave me anything, downgrade to `0` or `1`.

Append a 1-line `calibration_note` per JSONL row if you changed anything during this pass.

---

## 8. Failure Mode Glossary (FM tags — from Agent A's audit)

| Tag | Name | Definition |
|---|---|---|
| FM1 | Duplicate stubs | Multiple chunk_ids with identical or near-identical content; inflate recall@k. |
| FM2 | Paraphrase miss | Dense embedder fails to bridge synonyms / different phrasing (liquid spill ↔ damaged laptop). |
| FM6 | PreCompact pollution | Session-restore checkpoints surface for any query in that session's vocabulary. |
| FM8 | Importance inversion | `imp:0` chunks outrank `imp:5+` chunks on vector score alone. |
| FM11 | Self-referential query echo | Chunk content is a paraphrase of the query (auto-summarizer ate the message). |
| FM-entity-leak | Entity card returned where chunk expected | KG entity surfaces instead of a content chunk. |

(Add new FM tags inline as the judges find them; orc collates the union into v2.)

---

*End of rubric. Single source of truth — do not paraphrase per agent. If something here is ambiguous, raise it in the cross-judge red-team round, don't quietly reinterpret.*
