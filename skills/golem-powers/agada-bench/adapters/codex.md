# codexJudge — Adapter Spawn Brief

> Most independent voter (per W3.2 κ matrix: mean κ = 0.48). Uniquely catches FM11 × 17 and FM8 × 3 across Runs 2/3/4.

---

## Launcher

```
codexJudge -s
```

`codexJudge` is a zsh function spawning the Codex CLI with the agada-bench system prompt. `-s` skips onboarding. If unavailable in shell:

```bash
codex --model gpt-5-codex \
      --system "You are codexJudge, a relevance judge for agada-bench. Independent voter; do not bias toward the other judges' consensus. Read rubric and corpus from paths given; emit JSONL to output path."
```

---

## Spawn brief template (sent via `mcp__cmuxlayer__send_to` after pane boot)

Written to disk at `<output_dir>/spawn-briefs/codexJudge-<run-id>.md` and dispatcher sends:

```
Read <output_dir>/spawn-briefs/codexJudge-<run-id>.md and execute.
```

Brief contents:

```markdown
# codexJudge — agada-bench run <run-id>

You are **codexJudge**, the independent-voter judge in the agada-bench 3-judge panel.

## Your role (per W3.2)

You are the panel's most independent voter. Mean κ = 0.48 across Runs 2/3/4.
- You uniquely catch FM11 (self-referential query echo) × 17.
- You uniquely catch FM8 (importance inversion) × 3.

**Don't soften your reads to match the other judges.** Disagreement on edge cases is your value-add.

## Read first

1. **Rubric** (read FULLY before judging): `<rubric_path>`
2. **Corpus** (one JSONL row per `(query_id, chunk_id)` to grade): `<corpus_path>`

The rubric is canonical. Do not paraphrase or soften.

## Task

For every row in `<corpus_path>`, emit one JSONL line to `<output_path>` with:

```json
{"query_id": <int>, "chunk_id": "<string>", "label": <0|1|2|3|"cant-tell">, "reasoning_short": "<≤120 char>", "confidence_0_100": <int>, "judge_agent_name": "codexJudge", "failure_modes_observed": ["FM<tag>", ...]}
```

## Output target

```
<output_path>
```

(One file. Append-only. Do NOT overwrite mid-run.)

## Hard rules (from rubric §6 + your independence mandate)

1. Read the FULL `content` field of each chunk. Do not grade the `summary`.
2. Don't reward keyword overlap alone (FM2).
3. Don't penalize Hebrew / RTL.
4. **Especially flag FM11** (self-referential tool-call echo → 0 + FM11). This is your unique-catch failure mode.
5. **Especially flag FM8** (importance inversion: `imp:0` chunk outranking `imp:5+`). This is also your unique catch.
6. PreCompact-checkpoint chunks → 0 + FM6 (unless the chunk specifically contains the answer).
7. Do not skip the 4-line reasoning template.
8. **Calibration**: aim for confidence spread 50–95, not all-95s. Codex's historical mean confidence is ~78 — match or be lower.

## After grading

1. Re-read your own JSONL (rubric §7 calibration pass).
2. Print: `codexJudge DONE: <N> rows written to <output_path>, FM11=<n>, FM8=<n>, mean conf <X>`.
3. Exit.

## Hard not-do

- Do NOT call brain_search or any BrainLayer MCP tool — you'd contaminate the bench.
- Do NOT edit the rubric or corpus files.
- Do NOT emit rows for pairs not in `corpus.jsonl` (FM12).
- **Do NOT match the other judges' labels reflexively.** Your independence is the panel's signal.
```

---

## Detection of completion

Same as claudeJudge: `dispatch-judges.py` polls output file size + last-modified + row count match against corpus.

`--judge-timeout`: 35 min for codexJudge (Codex CLI has slightly slower per-row latency than Claude Code).

---

## Capability flags

```yaml
adapter: codex
model: gpt-5-codex
launcher: codexJudge -s
mcp_required: none
input_format: jsonl-pointer
output_format: jsonl
typical_runtime: 12-18 min for ~60 corpus rows
context_required: ~30k tokens
tiebreaker_role: no              # claudeJudge breaks ties; codex is the independent voter
independence_rank: #1            # Most independent per W3.2
unique_catches:
  - FM11 (self-referential query echo) × 17 in v1.1
  - FM8 (importance inversion) × 3 in v1.1
```

---

## Common failure modes (spawn-side)

| Symptom | Cause | Fix |
|---|---|---|
| Codex CLI auth prompt at boot | `~/.codex/auth.json` missing or expired | Run `codex auth login` in a separate pane; restart codexJudge. |
| Judge writes rows with all label=0 | Brief didn't emphasize codex's role as independent voter | Codex tends to be conservative; verify it's actually reading chunk bodies, not just summaries. |
| Slower per-row than claudeJudge | Codex API latency naturally higher | Acceptable. Set `--judge-timeout 35` (default for this adapter). |
| FM12 hallucinations | Has never been observed in v1.1; flag loudly if it happens | Treat as judge-integrity-failure; rerun. |

---

## Why codex is the keep-keep judge per W3.2

- Pair κ(codex, claude) = 0.62; κ(codex, gemini) = 0.38 — both below average pair κ.
- Codex disagrees with the other two on edge cases that the consensus would otherwise quietly accept.
- Its FM11 / FM8 unique catches surface real failure modes the panel would miss without it.

Don't drop codex unless its mean κ jumps > 0.65 sustained across 2+ runs.

---

## Provenance

- Launcher convention: `$HOME/.golems/skills/golem-powers/cmux-agents/adapters/codex.md`
- W3.2 measurement: `references/judge-panel.md` §"W3.2's κ matrix"
- v1.1 reference behavior: Runs 2/3/4 codex outputs in `$ORCHESTRATOR_ROOT/docs.local/plans/2026-05-15-agada-bench-4way-judge/phase-1-judgments/codex.jsonl`
