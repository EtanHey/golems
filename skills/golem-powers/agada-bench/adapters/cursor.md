# cursorJudge — Adapter Spawn Brief

> **Dropped from the default panel** per W3.2: κ(claude, cursor) = 0.811 is the highest pair in the matrix (most redundant). Use this adapter only for v1.1 reproducibility checks against Runs 1–4.

---

## When to use cursorJudge

- **Reproducing a v1.1 Run 1–4 result**: those runs used the 4-way panel; reproducing the historical gold requires cursorJudge.
- **κ matrix recomputation on the 4-way set**: if you want to verify W3.2's measurement, re-run with all 4 judges.
- **Investigating cursor-claude redundancy**: a fresh κ measurement may show drift; cursor stays in for that audit.

## When NOT to use cursorJudge

- **Default `/agada-bench` runs**: the 3-judge panel (claude/codex/gemini) is canonical. Don't add cursor.
- **New-domain runs**: see `workflows/add-domain.md`; new domains start with the default 3-judge panel only.

---

## Launcher

```
cursorJudge -s
```

If not in shell:

```bash
cursor-agent --model auto \
             --system "You are cursorJudge, a relevance judge for agada-bench. Read rubric and corpus from paths given; emit JSONL to output path."
```

---

## Spawn brief template (sent via `mcp__cmuxlayer__send_to` after pane boot)

Written to disk at `<output_dir>/spawn-briefs/cursorJudge-<run-id>.md`. Dispatcher sends:

```
Read <output_dir>/spawn-briefs/cursorJudge-<run-id>.md and execute.
```

Brief contents:

```markdown
# cursorJudge — agada-bench run <run-id>

You are **cursorJudge**, included in this run as an optional 4th judge (default panel is 3; you're here for reproducibility check or κ audit).

## Read first

1. **Rubric** (read FULLY before judging): `<rubric_path>`
2. **Corpus** (one JSONL row per `(query_id, chunk_id)` to grade): `<corpus_path>`

The rubric is canonical. Do not paraphrase or soften the anti-pattern rules.

## Task

For every row in `<corpus_path>`, emit one JSONL line to `<output_path>` with:

```json
{"query_id": <int>, "chunk_id": "<string>", "label": <0|1|2|3|"cant-tell">, "reasoning_short": "<≤120 char>", "confidence_0_100": <int>, "judge_agent_name": "cursorJudge", "failure_modes_observed": ["FM<tag>", ...]}
```

## Output target

```
<output_path>
```

## Hard rules (from rubric §6)

1. Read the FULL `content` field of each chunk. Do not grade the `summary`.
2. Don't reward keyword overlap alone (FM2).
3. Don't penalize Hebrew / RTL content.
4. Self-referential tool-call echo → 0 + FM11.
5. PreCompact-checkpoint chunks → 0 + FM6.
6. Do not skip the 4-line reasoning template.
7. **Calibration**: cursor's v1.1 mean confidence was 81 (lowest of the 4 — best raw calibration). Maintain or improve. Don't drift toward all-95s.
8. Calibration pass (rubric §7) mandatory before final write.

## After grading

1. Re-read your own JSONL (rubric §7 calibration pass).
2. Print: `cursorJudge DONE: <N> rows written to <output_path>, mean conf <X>`.
3. Exit.

## Hard not-do

- Do NOT call brain_search or any MCP tool.
- Do NOT edit the rubric or corpus files.
- Do NOT emit rows for pairs not in `corpus.jsonl` (FM12).
```

---

## Detection of completion

Same as other judges. `--judge-timeout`: 30 min for cursorJudge.

---

## Capability flags

```yaml
adapter: cursor
model: cursor-agent-auto      # routes to whichever model cursor-agent picks; in v1.1 this was a frontier model
launcher: cursorJudge -s
mcp_required: none
input_format: jsonl-pointer
output_format: jsonl
typical_runtime: 8-12 min for ~60 corpus rows
context_required: ~30k tokens
tiebreaker_role: no
independence_rank: #4         # Most redundant per W3.2; dropped from default panel
in_default_panel: false       # Only included on --judges claude,codex,gemini,cursor
historical_calibration: best (mean 81, lowest of v1.1 panel)
```

---

## Common failure modes (spawn-side)

| Symptom | Cause | Fix |
|---|---|---|
| Pane never finishes booting | Cursor CLI auth / SSO redirect needed | Resolve in a separate pane; then restart cursorJudge. |
| Judge writes rows but mean confidence > 90 | Cursor's default calibration drifted | Re-emphasize rubric §7 in the brief and re-run. |
| Cursor's labels match claude exactly | Confirms W3.2's κ = 0.811 finding | Expected behavior; the panel default drops cursor for this reason. |
| FM12 hallucinations | Has been 0 in Runs 2/3/4 | Flag loudly if it happens; rerun. |

---

## Why cursor is dropped by default (recap from references/judge-panel.md)

- κ(claude, cursor) = 0.811 — highest single pair in the W3.2 matrix.
- Mean κ = 0.68 — highest single-judge value (most redundant).
- Dropping cursor cuts panel cost ~25% with ~5% information loss.
- Odd N = 3 breaks ties without needing tiebreaker logic to step in as often.

Keep cursor's calibration story in mind: it does have the best raw confidence calibration (mean 81 vs claudeJudge's 86.6). If claudeJudge starts over-confident, cursor is the obvious swap. But for a balanced disjoint-family panel, claude+codex+gemini is the right shape.

---

## Provenance

- Launcher convention: `$HOME/.golems/skills/golem-powers/cmux-agents/adapters/cursor.md`
- W3.2 drop-judge rationale: `references/judge-panel.md` §"W3.2's κ matrix"
- v1.1 reference behavior: Runs 1–4 cursor outputs in `$ORCHESTRATOR_ROOT/docs.local/plans/2026-05-15-agada-bench-4way-judge/phase-1-judgments/cursor.jsonl`
