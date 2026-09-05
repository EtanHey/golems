# POS-2 — RRF correct disposition (engineering, not research)

> Canonical stop message when CHECK-FIRST finds prior RRF work. gen-10 dashboard: RRF removed — already researched + designed.

## Disposition

**STOP — ALREADY RESEARCHED.** RRF ranking / hybrid fusion is **not** a new deep-research topic. Prior work is complete; next step is **engineering**, not another research pass.

## Prior research (verified on disk, 2026-05-29)

1. `orchestrator/docs.local/research/2026-05-26-cormack-vs-brainlayer-corpus.md`
2. `brainlayer/docs.local/research/2026-05-26-research-lead/A8-per-agent-ranking-and-syllabi.md`
3. `brainlayer/docs.local/research/2026-05-26-rrf-domain-stage1.md`
4. `skill-creator/docs.local/handoffs/2026-05-17/web-weave/rrf-k-tuning.md`
5. `brainlayer/docs.local/plans/2026-05-15-bl-overhaul/phase-3-hybrid-search-rrf`
6. `coach/docs.local/decisions/2026-05-26-cormack-rrf-deep-research.md`

## Decision (BUILD-ON — do not re-research)

- **Stance:** BUILD-ON existing design — keep RRF + add per-persona semantic↔lexical weighting layer on top (coach/orchestrator/workers differ in lexical vs semantic balance).
- **Drive grounding:** `Brain Drive/03_RESEARCH/` retrieval/ranking corpus already indexed; no new Drive sweep required.
- **Current usage:** `~/Gits/brainlayer/src/brainlayer/search/` hybrid path uses RRF today via `brain_search`; implementation lives in BrainLayer search stack — tune in repo, prove with `agada-bench` / labeled probes, not a greenfield research prompt. Example prior tuning doc: `skill-creator/docs.local/handoffs/2026-05-17/web-weave/rrf-k-tuning.md`.
- **Next action:** Execute plan phase `brainlayer-actually-works/phase-3-brain_search-relevance` and related engineering tickets. Run `check-first.sh RRF` before any future ranking proposal.

## Output to user

```text
ALREADY RESEARCHED → (6 paths above)
STOP: this is engineering / plan execution, not new deep research.
```
