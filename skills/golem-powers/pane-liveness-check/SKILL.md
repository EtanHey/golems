---
name: pane-liveness-check
description: "Use when auditing cmux panes for claim-or-close, sprint close-out, idle workers, dead shells, uncommitted or unpushed artifacts, untitled seats, or stale numeric surface refs."
execute: scripts/run.sh
---

# Pane Liveness Check

Run a read-only claim-or-close sweep. The core rule is conservative: **uncertainty always KEEP**. Idle state, `TASK_DONE`, a title, or cost data never proves that a pane is done.

## Run

```bash
bash skills/golem-powers/pane-liveness-check/scripts/run.sh
bash skills/golem-powers/pane-liveness-check/scripts/run.sh --json
```

The runner uses cmux/cmuxlayer reads and Git status/upstream reads. It never closes, kills, sends to, retitles, checks out, fetches, resets, or cleans a worktree.

## Safety Contract

1. Enumerate with cmuxlayer `list_surfaces` and `verbose:true`; stable UUID is each surface's `id`.
2. Key every row by UUID. Treat `surface:N` as display-only.
3. Immediately before each parsed read, re-list and compare UUID. Accept screen evidence only with an atomic `cmux read-screen --id-format both` receipt for the expected UUID. Re-list afterward.
4. Any mismatch means `STALE-REF — re-enumerate`, `verdict: null`, and no disposition.
5. Set an owner only from explicit metadata (`seat_lane`, `parent_agent_id`, `Owner lane: @name`, or `(@name)`); otherwise use `owner=UNKNOWN`.

## Verdicts

| Evidence | Verdict |
|---|---|
| Uncommitted files or unpushed commits | `KEEP-unpushed` |
| Verified dead process | `DEAD-shell` |
| Live worker still booting, thinking, or working | `KEEP-live` |
| Open/owed/unknown lane or incomplete proof | `KEEP-blocked` |
| Closed lane, harvested/reported worker, clean pushed artifact | `CLOSE-CANDIDATE` |
| UUID mismatch | No disposition: `STALE-REF` |

Report DONE only when all three are true: no open lane, no live worker is unharvested or unreported, and no work is unpushed. Flag launcher-only titles such as `<repo>Claude [surface:N]` as untitled.

## NOT for

- Automatically closing, killing, messaging, or retitling panes.
- Worktree mutation or garbage collection.
- Billing analysis or worker shaming; output omits cost entirely.

## Common Mistakes

- Treating `idle`, `TASK_DONE`, or an old title as completion proof.
- Inferring ownership from a repository-like title.
- Reusing a numeric surface ref after pane re-enumeration.
- Declaring DONE while a live worker, open lane, dirty tree, or unpushed commit remains.

## Evaluation

The 2026-08-03 baseline/sweep record did not preserve an allowed observation of
the effective runtime model and effort. Its numeric comparison is withdrawn and
must be rerun with provenance-complete arms before publication.
