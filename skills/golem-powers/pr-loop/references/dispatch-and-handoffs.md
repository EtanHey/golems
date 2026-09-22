# Dispatch, stop-state, and worker handoff rules

Read this when a PR loop starts, stops early, runs autonomously, or has separate worker and lead ownership.

## Stop-State and End-State

**End state, precisely:** done = review bots and required checks GREEN on the **LATEST** commit. Not
"a green run exists" — green on the commit that is actually at the head of the PR.

**The four explicit turns**, in order, none skipped and none merged into a neighbour:
1. fix
2. commit + push + open/update the PR
3. babysit to green on the latest commit (invoke bots, answer findings, re-push)
4. merge **only on instruction** (lead authority or the brief's merge policy)

**Stop-state clause — when you stop before the end state (no PR, or PR not merged):** state exactly
where you stopped and what the next turn is. "Stopped after step 2: PR #N is open, CI running, next is
step 3 babysit" is a valid stop. "Done" without a PR URL, or silence, is not. A stop-state line makes
an early stop legible instead of a stall.

## Autonomous Agent Mode

If you are running autonomously (no human in the loop), these rules are mandatory:

1. **Never merge with 0 reviews.** Wait or invoke bots. No exceptions.
2. **Review wait timer:** After invoking reviewers, wait minimum 120s before first check. If no reviews after 5 min, re-invoke. Fifteen minutes with no response does not waive the review gate: a lead may merge only after at least one review and all required comment/review conditions pass; a worker hands off unmerged.
3. **Post to collab** with PR number immediately after creation and after worker handoff or lead merge (with test counts).
4. **CRITICAL/HIGH comments require reply** before handoff or merge — fix, or explicit "won't fix because X." Zero replies = cannot advance.
5. **Max 3 review rounds.** If round 3 still has new non-critical issues, a lead with merge authority may merge and create a follow-up ticket; a worker hands off the reviewed PR with those issues documented. Infinite review loops are worse than shipping with known minor issues.

## Hierarchical Worker Mode

When a dispatch brief says **LEAD owns merge** (or "worker endpoint = PR + review
responses"):

- Worker's endpoint = **PR opened + review responses addressed** — do NOT
  re-derive `MISSION = MERGED` or merge locally.
- Worker stops at: branch → implement → verify → commit → push → PR → invoke
  reviewers → fix review threads → post TASK_DONE with PR URL.
- LEAD merges after a clean loop on the worker PR.
- A worker must hand the reviewed PR to its lead unmerged.

### Effort Is Set Per Dispatch (Etan, 2026-09-05)

Etan, verbatim; the ellipsis is his:

> "Codex being high instead of xhigh on default is nice, but leads need to know that they should
> also control the effort levels for more/less complex/more already scoped and focused jobs… not
> always needed high."

A lead writing a dispatch brief therefore names the effort **on that brief**. It is a per-job call,
not a lane-wide setting and not whatever the seat happened to boot with.

**It is a ceiling, not a floor.** The launcher default stands — `repoGolem` sets `--effort` from the
seat's role (lead `high`, worker `medium`) — and the lead lowers it per dispatch with an explicit
`-E/--effort <value>`, which wins over the role default. Brief and launch command must agree.

Orc's operationalization of that sentence. The rungs below are orc's gloss, not Etan's words — he
said "control the effort levels" and did not enumerate them:

| Job shape | Effort |
|---|---|
| Scoped, focused, or mechanical — a doc edit, a rename, a one-file fix, a re-cut | `medium`, or `low` when purely mechanical |
| Genuinely complex — novel design, cross-package refactor, an unknown root cause | `high` |
| Beyond that | `xhigh` **only by explicit choice**, named in the brief with its reason |

If a brief names no effort, the lead has not finished writing it.

### Spawn Only What the Job Needs (Etan, 2026-09-05)

Etan, verbatim — relayed via orc, the ellipsis is his:

> "tell the agents to do it wisely and not just blindly make workflows and sub-agents… especially
> when they're Fable, make sure they're not creating Fable sub-agents and workflows full of Fables
> when they don't actually need them, instead of just pin-gating it."

Sub-agents and workflows only when the task needs parallelism or a context the seat cannot hold;
every spawn pinned explicitly; Fable only where judgment is the bottleneck, never for mechanical
steps; a Fable seat defaults its workers to opus/sonnet and says why when it does not. The gate
(`model-pin-gate`) is the backstop, not the decision.

## Review-Without-Merge ≠ Draft

Draft PRs **silently skip bot reviews**.

```
WRONG: gh pr create --draft … then wait for @coderabbitai
RIGHT: Create ready-for-review PRs; if draft was used, `gh pr ready <N>` BEFORE
       invoking reviewers. Never merge while still draft.
```

"Review without merge" means mark ready-for-review and run the review loop — NOT
leave the PR in draft state.

## Lead Merge-Timing

LEAD (or any merger) must **never merge a worker's PR mid-review-fix**:

```bash
# BEFORE gh pr merge — confirm head matches worker's latest push
gh pr view <N> --json headRefOid,commits,reviewDecision
```

Checklist:

- [ ] `headRefOid` matches the worker's latest pushed commit (not an earlier SHA
      mid-fix)
- [ ] No open CRITICAL/HIGH review threads awaiting a fix push
- [ ] Re-review requested after the final fix commit
