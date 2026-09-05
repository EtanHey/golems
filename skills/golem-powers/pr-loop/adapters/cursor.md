# Cursor CLI — pr-loop Adapter

> Capability gaps for Cursor running the PR loop. Cursor is better for review/audit steps than implementation.

## What Cursor CAN Do

| Step | Command | Notes |
|------|---------|-------|
| Branch | `git checkout -b feat/name` | Full git access |
| Implement | `cursor agent "PROMPT"` | File edits via agent mode |
| Test | `bun test` or `npm test` | Shell access |
| Commit | `git add <files> && git commit` | No cr review pre-check |
| Push | `git push -u origin feat/name` | |
| PR | `gh pr create ...` | If `gh` is installed + authenticated |
| Read comments | `gh pr view <N> --comments` | Manual poll only |
| Merge | `gh pr merge <N> --merge --delete-branch` | |

## Critical Gaps

| Gap | Impact | Workaround |
|-----|--------|-----------|
| No `cr review` pre-commit check | Commits without CodeRabbit pre-screening | Run `cr review --plain` manually if cr installed |
| No `Agent()` tool | Can't spawn coderabbit:code-reviewer subagent | Use shell polling loop |
| No `CronCreate` | Can't schedule review polling | `for i in $(seq 1 6); do ... sleep 30; done` |
| No BrainLayer MCP | Can't brain_store post-merge | Orchestrate from Claude session |
| No Cursor Bugbot auto-trigger | Cursor can comment via PR but not programmatically | Manually comment `@cursor @bugbot review` on GitHub |

## Shell-Based Review Polling (Cursor workaround)

```bash
# Poll for CodeRabbit (max 3 min)
for i in $(seq 1 6); do
  review=$(gh api repos/EtanHey/golems/pulls/NUMBER/reviews \
    --jq '.[] | select(.user.login == "coderabbitai") | .state' 2>/dev/null)
  if [ -n "$review" ]; then echo "CodeRabbit: $review"; break; fi
  sleep 30
done
```

## Cursor's Unique Advantage in the Loop

Cursor's `@codebase` indexing and Bugbot make it strong for the **review step**, even if it can't orchestrate the full loop:

```bash
# Use Cursor for pre-PR audit
cursor agent --output-format text "Audit staged changes for bugs and security issues. @codebase"

# Trigger Cursor Bugbot on the PR (from GitHub UI or gh CLI)
gh pr comment <N> --body "@cursor @bugbot review"
```

## Agent Identity Signature — Cursor (ratified 2026-08-08) — OPEN GAP

Convention + failure modes: [../references/github-identity.md](../references/github-identity.md).
`harness` is `cursor`. Seat and role come from launcher env as usual.

**Live-model capture is UNRESOLVED for Cursor.** Checked 2026-08-08: `~/.cursor/chats` held no
per-turn records on this machine, and no verified live-model source exists for the Cursor CLI the
way Claude (`.message.model` in `~/.claude/projects/**.jsonl`) and Codex (`turn_context.model` in
`~/.codex/sessions/**/rollout-*.jsonl`) do.

Until a source is verified:

```
"model":"unknown","model_source":"unavailable"
```

- **Do NOT substitute the launcher's `-m` flag or spawn-registry value.** That is exactly the
  boot-time/spawn-registry provenance the ratification banned ("the gh() wrapper must re-read model
  per invocation, not cache at spawn"; cmux spawn metadata is the `xhigh`-lie surface).
- **Do NOT substitute self-report.** Cursor routes to multiple upstream models; the model's belief
  about itself is not evidence (AP7).
- An honest `unknown` is the correct output. It tells a later audit "this row has no model", which
  is true — rather than fabricating one, which is the failure the convention exists to prevent.
- If you find a verified per-turn model record for the Cursor CLI, that is a real finding: report it
  so this adapter and the `gh()` wrapper can be updated (golems / repoGolem lane owns the wrapper).

Everything else in the convention applies unchanged: visible line + one-line blob last in the body,
ownership marker on non-`EtanHey` repos, no `effort` field anywhere, and the commit trailer
`Co-Authored-By: <seat> running <model> <noreply@anthropic.com>` (with `unknown` where the model is
genuinely unavailable). Use `--body-file`, not inline `--body`, so the blob survives shell quoting.

## Hierarchical Worker Mode (gen-12 weave E09)

When LEAD owns merge: Cursor worker endpoint = PR + review responses unless the
brief explicitly grants merge. LEAD verifies `headRefOid` before merge. Mark PRs
ready-for-review before bot invocation; draft PRs skip CodeRabbit.

## Recommended Usage

Use Cursor for pr-loop only when:
- Repo is simple (no required review bots)
- A Claude session handles post-merge BrainLayer updates

**Best pattern:** Cursor implements + commits + pushes + creates PR → Claude handles review polling + merge + brain_store.
