---
name: cursor-multitask
description: "Route fan-out / parallel work to the RIGHT engine: Cursor /multitask, headless cursor-agent, Claude Workflow, or cmux. Triggers: multitask, /multitask, parallel agents, fan out, in parallel, batch classify/audit. NOT for one edit or dependent steps."
---

# cursor-multitask — Parallel Fan-Out Routing

> Encoded-preference skill. Picks the right parallelism engine for a fan-out task.
> The expensive mistake is reaching for an in-editor GUI feature when a headless,
> deterministic, observable fan-out is what the task actually needs.

## TL;DR — the one decision

**Cursor `/multitask` is an in-EDITOR (GUI) slash command. It is NOT invocable from the headless `cursor-agent` CLI.** (Verified 2026-06-05 on Cursor 3.3.2 / cursor-agent 2026.06.04: absent from `cursor-agent --help`, no flag. In `-p` print mode the `/multitask` text is passed through as a PLAIN PROMPT to a single agent — transcript JSONL confirms one thread, zero subagents — and the model answers all the parts inline while *claiming* "ran in parallel." It looks like it worked. It didn't.) So if you are an orchestrator running in a terminal/cmux and you want parallelism, `/multitask` is **not your tool** — it requires a human sitting in the Cursor Agents Window. Use headless shell fan-out, the Workflow tool, or the cmux fleet instead.

**Cursor is Auto-only in every engine in this skill.** Never pass `-m`/`--model` or a
model field: pinned Cursor drains the shared subscription pool fast.

## GUI prompt contract (when Etan asks for "a prompt")

When Etan asks for **"a prompt"** for the Cursor GUI `/multitask`:

1. Deliver **ONE complete self-contained paste-ready inline text** — the full prompt in chat, ready to paste.
2. **No file indirection** — no "Read X first", no prompt packs, no path references he must open separately.
3. `"Read X first"` is for **agent dispatch briefs only**, not for GUI prompts Etan pastes himself.

Evidence: corrected twice in 3 min — *"I am using the GUI, give me a full prompt"* (paraphrased; ea8514a2 [950]).

## Dispatch hygiene (orchestrator-written worker prompts)

1. **Never hardcode file-derived numbers** into async worker prompts (counts, baselines, finding totals). Instruct workers to **read the file** — stale `838/47/29`-class numbers corrupted census synthesis twice.
2. **Validate scope/ownership with the human BEFORE expensive per-repo fan-out** — confirm repos/domains in scope; don't burn a full cmux fork audit on out-of-scope repos.
3. **Slow ≠ stalled** — read why a worker is slow (`read_screen`, collab, PR activity) before spawning a duplicate; duplicate auditors overwrite originals.
4. **Never mandate sleep-poll loops** in dispatched prompts — use `wait_for`, file contracts, or cron with live-query-first frames (`/cron-payload-discipline`).

## WHEN-TO-USE MATRIX

| Task shape | Engine | Why |
|------------|--------|-----|
| Human is **in the Cursor editor**, wants the foreground free, has independent prompts | **Cursor `/multitask`** | Async subagents, Agents-panel visualization, shared parent context/rules/MCP, results aggregate back. v0 — no conflict locking; keep tasks read-heavy or non-overlapping. |
| Headless / scripted / CI / orchestrator-in-terminal, N independent units, want **determinism + token accounting** | **Headless `cursor-agent` shell fan-out** (`&` + `wait`, or `find \| while read`) | You control concurrency, capture per-agent `usage` tokens via `--output-format json`, exit codes. ~2x wall-clock on 3 tasks (measured: 14s vs 28s). |
| Inside a **Claude** session, work decomposes into independent subtasks, want the parent to make the parallelism call | **Claude Workflow / Agent tools** | Implicit fan-out, subagents share plan/rate-limit, summaries return to parent. Best when you want Claude to *decide* what's parallel. |
| Need **visible, multi-vendor** workers (Cursor + Codex + Gemini side-by-side), long-running, human-watchable | **cmux fleet** (`/cmux-agents`, repoGolem launchers) | Etan wants to SEE agents working. Multi-vendor, persistent, monitorable. Heavier setup. |
| Single coherent edit, OR step B needs step A's output | **None — run serially in one agent** | Parallelism wastes tokens on work that gets redone. |

### Explicit vs implicit (the control axis)
- **`/multitask`** = *explicit*: you list the prompts (`|||` separator), you know what's parallel.
- **Workflow tool / Claude subagents** = *implicit*: you hand a high-level task, the agent decides the split.
- Pick explicit when you already know the independent units; implicit when delegating the decomposition itself.

## INVOCATION RECIPES

### A. Cursor `/multitask` (GUI only)
1. Open the **Agents Window**: `Cmd+Shift+P → Agents Window` (or the agent input dropdown).
2. Type `/multitask`, then your read-only prompts separated by `|||`:
   `/multitask Audit auth tests for coverage gaps ||| Audit auth docs for missing setup ||| Inspect type-checker errors without edits`
3. Each prompt becomes its own async subagent (own context window, own system prompt, shared parent rules/MCP). Watch them in the Agents panel; results aggregate back to the parent thread.
4. **Controls (Settings → Subagents):** Leave the model control at Auto/default; never select a specific Explore model or enable Max Mode. Adjust only the concurrency cap and cost ceiling. Flags reported by users: `/multitask --max 3`, `/multitask --budget 50000`, `/multitask --resume`.
5. **Gotchas:** v0 — no automatic write-conflict locking (Cursor's words: agents "done a pretty good job" but nothing formal). Subagents **cannot** nest another `/multitask` (blast radius capped at one fan-out level). Default 10-min per-subagent timeout. NOT scriptable, NOT headless.

### B. Headless `cursor-agent` shell fan-out (the orchestrator's tool)
```bash
# N independent units in parallel; capture per-agent tokens + exit codes
for item in "$@"; do
  # Cursor stays on Auto: never add -m/--model.
  cursor-agent -p --force --output-format json \
    "Classify $item as POSITIVE/NEGATIVE, one word" > "out.$item.json" &
done
wait
# each out.*.json has .result and .usage.{inputTokens,outputTokens}
```
- `--force`/`--yolo` is REQUIRED non-interactively (bypasses workspace-trust + approval prompts).
- `--output-format json` → structured `result` + `usage` token accounting; `stream-json` for live progress.
- Concurrency = how many `&` you launch (add a semaphore/`xargs -P N` to cap). Deterministic, CI-safe.

### C. Claude Workflow tool / parallel subagents
- Use the Claude Workflow/Agent tools when you have 2+ independent, no-shared-state tasks and want Claude to fan them out. Subagents return summaries to the parent; counts against your plan rate limit, not usage billing.

### D. cmux fleet (visible multi-vendor)
- Invoke `/cmux-agents`. Use when the human wants to watch heterogeneous workers. See also `/agent-routing` (Cursor=gather, Codex=implement, Claude=orchestrate).

## GOTCHAS / ANTI-PATTERNS
- **Do NOT** tell a headless agent or a terminal orchestrator to "use `/multitask`" — the slash command is not recognized; the text degrades to a plain prompt handled by ONE agent that may falsely report it parallelized. Success-looking output ≠ subagents ran. This is the #1 misroute this skill exists to prevent.
- **Do NOT** model-pin any Cursor path, including internal/headless fan-out.
- **Do NOT** parallelize sequentially-dependent steps — wasted tokens.
- **`/multitask` v0 has no write-conflict locking** — keep parallel writes to disjoint files, or prefer worktrees (Cursor's own worktree feature, or headless fan-out into separate dirs).
- Each subagent ≈ one parent-context-window of overhead. On usage-based pricing this adds up — cap with `--max`/`--budget` (GUI) or a `-P` semaphore (headless).
- Discovery-then-change pattern: fan out the *discovery* phase (read-heavy, naturally parallel), then make the *changes* in a single agent holding the whole picture.

If this skill's own dispatch exhausts a shared quota, report that dispatch as
the cause; never relabel the resulting error as an external finding.

## Compact Instructions
- **Preserve:** the GUI-only verdict for `/multitask`, the when-to-use matrix routing rules, the headless fan-out recipe (B), the measured 2x wall-clock figure, and the "headless agents silently ignore /multitask" gotcha.
- **Discard:** raw `cursor-agent --help` dumps, per-run token JSON blobs, intermediate timing experiments, exact subagent model enum lists (they churn between Cursor versions — re-verify against `--help` / changelog when needed).
- **Re-verify on Cursor version bump:** whether `/multitask` ever gains a headless CLI surface (`cursor-agent --help | grep -i multitask`). If it does, update the matrix.

## Integration Points
- `/agent-routing` — decides Cursor vs Codex vs Claude by task TYPE (gather/implement/orchestrate). This skill decides the PARALLELISM ENGINE once you know it's a fan-out. Use together.
- `/cmux-agents` — the visible-fleet implementation referenced in row 4.
- Claude's built-in Workflow/Agent tools — the in-session fan-out path (row 3).
