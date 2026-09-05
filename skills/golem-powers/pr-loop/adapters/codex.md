# Codex CLI — pr-loop Adapter

> Capability gaps for Codex running the PR loop. Codex can handle git/gh ops and shell-trigger GitHub reviews, but it lacks native review tooling and BrainLayer access.

## What Codex CAN Do

| Step | Command | Notes |
|------|---------|-------|
| Branch | `git checkout -b feat/name` | Full git access |
| Implement | File edits in full-auto mode | Core strength |
| Test | `bun test` or `npm test` | Shell access |
| Commit | `git add <files> && git commit` | No cr review pre-check |
| Push | `git push -u origin feat/name` | |
| PR | `gh pr create ...` | If `gh` is installed + authenticated |
| Trigger review bots | `gh pr comment <N> --body "@codex review"` | Shell path, not a native reviewer tool |
| Trigger Bugbot | `gh pr comment <N> --body "@cursor @bugbot review"` | **Opt-in, core paths only** (SKILL.md Step 8a) and never where the repo's `AGENTS.md` bans it (Step 8a.0). Not part of the default panel. Re-review with `@cursor @bugbot re-review` |
| Read comments | `gh pr view <N> --comments` | Fetch once on state change — never in a poll loop |
| Merge | `gh pr merge <N> --merge --delete-branch` | See worktree note below |

## Critical Gaps

| Gap | Impact | Workaround |
|-----|--------|-----------|
| No `cr review` pre-commit check | Commits without CodeRabbit pre-screening | Run `cr review --plain` manually if cr is installed |
| No `Agent()` tool | Can't spawn coderabbit:code-reviewer subagent | Slim-poll review state (see CI + Review Waiting below) |
| No `CronCreate` | Can't schedule review polling | `gh pr checks <N> --watch` blocks for CI — no scheduling, no sleep loops |
| No BrainLayer MCP | Can't brain_store post-merge | Skip or orchestrate from Claude session |
| No native review-bot tool | Can't invoke Codex Cloud or Cursor Bugbot through a built-in agent tool | Use `gh pr comment` shell commands after the PR opens, filtered by the repo's bot policy |
| No `AGENTS.md` bot-policy check in the loop | Can summon a bot the target repo bans | Read the target repo's `AGENTS.md` PR-workflow section BEFORE the first `@mention` (SKILL.md Step 8a.0), and name the applied policy in the PR body |

## Worktree Merge Mechanics

When Codex is operating inside a linked worktree, never merge from that active
worktree. Move to the original checkout, run `gh pr merge`, verify the remote
merge SHA, delete the remote branch, then remove the worktree so cleanup does
not delete the session underneath you.

## Shell Review Triggers (Codex fallback)

Read the target repo's bot policy first — repo law tightens the fleet default panel, never loosens it
(SKILL.md Step 8a.0):

```bash
sed -n '/## PR Workflow/,/^## /p' AGENTS.md 2>/dev/null
grep -n -i 'bugbot\|greptile\|coderabbit\|codex review\|do not route' AGENTS.md CLAUDE.md 2>/dev/null
```

```bash
# Trigger the standard review stack from a Codex session (subject to that policy)
gh pr comment <N> --body "@coderabbitai review"
gh pr comment <N> --body "@codex review"

# After pushing fixes, request another pass from the reviewers you actually invoked
gh pr comment <N> --body "@coderabbitai review"
gh pr comment <N> --body "@codex review"
```

**Bugbot is not on this list.** It is opt-in on core paths only — a daemon, engine, or transport diff
— and stays off entirely on docs/skills/tests/config diffs and in any repo whose `AGENTS.md` bans it
(e.g. brainlayer: *"do not route mandatory reviews to Bugbot or Greptile"*). Where it does apply:

```bash
gh pr comment <N> --body "@cursor @bugbot review"      # core paths ONLY — opt-in
gh pr comment <N> --body "@cursor @bugbot re-review"   # only if Bugbot reviewed round 1
```

A cheaper Cursor pass with no Bugbot quota cost is the read-only `cursor-agent -p` review (SKILL.md
Step 8a.2) — Auto-only, no model flag, findings only, never a write pass.

## CI + Review Waiting (Codex — NO sleep-poll loops)

Sleep-poll loops that re-fetch the full PR payload are BANNED. Cost evidence
(weave 2026-06-07, 3 instances across 2 sessions): `sleep 60; gh pr view <N>
--json ...,comments,reviews,latestReviews,...` loops burned ~47M cumulative
input tokens and forced mid-task auto-compactions — every cycle re-ingests the
entire comment/review payload into context.

