# Cursor CLI — cmux-agents Adapter

> CLI-specific syntax and capabilities for Cursor agents in cmux panes.

## CLI Syntax

| Mode | Command | Notes |
|------|---------|-------|
| **Audit (read-only)** | `cursor agent --output-format text "PROMPT"` | Text output, no file edits |
| **Work (edits files)** | `cursor agent "PROMPT"` | Omit `--output-format text` |

**Run from the target repo directory** — Cursor indexes `@codebase` from cwd.

Cursor is Auto-only in every harness. Never pass `-m`/`--model` or a model field; `/agent-routing` AP3 owns this rule.

## Worktree Capabilities

**Cursor has NO native worktree support.** Manual setup required (same as Codex — see codex.md).

## Preferred cmux lifecycle

For visible Cursor workers, use the lifecycle in `../SKILL.md` and parameters in `../references/tool-contracts.md`; never hand-type the launcher. Cursor-specific follow-ups use `send_to({agent_id,...})`; keep `read_screen` for approval prompts or FR-06 parser disputes.

## Prompting Style

- Use `<output_contract>` tags for structured output (GPT follows format contracts)
- `@codebase` reference for whole-repo context
- Include output file path in prompt for auto-writing results
- Max context: depends on model tier

## Audit Best Practices

- Always include a durable output path inside the repo or its `docs.local/`
- Use `--output-format text` for read-only audits
- Run multiple audits in parallel for different angles
- Pipe ephemeral terminal-only output only when no durable handoff is required

## PR Review (Bugbot)

Trigger on PRs: `@cursor @bugbot review` (as PR comment)
- Bot responds as `cursor[bot]`
- For re-review after fixes: `@cursor @bugbot re-review`
- NOT `@CursorBot` or `@cursor-bugbot` — those are wrong

## Error Patterns

| Screen Output | Problem | Fix |
|---------------|---------|-----|
| `error: unknown option` | Wrong CLI flag | Check syntax table above |
| `command not found: cursor` | Not installed | Check `~/.local/bin/cursor` |

## Wrong Syntax (common mistakes)

- ~~`cursor -p "prompt"`~~ — `-p` is wrong. Use `cursor agent "PROMPT"`
- ~~`cursor agent --trust`~~ — `--trust` doesn't exist

## ALWAYS VERIFY Cursor Findings

Cursor can see files on disk but can't tell if they're git-tracked or gitignored.
- File "committed to git"? → `git ls-files -- <path>` (empty = not tracked)
- Secret "exposed"? → `git log --all -- <path>` (empty = never committed)

## Unique Capabilities (not available in other CLIs)

- `@codebase` indexing (whole-repo semantic search)
- PR review bot (`@cursor @bugbot review`)
- Text output mode for audits

## Limitations (vs other CLIs)

- No native worktree isolation
- No session resume
- No MCP server access
- No hook system
- No subagent spawning
- Findings need manual verification (can report gitignored files as "committed")

---

## CLI Commands Reference (for cmux remote control)

### Commands

Cursor CLI (`cursor agent`) is primarily a single-run tool — fewer interactive commands than Claude Code.

| Command | What It Does | Via cmux |
|---------|-------------|----------|
| Ctrl+C | Cancel/exit current run | `send_to({mode:"key", surface, key:"ctrl+c"})` or equivalent interrupt |
| `y` / `n` | Approve/reject tool use (interactive mode) | `send_to({mode:"key", surface, key:"y"})` — **key mode, not text.** `send_to`'s agent mode refuses text at permission prompts by design ("permission-prompt safety gates still refuse text; use mode=key for deliberate menu driving"). |

**No `/mcp`** — Cursor has no MCP support (uses `@codebase` indexing instead).
**No `/compact`** — runs to completion, no persistent context.
**No `/model`** — Cursor stays on Auto.
**No session resume** — each `cursor agent` invocation is a fresh run.

### Detecting Agent State via read_screen

| Screen Pattern | State | Safe to Send? |
|----------------|-------|--------------|
| `$` shell prompt | Cursor finished (exited to shell) | Run is complete |
| `? Allow` or `(y/n)` | Waiting for approval | `send_to({mode:"key", surface, key:"y"})` — agent-mode text is refused here |
| Text streaming | Working | Wait for completion |
| `cursor>` | Interactive prompt (rare) | Safe to send |

### Common Remote Operations

**Cursor is usually fire-and-forget** once launched by `spawn_agent`.

**Start an audit:** follow `../SKILL.md`; write results to an explicit repo or `docs.local/` path.

**Check if done:**
`wait_for({ agent_id:"...", target_state:"done", timeout_ms:1800000 })`
