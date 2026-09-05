# Head-to-Head: Cursor /multitask vs Workflow-tool / headless fan-out

> Evidence backing the cursor-multitask skill. Captured 2026-06-05, Cursor 3.3.2 (arm64, build 2026.06.03).

## Q1: Is `/multitask` invocable headlessly via the `cursor-agent` / `cursor` CLI?

**No. It is an in-editor (Agents Window) GUI slash command only.** Proven three ways:

1. **Absent from CLI help.** `cursor-agent --help | grep -iE 'multitask|parallel|subagent'` → **zero matches**. The CLI exposes `-p/--print`, `--output-format`, `--mode plan|ask`, `--resume`, `--continue`, `--model`, `--force/--yolo`, `--sandbox`, `--approve-mcps` — no parallelism/multitask surface.
2. **Passed through as a plain prompt in print mode — no subagents.** Re-verified 2026-06-05 on cursor-agent **2026.06.04-5fd875e** (newer than the 2026.06.03 build of the first probe): `cursor-agent -p --force "/multitask Say ALPHA ||| Say BETA"` returns `ALPHA / BETA / "Both tasks ran in parallel"` — but the transcript JSONL (`~/.cursor/projects/<enc>/agent-transcripts/<id>/`) shows **3 events in ONE thread, zero subagents**, and the stream-json event log shows a **single session_id with no spawn/subagent event types**. The slash command is not recognized; the text degrades to a single agent answering all parts inline while *claiming* parallelism. ⚠️ Correction to the first probe (same day, older build, no `--force`): the "empty output" result there was almost certainly the **workspace-trust gate**, not slash-command handling — with `--force` the output is non-empty. The dangerous failure mode is therefore **silent degradation that looks like success**, not a visible no-op.
3. **Official docs.** Every changelog/forum reference frames `/multitask` as "in the Agents Window" / "in the editor" (Cursor changelog 04-24-26 §"Multitask in Agents Window"; 05-07-26 "/multitask is now available in the editor"). The headless docs (cursor.com/docs/cli/headless) describe single-agent print mode and shell-loop batching only — no `/multitask`.

## Q2: What IS `/multitask`?

- Cursor 3.2 (Apr 24 2026) introduced it; 3.3 (May 7 2026) made it available in the editor proper and added Explore-subagent controls.
- Runs **async subagents** to parallelize requests instead of queuing them; auto-decomposes a large task into chunks across a fleet.
- Prompts separated by `|||`; each becomes a subagent with its own context window + system prompt, sharing the parent's project context / rules / MCP. Results aggregate back to the parent thread.
- **Controls (Settings → Subagents):** Explore-subagent model selector (`model: opus` | `model: parent` | `disabled`); user-reported flags `--max N` (concurrency cap), `--budget N` (token ceiling, returns partial), `--resume`. Default subagent model = Composer family (`composer-2-fast`) unless Max Mode or an override.
- **Limits:** v0 — no formal write-conflict locking (Cursor: agents "done a pretty good job… working on functionality to improve"). Subagents CANNOT nest `/multitask` (one fan-out level). ~10-min per-subagent default timeout.
- Related: "Build in Parallel" button on a plan kicks off multitask mode over the plan's independent steps (DAG-aware, keeps dependent steps ordered).

## Q3: Head-to-head on a representative fan-out (3 independent classify tasks)

Run via the **headless CLI shell fan-out** (the orchestrator's analog of the Workflow tool — explicit, scriptable parallelism). `/multitask` could not be run for this comparison because it is GUI-only (Q1).

| Metric | Headless parallel (`&` + `wait`) | Headless sequential | Cursor /multitask |
|--------|----------------------------------|---------------------|-------------------|
| Wall-clock (3 tasks) | **14s** | 28s | not measurable headlessly (GUI-only) |
| Speedup | ~2x | 1x | — |
| Determinism | High — you control concurrency, exit codes | High | Medium — agent decides decomposition |
| Observability | Per-agent `usage` tokens via `--output-format json` | same | Agents-panel UI (human watches) |
| Token accounting | Yes (e.g. one run: 17816 in / 20 out, 6.7s, captured from JSON `usage`) | Yes | Implicit, usage-based pricing |
| Surface | Terminal / CI / cmux | Terminal | Cursor editor only |
| Setup cost | Low (shell loop) | Lowest | Low (but requires human in editor) |

Notes:
- Trust gate: headless non-interactive runs need `--force`/`--yolo` to bypass workspace-trust + approval prompts (first run in an untrusted dir returns a "Workspace Trust Required" banner and empty result otherwise).
- JSON `result` field confirmed working: `{"type":"result","result":"POSITIVE","usage":{"inputTokens":17816,"outputTokens":20,...}}`.

## Verdict — when each wins

- **Cursor `/multitask`:** a human is in the Cursor editor, has independent prompts, wants the foreground free. Best UX for interactive parallel work; weakest for automation.
- **Headless `cursor-agent` shell fan-out:** orchestrator / CI / scripted; want determinism, exit codes, per-agent token accounting. The orchestrator's default for fan-out.
- **Claude Workflow tool:** inside a Claude session; want the parent to *decide* the decomposition; summaries return to parent.
- **cmux fleet:** visible, multi-vendor, long-running, human-watchable.
- **Serial (no parallelism):** single coherent edit or sequentially-dependent steps.

## Sources
- Cursor changelog 04-24-26 (Multitask, Worktrees, Multi-root Workspaces) — cursor.com/changelog/04-24-26
- Cursor changelog 05-07-26 (PR Review, Build in Parallel, Split PRs) — cursor.com/changelog/05-07-26
- Cursor headless CLI docs — cursor.com/docs/cli/headless
- Cursor forum: "/multitask in Agents Window" — forum.cursor.com/t/multitask-in-agents-window/158955
- Cursor forum: subagent model selection — forum.cursor.com/t/cursor-multitask-spawn-agent-model-that-not-on-the-list/159677
- MeritForge AI deep-dive on /multitask (||| separator, --max/--budget, no nesting, 10-min timeout) — meritforgeai.com/ai-coding/cursor-multitask-parallel-subagents-may-2026
- Local verification: `cursor-agent --help`, print-mode no-op test, parallel-vs-sequential timing (this repo, 2026-06-05).
