---
name: pr-loop
description: "Open a PR, merge, ship, handle CI/reviews; signs GitHub writes. Invoke before first PR action. Triggers: finish work, PR comment, golem-id, Co-Authored-By trailer."
---

# PR Loop

> Fleet law: canon #2 owns branch→commit→push→PR→review→merge and PR URL validity. This skill owns the procedural loop, review handling, edge cases, and worker-vs-lead endpoint mechanics.

## Kickoff contract

- **Claude seats:** invoke `/pr-loop` with the Skill tool before the first PR action of a lane: opening, updating, merging or shipping a PR, or fixing red CI.
- **Codex seats:** read this SKILL.md body (a file read) before that action; Codex has no Skill tool.
- **A lead's kickoff brief** to a worker names the skills the worker invokes (`/large-plan`, `/agent-routing`, `/pr-loop`).
- Standing ask: "Once its PRs land, invoke the updated skills at the start of each plan, dispatch or PR action." (Etan 2026-10-18, via orc collab)
- Why: Claude T3 leads made 0 Skill calls on Oct 16–18 while all three lead skills sat in their catalog (skill-edits audit, 2026-10-18).

## Ownership

Who implements and who opens the inner-loop reviewer pane is owned by `/agent-routing` § Routing rules (SSOT). Never start that reviewer yourself unless that routing law makes you the owner.

This skill begins at branch preparation and ends at the authority-appropriate endpoint:

