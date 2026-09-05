# Claude Code — pr-loop Adapter

> Claude-specific syntax for running the full PR loop.

## Full Capabilities

Claude Code has everything needed for the complete loop:

| Step | Tool / Command | Notes |
|------|---------------|-------|
| Branch | `git checkout -b feat/name` via Bash | Full git access |
| Implement | Edit/Write tools + TDD skill | Native file editing |
| Test | `bun test` via Bash | Full shell access |
| Commit | `cr review --plain`, then `git commit` | CodeRabbit CLI available |
| Push | `git push -u origin feat/name` | |
| PR | `gh pr create` via Bash | `gh` CLI available |
| Review | `Agent(subagent_type="coderabbit:code-reviewer")` | Subagent spawning |
| Poll | `CronCreate` or `/loop 2m gh pr view <N> --comments` | CronCreate tool available |
| Fix + merge | `gh pr merge <N> --merge --delete-branch` | |
| Post-merge | `brain_store(...)` via BrainLayer MCP | MCP access |

## Review Polling Options (Claude-specific)

```bash
# Option A — subagent reviewer (best)
Agent(subagent_type="coderabbit:code-reviewer", prompt="Review PR #N in EtanHey/golems")

# Option B — loop polling
# /loop 2m gh pr view <N> --comments | tail -20

# Option C — manual wait
sleep 90 && gh pr view <N> --comments
```

## Post-merge BrainLayer Store (Claude-only)

```bash
brain_store(
  content: "[date] PR #N merged — <what changed and why>",
  tags: ["pr-merged", "<project>", "agent:golemsClaude"],
  importance: 7
)
```

## Agent Identity Signature — Claude read paths (ratified 2026-08-08)

Convention + failure modes: [../references/github-identity.md](../references/github-identity.md).
`harness` is `claude-code`. Claude's job is supplying `model` and `session` from **live** session
metadata at write time — not from launcher env, not from self-report, not from the cmux spawn
registry, and never cached at spawn (Etan switches models mid-session).

```bash
# Session JSONL for this session (Claude Code writes one file per session):
JSONL=$(ls -t ~/.claude/projects/*/*.jsonl | head -1)

# model — LAST assistant turn wins; drop the "<synthetic>" sentinel, which is not a model
MODEL=$(jq -r 'select(.message.model) | select(.message.model != "<synthetic>") | .message.model' \
        "$JSONL" | tail -1)                                                   # e.g. claude-opus-5

# session id prefix (verified field: .sessionId)
SESSION=$(jq -r 'select(.sessionId) | .sessionId' "$JSONL" | head -1 | cut -c1-8)

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
```

**Why "last turn", not "the session's model" — measured evidence (2026-08-08):** session
`08d077d1` (orchestrator) contains **three different models in one file** — `claude-fable-5`,
`claude-opus-4-8`, and `claude-opus-5` — because Etan switched models mid-session. A value read at
boot would have been wrong for most of that session's writes. This is Q1's ruling in the data.
The same sweep found `"<synthetic>"` written into `.message.model` on non-assistant records; it is a
sentinel, never a model, and must be filtered out before it reaches a signature.

**Subagents:** the signature identifies a **seat**, and sub-agents do not hold seats (fleet law).
A sub-agent signs with its seat's session model. If a sub-agent's own turns are not yet flushed to
the session JSONL when it writes, do NOT fall back to "whatever the last row says" from a different
context — use the model the harness reports for the running context and set
`"model_source":"harness-reported"` so the audit knows which path produced it.

- `model_source` for this path is `session-jsonl`. If you take the value the harness reports about
  itself in-band instead, that is `harness-reported` — say so rather than claiming the JSONL.
- Re-run the read **per GitHub write**, not once per session.
- The project slug directory is derived from cwd; pin the exact JSONL if the session works across
  repos (`ls -t ~/.claude/projects/<slug>/*.jsonl | head -1`).
- No JSONL readable (sandbox, worktree oddity)? Emit `"model":"unknown",
  "model_source":"unavailable"`. Never guess — a wrong model poisons every audit downstream.
- Effort is NOT part of any GitHub artifact. Claude Code JSONLs carry no effort field at all;
  effort registration happens at the BrainLayer checkpoint (brainlayer lane).

Claude is also the seat that can `brain_store` the checkpoint metadata behind the signature — pair
the post-merge `brain_store` with the session id you signed with, so comment → JSONL → BrainLayer
is one traceable chain.

## Hierarchical Worker Mode (gen-12 weave E09)

When LEAD owns merge per the brief: worker stops at PR + review responses;
LEAD merges after head SHA verification. Never leave PRs in draft when invoking
review bots (`gh pr ready <N>`). PR-referenced artifacts must be on committed
paths — not gitignored `docs.local/` alone.

## Unique Capabilities

- `Agent(subagent_type="coderabbit:code-reviewer")` — spawns real code review subagent
- `CronCreate` — scheduled review polling
- BrainLayer MCP — post-merge brain_store (mandatory per pr-loop spec)
- `--worktree` isolation — `claude --worktree feat/name` for parallel PRs
