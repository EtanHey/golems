---
name: pr-queue-gate
description: "Inspect fleet-authored GitHub PR queues and enforce the one-shot Claude Stop gate. Triggers: PR queue, open-PR blindness, pr-queue gate. NOT for cmuxlayer status-claim enforcement."
---

# pr-queue-gate

Hook-carried skill for the deterministic PR-queue primitive and Claude Code
session-end gate. The enforcing artifacts are `scripts/pr-queue.sh` and
`scripts/pr-queue-gate-hook.mjs`.

## Boundary

This skill owns:

- one-call GitHub queue inspection for a repository;
- the fleet-authored PR filter;
- CI/age normalization into stable JSON;
- one Stop-hook block per Claude session;
- fail-open ledger evidence for non-actionable or infrastructure states.

It does not own cmuxlayer lane-status/lane-closure enforcement (the separate
status-claim lane), merge policy, review execution, or live installation.

> Note: the pre-v0.4.35 `set_status` tool it used to name no longer exists, and the
> 9-tool surface has no replacement for agent-authored status/progress reporting —
> `update_surface` only does `move` and `rename`.

## Primitive contract

```bash
skills/golem-powers/pr-queue-gate/scripts/pr-queue.sh [repo-path]
```

The default repo path is the current directory. Stdout is one compact JSON
object:

```json
{"repo":"golems","open":1,"oldest_days":3,"prs":[{"n":101,"title":"fix: example","age_d":3,"reviewDecision":"REVIEW_REQUIRED","ci":"passing"}]}
```

Exit codes:

- `0`: no open fleet PRs;
- `3`: one or more open fleet PRs;
- `2`: git/remote/`gh`/JSON infrastructure error, printed to stderr.

The primitive makes exactly one `gh pr list` call. `jq` filters, sorts, escapes
titles, computes whole-day ages, and classifies rollups as `passing`,
`failing`, or `pending`.

## Fleet-authored filter

The 2026-08-04 live inventory across brainlayer, cmuxlayer, and golems showed
that every open PR was authored by the repository owner; the observed branch
prefixes were `fix/`, `feat/`, and `hygiene/`. The filter therefore includes a
PR when either condition is true:

1. `author.login` equals the GitHub remote owner; or
2. `headRefName` matches `^(feat|fix|hygiene)/` case-insensitively **and** the
   head branch is owned by the repository owner and is not cross-repository.

The second clause keeps same-repository fleet automation while preventing an
external fork from becoming a fleet PR merely by choosing a conventional branch
name. Titles are treated as metadata: the Stop reason strips terminal and
bidirectional display controls, collapses whitespace, truncates to 120 Unicode
code points, and JSON-delimits the result before it enters model context.

Do not widen the branch regex from memory. Re-measure live fleet PRs and update
the fixture plus this contract in the same reviewed PR.

## Stop-hook contract

The hook accepts Claude Code Stop JSON on stdin and reads `cwd` plus
`session_id`. It checks only the repository containing `cwd`, and acts only when
that repository's `origin` is a `github.com/EtanHey/*` remote.

When the primitive exits `3`, the hook atomically writes a SHA-256-keyed latch
under `state/`, blocks once, lists every PR, and gives exactly three allowed
dispositions:

- `merge per /pr-loop --admin`;
- `review-routed:<who>`;
- `blocked:<real-blocker>`.

The reason ends by directing the lane to post the disposition to its collab,
then stop. Once the latch exists, later Stops in that session allow immediately
without another GitHub call, including if new PRs appear later in the session.
That session-wide one-shot trade-off is deliberate: preventing a Stop loop takes
priority over repeated enforcement.

The latch is written before the block payload. If the process dies in the narrow
gap between those writes, that session's one block is consumed without delivery.
This deliberate fail-open ordering avoids the worse failure mode: emitting a
block, failing to latch it, and trapping the seat in repeated Stop blocks.

All ambiguity and infrastructure failures fail open. The hook appends JSONL
evidence to `state/ledger.jsonl` when possible; a ledger or latch error must
never loop a seat.

## Test and install

```bash
bun test skills/golem-powers/pr-queue-gate/evals/pr-queue-gate.test.mjs
```

The test suite initializes real fixture git repositories and mocks only the
external `gh` process via `PATH`. It performs no live GitHub calls.

See `INSTALL.md` for the post-merge installed-copy procedure and
`install-snippet.json` for the Stop-hook entry. Never self-install this gate
from an unmerged branch.

## Integration

- `/pr-loop` owns review, merge, and `--admin` authority.
- `/never-fabricate` requires fresh queue/test/PR evidence before claims.
- `pr-queue-gate` only removes session-end blindness; the cmuxlayer lane owns
  cross-engine status-claim refusal.