- Lead: reviewed, latest-head-green PR merged, verified, and cleaned up; released/installed where applicable at the [feature-batch gate](references/merge-and-verification.md#feature-batch-gate).
- Worker whose brief says the lead owns merge: ready-for-review PR, review responses addressed, URL handed to the lead, unmerged.
- A worker must hand the reviewed PR to its lead unmerged.

Run `scripts/ci/release-gate.mjs <repo>` at the feature-batch gate, not after every PR. At the batch endpoint, `MERGED_UNRELEASED`, `RELEASED_UNINSTALLED`, or `UNKNOWN` is a stop; release/install and rerun until `CLEAN`. A `MERGED_UNRELEASED` mid-batch is expected, not a stop: keep merging the batch.

## Required Sequence

Keep these as four explicit turns:

1. Fix.
2. Commit, push, and open or update the ready-for-review PR.
3. Babysit CI and reviews to green on the latest commit; answer findings and re-push.
4. Merge only when the dispatch authority permits it.

When stopping early, state the completed step, PR URL/state, and exact next turn. A DONE signal is not a receipt.

Run the loop in this order:

1. Confirm expected branch/worktree and sanitize repository state.
2. Implement under repository law and run the relevant tests.
3. Invoke `/never-fabricate`. Real-client or visual proof, when triggered, runs at the feature-batch gate (now, for a single-PR batch).
4. Run the bounded local CodeRabbit pre-commit pass when available, then commit with the ratified identity trailer.
5. Push, create a non-draft PR with a signed body, and apply exactly one `size:*` label.
6. Apply the target repo's bot policy, invoke allowed PR reviewers, and wait for evidence per the [waiting policy](references/review-loop.md#waiting-policy-no-polling-turns): T3 watch wake, one bounded check, or one cheap watcher, never a polling turn.
7. Classify every finding; fix real bugs, reply to every CRITICAL/MAJOR/HIGH finding, push, and request re-review.
8. Confirm required checks and reviews are green on `headRefOid`, then either hand off unmerged or merge.
9. After an authorized merge, verify the remote merge/content, update tracking, and clean up; release/install/live-probe at the feature-batch gate. End the merge comment or DONE report with the [CLEANUP RECEIPT](references/merge-and-verification.md#cleanup-receipt).

## Merge Cadence (risk-sized)

The rules this section lands, verbatim (Etan 2026-10-18, via orc collab):

> **Merging:** small PRs merge right away on fast CI + 1 review. Heavy or e2e tests run per FEATURE BATCH (a full plan or feature change tested together), not per PR and not as a pre-merge gate.

> XS/S: 1 reviewer, 1 round.

> Full panel only for L, data or security paths, and that panel = [composition: `/agent-routing` § Routing rules (SSOT)].

> **Review bots** (CodeRabbit/Bugbot) run only AFTER the inner loop, and they're advisory. Only wait on a bot when it flags something important. Never wait on rate limits.

> Give each test/build its own ports and temp folders so they run in parallel.

| PR | Merge when (everything at `headRefOid`) |
|---|---|
| XS/S | Fast CI green + one clean review round from the routed reviewer → merge promptly |
| M | Same, up to 2 rounds; round 2 only for BLOCKING findings |
| L, data or security paths | Full panel, same round cap |

Who reviews, how many, and the panel: `/agent-routing` § Routing rules (SSOT), which wins on conflict. Every size keeps the Hard Gates below: never zero reviews, exact-head green, no unreplied CRITICAL/MAJOR/HIGH finding, never a draft.

- **Fast CI** is the repo's required PR checks. Heavy/e2e suites, daemon real-client runs, visual self-QA and the release gate run at the [feature-batch gate](references/merge-and-verification.md#feature-batch-gate): before the batch is released, installed or declared done. A PR that alone ships to users is a single-PR batch and runs that gate itself.
- **Bots** run after the inner loop and are advisory. A silent or rate-limited bot is recorded as unavailable in the PR body, never awaited. When a bot flags something important, answer it like any finding before merge. A real bot finding still gets fixed, in a NEW PR (canon #9) if it lands after merge.
- **Parallel-safe:** tests and builds take their own ports and temp dirs per run; no global one-at-a-time locks.

## Hard Gates

- Missing Loop-record = not ready. Use the PR-body template; a same-vendor review states its reason.

- Never merge with zero reviews. Waiting 15 minutes does not waive the review gate; merge only after at least one review and the required review conditions pass.
- Draft PRs silently skip bot reviews. Mark the PR ready before invoking reviewers.
- A green run on an older SHA is not green. Verify the PR head matches the latest pushed commit.
- Never merge with an unreplied CRITICAL, MAJOR, or HIGH finding.
- One clean review at headRefOid with required checks green may merge; round 2 only for BLOCKING findings; round 3 only by a lead exception written in the PR body (canon #9).
- On EtanHey repos, bot verdicts are comments, not formal self-reviews.
- Repo bot policy tightens the fleet default panel. Bugbot is opt-in only for daemon/engine/transport diffs.
- Cursor diff passes are read-only: findings only, never edit the PR branch. Routing: see `/agent-routing` § Routing rules (SSOT).
- `--body` on `gh pr merge` sets the MERGE COMMIT message, **not** the PR description.
- "git log is where you look when you already know something is wrong; the PR page is where you look to find out." Put actionable receipts in the PR body before merge.
- PR-referenced artifacts must be committed or quoted inline; gitignored `docs.local/` paths alone are not reviewable.
- R-010 keeps merge commits as the default until the commit-traceability condition is discharged in the canonical registry.
- Daemon/socket/MCP/protocol changes require a real client session at the feature-batch gate; unit tests, `socat`, and `curl` are insufficient. A live repo hook that enforces it per merge is never bypassed.
- Human-visible changes require builder-driven visual QA in a real running state at the feature-batch gate, or an explicit not-performed caveat.
- Heavy/e2e tests, real-client runs, visual QA and the release gate are never a per-PR pre-merge stop, except for a single-PR batch.
- Before a done/deployed/green claim, run the applicable false-green/deploy/QA gates and make the required live probe.
- Never place real client data in public PR text, fixtures, comments, or commit messages.
- Never delete a stacked PR's base branch before its children are retargeted and mergeable.
- Never merge or clean up from the linked worktree holding the active session.

## Decision Table

| Situation | Action |
|---|---|
| Brief says lead owns merge | Worker stops at reviewed PR handoff; lead verifies latest head before merge |
| Brief grants this seat merge authority | Complete review loop, merge with the required method, then verify and clean up |
| PR is draft | Run `gh pr ready <N>` before bot invocation |
| Review conflicts with design | Read the cited design and investigate; dismiss only with explicit evidence |
| XS/S PR, fast CI green at head, one clean routed review | Merge now (seat with merge authority); no wait for bots or heavy gates |
| PR touches daemon/socket/MCP/protocol | Merge on the size cadence; queue the real-client run for the feature-batch gate (run it now for a single-PR batch) |
| PR changes a visible surface | Merge on the size cadence; queue visual self-QA for the feature-batch gate (run it now for a single-PR batch) |
| Bot silent or rate-limited | Don't wait; record it unavailable in the PR body and proceed on the routed review |
| Release gate says `MERGED_UNRELEASED` mid-batch | Expected; keep merging the batch |
| Last PR of the batch merged | Run the feature-batch gate (heavy/e2e, real-client, visual QA, release gate to `CLEAN`) before any done claim |
| Linked-worktree merge cleanup fails | Verify whether the remote merge already succeeded before any retry |
| PR is stacked | Preserve the base branch until children are retargeted |
| Work stops before endpoint | Report stop-state and next turn; do not say done |

## Read the Relevant Reference

- Starting, stopping, or working under a lead? Read [references/dispatch-and-handoffs.md](references/dispatch-and-handoffs.md).
- Preparing commits, opening the PR, or sizing it? Read [references/pr-creation.md](references/pr-creation.md).
- Invoking reviewers, receiving feedback, or re-reviewing? Read [references/review-loop.md](references/review-loop.md).
- Merging, releasing, verifying, or cleaning up? Read [references/merge-and-verification.md](references/merge-and-verification.md).
- Deciding merge authority, method, or R-010 status? Read [Merge Authority](references/pr-creation.md#merge-authority).
- Writing any GitHub body/comment/review or commit trailer? Read [references/github-identity.md](references/github-identity.md).
- Need harness-specific commands or live-model provenance? Read the matching file under [adapters/](adapters/).

## Cross-Skill Routing

- `/agent-routing` § Routing rules (SSOT) owns the inner-loop reviewer and implementation routing.
- `/coderabbit` owns receiving-side review technique; this skill owns advancement through the PR loop.
- `/never-fabricate` owns verification receipts and claim discipline.
- `/deploy-verify` owns post-merge deployed/live proof.
- `/tdd-guard` enforces the repository's failing-test-first edit limit.
- `/false-green-gate` and `/qa-verdict-gate` flag their respective stop conditions (advisory).
