# claudeJudge — Adapter Spawn Brief

> Template the dispatcher (`scripts/dispatch-judges.py`) uses to spawn a Claude Code instance as a judge in a cmux pane. Mirrors the cmux-agents adapter convention.

---

## Launcher

```
claudeJudge -s
```

`claudeJudge` is a zsh function (in `~/.zshrc` snapshots) that spawns `claude` with the right system prompt + model + no MCP. The `-s` flag means "skip onboarding". See `$HOME/Gits/golems/launchers/` for the function definition.

If `claudeJudge` isn't available in the shell, fall back to:

```bash
claude --model claude-opus-4-7 \
       --system "You are claudeJudge, a relevance judge for agada-bench. Read the rubric and corpus from the paths you'll be given, then emit JSONL one row per (query_id, chunk_id) pair to the output path." \
       --no-mcp
```

---

## Spawn brief template (sent via `mcp__cmuxlayer__send_to` after pane boot)

Write the brief to a file on disk first (R20: never inline a 500+ char send; `send_to` caps inline `text` at 1800 chars). The dispatcher does this automatically as `<output_dir>/spawn-briefs/claudeJudge-<run-id>.md`. The brief path is then passed as a Read pointer:

```
Read <output_dir>/spawn-briefs/claudeJudge-<run-id>.md and execute.
```

The brief itself contains:

```markdown
# claudeJudge — agada-bench run <run-id>

You are **claudeJudge**, one of three independent relevance judges in the agada-bench pipeline.

## Read first

1. **Rubric** (read FULLY before judging): `<rubric_path>`
2. **Corpus** (one JSONL row per `(query_id, chunk_id)` to grade): `<corpus_path>`

The rubric is canonical. Do not paraphrase it. Do not soften the anti-pattern rules.

## Task

For every row in `<corpus_path>`, emit one JSONL line to `<output_path>` with:

```json
{"query_id": <int>, "chunk_id": "<string>", "label": <0|1|2|3|"cant-tell">, "reasoning_short": "<≤120 char>", "confidence_0_100": <int>, "judge_agent_name": "claudeJudge", "failure_modes_observed": ["FM<tag>", ...]}
```

## Output target

```
<output_path>
```

(One file. Append-only. Do NOT overwrite mid-run; if you need to retry a row, write a `calibration_note` line at the end pointing to which (qid, chunk_id) was revised.)

## Hard rules (from rubric §6)

1. Read the FULL `content` field of each chunk. Do not grade the `summary`.
2. Don't reward keyword overlap alone (FM2).
3. Don't penalize Hebrew / RTL.
4. Self-referential tool-call echo → 0 + FM11.
5. PreCompact-checkpoint chunks → 0 + FM6 (unless the chunk specifically contains the answer).
6. Do not skip the 4-line reasoning template.
7. Aim for confidence spread 50–95, not all-95s.
8. Calibration pass (rubric §7) is mandatory BEFORE writing the final row.

## After grading

When you have one JSONL row per corpus pair written to `<output_path>`:

1. Re-read your own JSONL (rubric §7 calibration pass).
2. Print a one-line summary: `claudeJudge DONE: <N> rows written to <output_path>, mean conf <X>, FM frequency: <top 3>`.
3. Exit (Ctrl-D or `exit` — leave the pane idle so dispatch-judges can detect completion).

## Hard not-do

- Do NOT call brain_search, brain_recall, or any BrainLayer MCP tool during judging — you'd contaminate the benchmark. Only the corpus.jsonl rows are your input.
- Do NOT edit the rubric or corpus files.
- Do NOT emit rows for `(qid, chunk_id)` pairs not present in `corpus.jsonl` (this would be FM12 — judge-integrity-failure).
```

---

## Detection of completion

`dispatch-judges.py` polls `<output_path>` size + last-modified time every 30s. Completion criteria:

- Output file exists.
- Output file is valid JSONL (parses without exception).
- Output file's row count matches `corpus.jsonl` row count within `--row-tolerance` (default 5%).
- Pane is at the shell prompt (judge exited).

If any check fails after `--judge-timeout` (default 30 min for claudeJudge), the dispatcher marks the judge as `TIMEOUT` and the liveness gate will catch it.

---

## Capability flags

```yaml
adapter: claude
model: claude-opus-4-7
launcher: claudeJudge -s
mcp_required: none           # Judge runs without MCP to avoid bench contamination
input_format: jsonl-pointer  # Brief points to corpus.jsonl + rubric file paths
output_format: jsonl         # One row per (qid, chunk_id)
typical_runtime: 10-15 min for ~60 corpus rows
context_required: ~30k tokens (rubric + corpus + reasoning per row)
tiebreaker_role: yes         # Default tiebreaker per references/judge-panel.md
```

---

## Common failure modes (spawn-side)

| Symptom | Cause | Fix |
|---|---|---|
| Pane at prompt indefinitely after brief sent | Brief send malformed or model unavailable | `read_screen` to check; re-send brief from disk Read pointer. |
| Judge writes 0 rows | Rubric path wrong or corpus path wrong | Verify paths in the brief; absolute paths required. |
| Judge writes rows but all `label: cant-tell` | Brief didn't emphasize anti-cant-tell rule | Add explicit "Use cant-tell sparingly" reminder before re-dispatch. |
| Judge hallucinates chunk_ids (FM12) | claudeJudge has never been observed to do this in v1.1, but flag it loudly if it happens | Treat as judge-integrity-failure; rerun the judge. |

---

## Provenance

- Launcher convention: `$HOME/.golems/skills/golem-powers/cmux-agents/adapters/claude.md`
- Tiebreaker rationale: `references/judge-panel.md` §"Tiebreaker = claudeJudge"
- v1.1 reference behavior: Runs 2/3/4 claudeJudge outputs in `$ORCHESTRATOR_ROOT/docs.local/plans/2026-05-15-agada-bench-4way-judge/phase-1-judgments/claude.jsonl`