```bash
# CI: ONE blocking call — no loop, zero re-ingestion
gh pr checks <N> --watch          # or: gh run watch <run-id> --exit-status

# Review state: slim poll — state fields + activity COUNTS, never full bodies
gh pr view <N> --json state,mergeStateStatus,reviewDecision
gh pr view <N> --json comments,reviews \
  --jq '{comments: (.comments|length), reviews: (.reviews|length)}'

# Full payload: fetch ONCE, only AFTER the slim poll shows a change
gh pr view <N> --json comments,reviews,latestReviews
```

Rules:
- CI waiting is a single `gh pr checks <N> --watch` call. Never wrap it in a
  sleep loop. If you use `gh run watch` instead, pass `--exit-status` so a
  failed run fails the command — otherwise `&& gh pr merge` flows sail past
  red CI.
- While waiting on review, poll only the slim state fields plus the
  comment/review COUNTS (`--jq '... length'` — only the numbers enter
  context). Counts are the trigger that catches bot reviewers (CodeRabbit,
  Codex, Bugbot) whose findings land as comments WITHOUT changing
  `reviewDecision` — which stays empty on self-account repos.
- Fetch full `comments,reviews,latestReviews` exactly once, when a state
  field changes or a count increases — never inside a poll cycle.

## Agent Identity Signature — Codex read paths (ratified 2026-08-08)

Convention + failure modes: [../references/github-identity.md](../references/github-identity.md).
`harness` is `codex`. Codex has the **best** live-model record of the three harnesses: every
`turn_context` in the rollout JSONL carries the model actually in use for that turn.

```bash
# Rollout JSONL for the current session
ROLL=$(ls -t ~/.codex/sessions/*/*/*/rollout-*.jsonl | head -1)

# model — LAST turn_context wins (verified keys on turn_context: model, effort, turn_id, cwd, …)
MODEL=$(jq -r 'select(.payload.type=="turn_context") | .payload.model' "$ROLL" | tail -1)  # e.g. gpt-5.6-sol

# session id — the uuid in the rollout filename
SESSION=$(basename "$ROLL" | sed -E 's/.*-([0-9a-f-]{36})\.jsonl/\1/' | cut -c1-8)

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
```

- `model_source` for this path is `session-jsonl`.
- **Take the LAST `turn_context`, not the first.** The first one is boot-time; a model switch mid
  session writes a new `turn_context`, and the whole point of the ratified rule is that boot-time
  values lie.
- **AP7 applies hardest here:** Codex self-identifies incorrectly. Never write the model you believe
  you are — write the one in the file.
- `turn_context` also carries `effort` (verified: `effort: medium` alongside `model`). **Do not put
  it on GitHub** — not in the blob, not in the visible line, not in the trailer. It is captured at
  the BrainLayer checkpoint instead (today `ingest/codex.py:159-162` reads `model` and discards
  `effort` from that same payload — brainlayer lane owns the fix).
- Unreadable rollout → `"model":"unknown","model_source":"unavailable"`.

Codex has no BrainLayer MCP, so a Codex seat signs the GitHub artifact and a Claude session
registers the checkpoint metadata — the signature's `session` field is what joins the two.

Sign with `--body-file` / heredoc, never inline `--body "…"`: the blob is JSON with quotes and
braces, and command substitution mangles it silently.

## Hierarchical Worker Mode (gen-12 weave E09)

When the dispatch brief says LEAD owns merge, Codex worker endpoint = PR + review
responses — stop at TASK_DONE with PR URL; do not `gh pr merge` unless the brief
explicitly grants merge authority. Before LEAD merges, verify `headRefOid` matches
the worker's latest push (`gh pr view <N> --json headRefOid`).

Draft PRs skip bot reviews — use `gh pr ready <N>` before `@coderabbitai review`.
Deploy claims need a same-moment live probe (`ps`/health curl), not merge SHA alone.

## Recommended Usage

Use Codex for pr-loop ONLY when:
- Shell-driven review triggers and polling are acceptable
- A Claude session can handle post-merge BrainLayer updates
- `gh` CLI is installed and authenticated in the environment

**Best pattern:** Codex implements + opens the PR + triggers review bots through `gh` + watches CI with `gh pr checks --watch` + slim-polls review state; use a Claude session only when you need post-merge BrainLayer tracking.
