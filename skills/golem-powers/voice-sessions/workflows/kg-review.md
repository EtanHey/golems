---
name: kg-review
description: Voice-driven flag-batch review — agent reads entity clusters aloud, user answers free-form, decisions recorded to the shared decisions file, generalization rules bulk-apply after enough samples
---

# KG Flag-Batch Review by Voice

> The agent walks the user through candidate-duplicate entity clusters by voice.
> Free-form answers → structured decisions → generalization → bulk-apply.
> Engine-agnostic: the voice I/O is whatever the session has (`voice_ask`/`voice_speak`
> MCP today; WS bridge later). The decisions file is shared with the visual dashboard.

## Inputs

- **Flag batch:** `$HOME/Gits/brainlayer/eval_results/kg-phase1-flag-batch-*.json` (category-sorted clusters)
- **Decisions file:** `$HOME/Gits/brainlayer/eval_results/kg-phase1-decisions-*.json` (shared with dashboard — check `collab/2026-06-05-kg-cleanup.md` for the current contract)
- **Driver:** `python3 scripts/kg_review_session.py` in the brainlayer repo (`next` / `record` / `rule` / `stats`)

## Session Protocol

### 0. Setup
1. Pick the category (ask the user, or smallest-first: `stats` shows progress). One category per session beats sampling across all.
2. `voice_speak` a 1-sentence session intro: category, cluster count, how to answer ("merge, keep separate, mixed, or skip — free-form is fine").

### 1. Per-cluster loop
1. `next --category C` → get cluster + `speak` text.
2. `voice_ask` the speak text. Use `silence_mode: standard`. Keep questions SHORT — read at most 6 member variants aloud; for bigger clusters summarize ("8 entries, 3 name variants, types: person, tool, concept").
3. Interpret the free-form answer into a decision. YOU are the interpreter — map natural phrasing to the schema:
   - "all the same" / "merge them" → `merge_all` (canonical = most chunks unless the user names one)
   - "different things" / "keep them" → `keep_all`
   - "all the same except X" / "X is different" → `mixed` with per-member map
   - "junk" / "delete them" → `mixed` with all-`prune`
   - "skip" / "not sure" / "later" → `skip`
4. Confirm ONLY when uncertain (don't echo every decision — it doubles the loop time). Batch-confirm every ~5: "So far: three merges, one keep, one skip. Continuing."
5. `record --cluster-id ID --decision-json '{...}'` — ALWAYS include `note` with the user's verbatim reasoning and `source: "voice"`.

### 2. Generalization (the payoff)
After ~10 decisions in a category, look for the pattern the user is applying:
1. State it: "Based on what you've said, all N remaining case-only clusters look like merges, most-chunks wins. Apply to all 170 remaining? I can read exceptions first."
2. On confirmation → `rule --rule-json '{"match": {"category": "..."}, "action": "merge_all", "canonical": "most_chunks", "note": "...", "source": "voice"}'`.
3. Rules NEVER overwrite manual decisions (driver enforces). Speak the applied count back.
4. If the user hesitates → offer a sample: read 3 random remaining clusters; if all match the rule, re-offer.

### 3. Wrap
1. `stats` → speak progress per category.
2. Write a session summary to the collab + `brain_store` the milestone.
3. The decisions file is the artifact — the applier (brainlayer-side) consumes it after Etan's final GO.

## Latency discipline

- The response gap is real (~5s on the current stack). NEVER add to it with long confirmations.
- `next` is stateless and idempotent — it returns the same cluster until a decision for it is recorded, so calling it twice cannot skip anything. To pre-compose cluster N+1's question while the user hears N, peek at the batch order locally (the flag-batch JSON is category-ordered); do NOT expect `next` to return N+1 before N is decided.
- Hebrew-English answers are normal — the personalization aliases handle dev terms; don't ask the user to repeat unless the transcript is genuinely uninterpretable.

## Failure handling

- `voice_ask` timeout → speak "still there?" once, then pause the session with `stats` saved. Never lose recorded decisions (each `record` is durable).
- Uninterpretable transcript → record `skip` with the raw transcript as `note`, move on. Don't burn the user's patience re-asking.
- If TTS errors (`edge-tts failed`) → check `/Applications/VoiceBar.app/Contents/Resources/scripts/edge-tts-words.py` exists (build-bundle bug class).
