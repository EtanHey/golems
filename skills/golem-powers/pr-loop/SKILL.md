---
name: pr-loop
description: "Invoke before any git/gh: open a PR, merge, ship, fix CI, handle reviews/comments, finish work. Signs: 🤖 model + harness line, Co-Authored-By."
---

# PR Loop

> Fleet law: canon #2 owns branch→commit→push→PR→review→merge and PR URL validity. This skill owns the procedural loop, review handling, edge cases, and worker-vs-lead endpoint mechanics.

## Kickoff contract

- **Claude seats:** invoke `/pr-loop` with the Skill tool before the first PR action of a lane: opening, updating, merging or shipping a PR, or fixing red CI. Make it the first tool call, before any git/gh/grep orientation: live misses open with `git status`/`gh pr` and never load the skill (PR15 trigger eval, 2026-10-19).
- **Codex seats:** read this SKILL.md body (a file read) before that action; Codex has no Skill tool.
- **A lead's kickoff brief** to a worker names the skills the worker invokes (`/large-plan`, `/agent-routing`, `/pr-loop`).
- Standing ask: "Once its PRs land, invoke the updated skills at the start of each plan, dispatch or PR action." (Etan 2026-10-18, via orc collab)
- Why: Claude T3 leads made 0 Skill calls on Oct 16–18 while all three lead skills sat in their catalog (skill-edits audit, 2026-10-18).

## Ownership

Who implements and who opens the inner-loop reviewer pane is owned by `/agent-routing` § Routing rules (SSOT). Never start that reviewer yourself unless that routing law makes you the owner.

Every Codex dispatch in this loop (short seats, no waiting inside a turn, no task that is only reading or running scripts or tests, effort caps, the daily count) follows `/agent-routing` § Codex seats.

This skill begins at branch preparation and ends at the authority-appropriate endpoint:

- Lead, when the endpoint permits merge: reviewed, latest-head-green PR merged, verified, root checkout fast-forwarded, and cleaned up; released/installed where applicable at the [feature-batch gate](references/merge-and-verification.md#feature-batch-gate), without asking Etan.
- Worker whose brief says the lead owns merge: ready-for-review PR, review responses addressed, URL handed to the lead, unmerged.
- A worker must hand the reviewed PR to its lead unmerged.

Run `scripts/ci/release-gate.mjs <repo>` at the feature-batch gate, not after every PR. At the batch endpoint, `MERGED_UNRELEASED`, `RELEASED_UNINSTALLED`, or `UNKNOWN` is a stop; release/install and rerun until `CLEAN`. A `MERGED_UNRELEASED` mid-batch is expected, not a stop: keep merging the batch.

## Full stop endpoint

Select **full stop** for a PR-workflow “full stop” command, an explicit no-merge request, or a third-party upstream base (for example, pingdotgg/t3code). Emphasis (“Full stop.”), quotations and questions about the phrase do not select it; read-only inspection does not start PR preparation.
This endpoint overrides generic ship/merge rules for every role and survives handoffs and watch wakes until the user explicitly changes it. Confirm the live PR base, not the fork remote; see [full-stop rules](references/full-stop.md).
Never merge, enable auto-merge, enqueue, push the default branch, or delegate those actions. Before work and each push, verify auto-merge/queue state; disarm only this account’s enrollment or our own PR’s setting we control, otherwise stop BLOCKED before a push that would merge.
Keep the normal proof, draft-first, lead-routed review and latest-head checks. Finish with **READY UNMERGED**, **WAITING FOR MAINTAINER APPROVAL** (only a verified upstream human-approval requirement remains), or **BLOCKED**; use the [readiness and handoff contract](references/full-stop.md).
Terminal readiness ends PR preparation unmerged; it is not a held draft or release/install/LIVE proof.

## Required Sequence

Keep these as four explicit turns:

1. Fix.
2. Commit, push, and open the PR as a draft; mark it ready only when the inner loop is done.
3. Babysit CI and reviews to green on the latest commit; answer findings and re-push.
4. Merge only when the dispatch authority permits it.

When stopping early, state the completed step, PR URL/state, and exact next turn. A DONE signal is not a receipt.

Run the loop in this order:

1. Confirm expected branch/worktree and sanitize repository state.
2. Implement under repository law and run the relevant tests.
3. Invoke `/never-fabricate`. Per-PR visual proof is required below; builder self-QA and real-client runs remain at the feature-batch gate.
4. Run the bounded local CodeRabbit pre-commit pass when available, then commit with the ratified identity trailer.
5. Push and open the PR as a **draft** (`gh pr create --draft`) with a signed body and exactly one
   `size:*` label (`scripts/ci/pr-size-labels.sh suggest` before opening, `compute` after; an L PR
   carries a `size-why:` line). In T3, immediately link every created/taken-over/pushed PR and every
   stack layer; linking does not arm a watch. The lead-routed other-vendor inner review runs on the
   draft, and CI runs locally (the repo's pre-push hooks and suites), so review bots stay quiet.
   When the inner reviewer APPROVEs and the local checks pass, run `gh pr ready <N>`. That flip
   starts the bots, once (Etan, 2026-11-01).
6. After the flip, apply the target repo's bot policy (never request a bot review by hand when the flip already triggered one), invoke allowed PR reviewers, and wait for evidence per the [waiting policy](references/review-loop.md#waiting-policy-no-polling-turns): T3 parent watch and its receipt first; bounded reads for a decision, one cheap watcher only outside T3, never a polling turn.
7. Every finding is labelled **BLOCKING** (correctness, security, data loss, a broken contract, a missing required proof) or **NON-BLOCKING** (everything else). Fix only BLOCKING findings and row NON-BLOCKING ones as follow-ups; reply to every CRITICAL/MAJOR/HIGH finding, push, and request re-review. A round with zero BLOCKING findings is an APPROVE, and NON-BLOCKING findings never open another round ([classify](references/review-loop.md#classify-each-review-comment)). **Every real bug you fix also gets a guard that stops its class coming back:** a lint rule, a ratchet row (repos with a ratchet table), a fail-first test on the real code (fails on base, passes on the branch), or, when the bug is about the order of events, a fail-first race test or a TLA+ property, chosen by the order-of-events row of [Pick the proof](#pick-the-proof). Name the guard in the PR body next to the Loop-record defect count. Skip it only for a concrete technical reason that none of these can catch this bug class; effort or time never counts. A finding in this PR's own change gets its guard in this PR. A defect found mid-PR outside its scope still opens a NEW PR with its fix and guard (canon #9), and the 2-review-round cap still holds (Etan, 2026-11-02, via orc: "we gotta implement this with more systems").
8. For every S-or-larger PR, after the routed inner-loop review and before exact-head merge checks, run the read-only Cursor diff pass once per head ([§8a.2](references/review-loop.md#8a2--the-cursor-diff-pass-is-read-only)); XS skips it. Use Cursor Auto (no model flag), findings only: never edit or push. This advisory bot-tier pass never replaces the routed reviewer. Answer every finding before merge; a real finding arriving after merge opens a NEW PR. Record `Cursor pass: head=<sha> findings=<count>` in the PR body, or `Cursor pass: unavailable (<reason>)` on errors/quota exhaustion and proceed without retrying or blocking. If this dispatch exhausted quota, name that dispatch as the cause.
9. An actual Bugbot usage/rate/spend-limit notice requires `Bugbot: unavailable (usage)` in the PR body, even on a routine PR where Bugbot was never requested. A GitHub `cursor[bot]` spend-limit notice is Bugbot activity, even on XS; record `Bugbot: unavailable (usage)`, never `Cursor pass: unavailable` for that notice. Also record an actually requested Bugbot that is unavailable. A routine XS/S/M PR with no Bugbot activity has no Bugbot step: no request, wait or body entry. Never wait or retry Bugbot. Confirm required checks and the routed review are green on `headRefOid`, then either hand off unmerged or merge.
10. After an authorized merge, verify the remote merge/content, fast-forward the root checkout ([Update Tracking](references/merge-and-verification.md#after-merge-update-tracking-mandatory)), and update tracking. For each resolved issue, run `gh issue view N --json state` (add `--repo owner/repo` for cross-repo issues); if still open, close it with a comment linking the merged PR. Then release/install/live-probe at the feature-batch gate, the deploy hop routed to `deploy-local-prod`. Before allocating, handing off, settling or retiring a workspace, read and follow the [workspace lifecycle contract](../_shared/lifecycle/CONTRACT.md); record REMOVED, RETAINED or acknowledged TRANSFERRED. End the merge comment or DONE report with the [CLEANUP RECEIPT](references/merge-and-verification.md#cleanup-receipt).

Every wait and PR-watch wake follows the [waiting policy](references/review-loop.md#waiting-policy-no-polling-turns).

## Merge Cadence (risk-sized)

The risk-sized rulings (Etan 2026-10-18, via orc collab), with the bot clarification below:

> **Merging:** small PRs merge right away on fast CI + 1 review. Heavy or e2e tests run per FEATURE BATCH (a full plan or feature change tested together), not per PR and not as a pre-merge gate.

> XS/S: 1 reviewer, 1 round.

> Full panel only for L, data or security paths, and that panel = [composition: `/agent-routing` § Routing rules (SSOT)].

**Bot clarification (2026-11-04):** Review bots (CodeRabbit/Bugbot) run only AFTER the inner loop, and they're advisory. Answer an already-posted bot finding like any finding; never await a bot or rate-limit recovery.

> Give each test/build its own ports and temp folders so they run in parallel.

| PR | Merge when (everything at `headRefOid`) |
|---|---|
| XS/S | Fast CI green + one clean review round from the routed reviewer (+ the Cursor endpoint pass for S, step 8) → merge promptly |
| M | Same, up to 2 rounds; round 2 only for BLOCKING findings |
| L, data or security paths | Full panel, same round cap |

Who reviews, how many, and the panel: `/agent-routing` § Routing rules (SSOT), which wins on conflict. Every size keeps the Hard Gates below: never zero reviews, exact-head green, no unreplied CRITICAL/MAJOR/HIGH finding, never a draft.

- **Fast CI** is the repo's required PR checks. Heavy/e2e suites, daemon real-client runs, visual self-QA and the release gate run at the [feature-batch gate](references/merge-and-verification.md#feature-batch-gate): before the batch is released, installed or declared done. A PR that alone ships to users is a single-PR batch and runs that gate itself.
- **Bots** run after the inner loop and are advisory. Record an unavailable bot only if it was actually requested or posted a usage notice; a never-requested, silent Bugbot needs no entry. Bots are never awaited. When a bot flags something important, answer it like any finding before merge. A real bot finding still gets fixed, in a NEW PR (canon #9) if it lands after merge.
- **Parallel-safe:** tests and builds take their own ports and temp dirs per run; no global one-at-a-time locks.

## Pick the proof

Before opening the PR, name the change kind and put its proof in the body. The proof that counts **could have failed on the old behaviour**: show the old state failing, not only the new one passing. A PR that touches two kinds owes both proofs. Unit tests count when they are that fail-first check; no test file is required per edit. Mock-green is not live-green.

| Change kind | Proof | Done when the body has |
|---|---|---|
| Prompt or instruction: skill text, CLAUDE.md/AGENTS.md rows, injected agent copy, tool descriptions | An eval table: the PR's text vs main's text on the same cases, run on the real agent ([/skill-creator](../skill-creator/SKILL.md) Core Loop, RED → GREEN). Include the cases meant to change, false triggers and an unchanged control. A sha256 byte pin, a token count, green unit tests or a reviewer approving the wording prove nothing about agent behaviour. | Pass counts per arm, n, model and cost; or `Proof: unmeasured: <reason>` |
| UI, static (layout, spacing, colour, copy, breakpoints) | Before/after screenshots per [Visual proof](#visual-proof), at desktop and 390 px plus the states the change is about (the breakpoint boundary, light/dark) | The visual-proof template filled with attached artifacts |
| UI, motion or timing (a one-frame flicker, a jump, a transition, scroll position) | A before/after recording plus a measurement per frame or step: frames showing the glitch, position or brightness per frame, or a real-browser test asserting the invariant (for example, the heading's offset stays put). Static screenshots cannot show a one-frame bug. | The recording in the GIF field and the measured numbers before and after |
| Audio or timing the user hears | Live verification in a real client: play it and write what was heard and when | The observed result; "not verified live" is a caveat, never a pass |
| Regression (a bug that came back, or could) | In a repo with a ratchet table (golems, skill-creator): a ratchet row through the real CLI, FAIL at the bug SHA and PASS at the fix SHA (`unit` rows never count). Elsewhere: a fail-first test on the real code with a real fixture, not a mock | The base failure output and the branch pass, or the row's FAIL/PASS SHAs |
| Order of events (races, interleavings, retries, rollback) | In-process race over a few states: a fail-first race test that forces the interleaving with a latch, gate or injected delay (no sleep-and-hope). A multi-phase procedure or protocol with concurrent actors and crash or rollback points, too many states to cover by test: a TLA+/TLC spec whose bug configs violate and fixed configs pass | Base failure and branch pass, or the TLC run with each config's expected result |
| Daemon, socket, MCP or protocol | A real client session on the real binary at the feature-batch gate; unit tests, `socat` and `curl` are insufficient | The real-client transcript |
| CI workflow or hosted tooling | One real run on the hosted service (a real push, a real posted comment) beyond the unit tests | The run link, or `unverified until rollout: <what>` |
| No behaviour change (docs, comments, typo, pure rename) | The repo's fast checks; nothing more | `Proof: none needed (no behaviour change)` |

## Visual proof

Etan, 2026-10-28, via orc/PHX: "the cloud reviewers get actual proof of changes when codexes are done so they can approve it on actual proof and not just hope that the code is correct ... spacing ... GIFs for each animation and stuff in PRs for verification."

Every visual PR requires before/after screenshots at desktop AND 390 px width,
one GIF per animation/interaction, and e2e screenshot diffs before merge.
**When you're done, close the browser you opened** (Etan, 2026-11-01: no background reaper; the skill closes it). Close your own tabs and quit any browser you started: agent browser → `page.close()` then `agent-browser release <lease>`; a headless or Playwright browser → `browser.close()`; T3 preview → `t3_preview_close`; a cmux browser pane → `close_surface`; a temporary browser profile → quit that instance. Never leave a window open on Etan's screen.
Use the [PR-body template](references/pr-creation.md#visual-proof-template).
Links must be reviewable GitHub attachments or committed files; ignored paths
alone are insufficient. Reviewers inspect and cite the artifacts; a review that
cites only code is INVALID and does not count as a round. Builder-driven real
running-session self-QA remains required at the feature-batch gate.
Routing: see `/agent-routing` § Routing rules (SSOT).

Enforcement: `visual` label OR changed paths in `scripts/visual-proof-globs.json`
triggers `scripts/visual-proof-check.mjs`. No skip label or env bypass exists.
Other repos wire the same validator in one line: `PR_BODY="$PR_BODY" PR_LABELS="$PR_LABELS" PR_CHANGED_FILES="$PR_CHANGED_FILES" node <pr-loop>/scripts/visual-proof-check.mjs` (labels are a JSON string array; files newline/NUL separated; adapt the committed glob list to the repo's surfaces).
Rollout to other repos is a follow-up; this change wires golems only.

## Hard Gates

- Never run `vercel deploy`/`vercel --prod`/`npx vercel`; Vercel deploys follow golems [standards/vercel-deploys.md](../../../standards/vercel-deploys.md) — only the deploy agent deploys, after `node scripts/vercel-budget.mjs` passes.

- **Local Docker / CI (Etan, 2026-10-27):** "don't replay GitHub CI with local Docker by default; push and let GitHub run it. CI running locally first may just make sense if it's faster iterations."
  A local Docker run must go through the golems repo's `scripts/docker/container-teardown.mjs` so containers are torn down (usage: the golems repo's `scripts/docker/README.md`).

- **One-way doors only:** "Nothing waits on Etan except true one-way doors: deleting data/creds/accounts, money, messaging people. Tags, releases, installs, deploys, upgrades ship without asking." (Etan 2026-10-19, via orc) A lead never stops for Etan before a tag, release, install, deploy or upgrade: it ships. Remote branch deletes and force pushes still need the `human-confirm-gate` token, because they delete data; that is a one-way door, so the two rules agree.
- **Leads never do ops themselves** (Etan 2026-10-19, via orc): the deploy hop goes to the `deploy-local-prod` sub-agent and mechanical checks and waits go to the mechanical tier outside native T3 PR waiting; the lead routes them and verifies the artifact. Tiers and quote: `/agent-routing` § Lead Topology #7.
- **Root checkout current:** "Leads keep the root checkout ff-only current after each merge." (Etan 2026-10-19, via orc) Why: root brainlayer sat 1,017 commits behind and its lead read stale instructions (bl-lead collab, 2026-10-19 21:06 IDT). Steps: [Update Tracking](references/merge-and-verification.md#after-merge-update-tracking-mandatory).
- Missing Loop-record = not ready. Use the PR-body template; a same-vendor review states its reason.

- Never merge with zero reviews. Waiting 15 minutes does not waive the review gate; merge only after at least one review and the required review conditions pass.
- Draft first, ready once: the inner loop runs on a draft and the PR flips to ready only after the
  inner reviewer APPROVEs and local checks pass. Bots are configured to skip drafts; a bot that still
  reviews drafts is a config bug to report to ci-hygiene, not a reason to skip the draft.
  Draft handling depends on effective bot settings, so check [Bots after the flip](#bots-after-the-flip)
  before relying on it. Never merge a draft.
- Avoid a duplicate manual bot request when an eligible current-head automatic review already exists;
  request only missing/stale evidence under the permitted bot policy.
- A green run on an older SHA is not green. Verify the PR head matches the latest pushed commit.
- Never merge with an unreplied CRITICAL, MAJOR, or HIGH finding.
- One clean review at headRefOid with required checks green may merge; round 2 only for BLOCKING findings; no round 3 (canon #9): after round 2 the lead verifies the final fixes, or the PR is split or parked.
- For merge-authorized endpoints, after a clean other-vendor review at `headRefOid` and green required checks, leads merge now with `gh pr merge <N> --merge --admin --match-head-commit <headRefOid you saw green>` on EtanHey repos (`--admin` skips required checks, so the head pin is what stops a later push merging unchecked), per [Merge Authority](references/pr-creation.md#merge-authority); omit `--delete-branch`. Workers follow their brief's merge authority. Never ask Etan to approve or merge a PR; only true one-way doors wait for him. Failing/pending checks, conflicts and unresolved findings block merge.
- On EtanHey repos, bot verdicts are comments, not formal self-reviews.
- Repo bot policy tightens the fleet default panel. Bugbot is opt-in only for an L PR or a very important/core-risk PR (daemon/engine/transport, security, release); never request it for routine XS/S/M PRs. Record `Bugbot: unavailable (usage)` in the PR body only when Bugbot was actually requested and is unavailable, or it posted a real usage/rate/spend-limit notice on this PR. An actual notice must be recorded even on a routine PR where Bugbot was never requested. Routine PRs with no Bugbot activity do nothing Bugbot-related. After an eligible request, run any owed Cursor endpoint pass, then continue to exact-head merge checks in the same turn: no "awaiting Bugbot", watch, grace period or re-review gate. Actual posted findings still follow the normal finding rules.
- Cursor diff passes are read-only: findings only, never edit the PR branch. Routing: see `/agent-routing` § Routing rules (SSOT).
- **Request Bugbot only on a ready PR.** Bugbot does not review a draft, even when it is mentioned there (Etan, 2026-11-10, via orc). For an eligible PR, run `gh pr ready <N>` first, then request it. A request posted while the PR was a draft does not count: request once after it is ready.
- **Never write that a review happened unless it exists** (Etan, 2026-11-10, via orc: a PR sat two days with a note saying a bot had reviewed it; the bot had skipped the draft). Before a PR body or comment says a bot or a reviewer reviewed, find that review or comment on the PR at the current head (`gh pr view <N> --json reviews,comments`). If it is not there, write what is true: `Bugbot: requested, no review yet`, or `unavailable (<reason>)`.
- `--body` on `gh pr merge` sets the MERGE COMMIT message, **not** the PR description.
- "git log is where you look when you already know something is wrong; the PR page is where you look to find out." Put actionable receipts in the PR body before merge.
- PR-referenced artifacts must be committed or quoted inline; gitignored `docs.local/` paths alone are not reviewable.
- R-010 keeps merge commits as the default until the commit-traceability condition is discharged in the canonical registry.
- Daemon/socket/MCP/protocol changes require a real client session at the feature-batch gate; unit tests, `socat`, and `curl` are insufficient. A live repo hook that enforces it per merge is never bypassed.
- Human-visible changes require builder-driven visual QA in a real running state at the feature-batch gate, or an explicit not-performed caveat.
- Heavy/e2e suites, real-client runs, builder visual self-QA and the release gate remain batch gates, except for a single-PR batch. Required visual proof artifacts and their e2e screenshot diffs are per-PR pre-merge stops.
- Before a done/deployed/green claim, run the applicable false-green/deploy/QA gates and make the required live probe.
- Never place real client data in public PR text, fixtures, comments, or commit messages.
- Never delete a stacked PR's base branch before its children are retargeted and mergeable.
- Never merge or clean up from the linked worktree holding the active session.

## Bots after the flip

ci-hygiene owns the bot config. This is what each bot does once a draft is marked ready
(2026-11-01). Where it says unverified, the first draft→ready PRs will settle it. Marking ready also
starts the heavy CI suites, which skip drafts in golems.

| Bot | After `gh pr ready` | What you do |
|---|---|---|
| CodeRabbit | Skips drafts; marking ready triggers its one review (vendor docs, verified 2026-11-01; ~8–9 min in our repos). On only in core repos (brainlayer, voicelayer), with no re-review per push. | Don't request it by hand after ready. Other repos: request `@coderabbitai review` only for a core-risk change. |
| Codex | Draft behavior unverified. | If it hasn't reviewed ~10 min after ready, comment `@codex review` once. |
| Copilot | Reviews only on request; automatic review is not enabled. | Don't request it. |
| Macroscope | Marking ready triggers a correctness check by design; set to manual-only, which should stop it (unverified). | Request it only for a core-risk PR. |
| Cursor diff pass | T3 `delegate_task` Cursor child (`providerInstanceId: "cursor", model: "default"`), one pointer brief, report to collab. Standard endpoint step for every S-or-larger PR after routed inner review; XS skips. | Once per head, Cursor Auto (no model flag), read-only findings only, before exact-head merge checks. Advisory; never replaces the routed reviewer. Answer findings and record `Cursor pass: head=<sha> findings=<count>`, or `Cursor pass: unavailable (<reason>)` and proceed on errors/quota exhaustion. See [§8a.2](references/review-loop.md#8a2--the-cursor-diff-pass-is-read-only). |
| Bugbot | Eligibility unchanged: runs only when mentioned for an L or very important/core-risk PR; routine XS/S/M PRs never request it. It ignores a mention on a draft. | Request once if eligible and available, after the PR is ready, unless current-head coverage exists, then run any owed Cursor endpoint pass and continue to merge checks immediately. Record `Bugbot: unavailable (usage)` in the PR body only for an actual request that is unavailable or a real usage/rate/spend-limit notice. An actual notice is recorded even without a request. Routine PR with no activity: no Bugbot action or body entry. Never wait, retry, watch or set "awaiting Bugbot". |
| Qodo, Greptile | Don't run automatically. | Request one only for a core-risk PR, per the repo's bot policy. |
| DeepSource, CodeQL | CI-style checks on every push. | Nothing. |

The 10-minute fallbacks above apply only while the PR is still blocked on something else anyway.
Never hold a merge for a bot: follow [Merge Cadence](#merge-cadence-risk-sized), and record an unavailable
bot only if it was requested or posted a usage notice. Never-requested Bugbot silence needs no record. A bot that reviews a draft anyway is a config
bug: tell ci-hygiene.

## Decision Table

| Situation | Action |
|---|---|
| Full stop selected (including a third-party upstream base) | Follow [full-stop rules](references/full-stop.md); no merge/auto-merge/queue/default-branch push, including on watch wakes |
| Full-stop proof, checks and review pass at the final head | Hand off READY UNMERGED; keep it ready, never merge or convert the terminal handoff to a held draft |
| Brief says lead owns merge | Worker stops at reviewed PR handoff; lead verifies latest head before merge |
| Brief grants this seat merge authority | Complete review loop, merge with the required method, then verify and clean up |
| PR is draft | Inner loop in progress: finish it, then `gh pr ready <N>`. Visibly held: follow the [waiting policy](references/review-loop.md#waiting-policy-no-polling-turns). Never merge a draft |
| Review conflicts with design | Read the cited design and investigate; dismiss only with explicit evidence |
| XS/S PR, fast CI green at head, one clean routed review (S: Cursor endpoint pass recorded, step 8) | Merge now (seat with merge authority); no wait for bots or heavy gates |
| PR touches daemon/socket/MCP/protocol | Merge on the size cadence; queue the real-client run for the feature-batch gate (run it now for a single-PR batch) |
| PR changes a visible surface | Require per-PR visual proof before merge; queue builder visual self-QA for the feature-batch gate (run it now for a single-PR batch) |
| Requested bot unavailable, or real usage notice posted | Never wait. For Bugbot, record exactly `Bugbot: unavailable (usage)` in the PR body only for an actual request or real usage/rate/spend-limit notice. Routine XS/S/M PR with no Bugbot activity: no request, wait, body entry or extra step; merge on the routed review |
| Release gate says `MERGED_UNRELEASED` mid-batch | Expected; keep merging the batch |
| PR merged; release + install pending; Etan away | Ship: tag, release, install now; route the hop to `deploy-local-prod` and verify its artifact. Never ask Etan |
| Remote branch delete or force push | `human-confirm-gate` token required (one-way door: deletes data) |
| Lead must deploy and probe a Mac | Dispatch `deploy-local-prod`; checks and waits go to the mechanical tier, not the lead |
| You just merged #N | Fast-forward the root checkout (`merge --ff-only`); report if it fails; re-read AGENTS.md/CLAUDE.md if they changed |
| You just merged a guarded golems PR (`guarded-paths.sh "<merge>^1" "<merge>"` exit 0) | After the root fast-forward, dispatch `scripts/ratchet/post-merge-live.sh --merged-pr N --lease-pr <your open PR>` to `deploy-local-prod` and verify its receipt URL and freshness PASS; exit 2 is a stop ([Update Tracking](references/merge-and-verification.md#after-merge-update-tracking-mandatory) step 1b) |
| Last PR of the batch merged | Run the feature-batch gate (heavy/e2e, real-client, visual QA, release gate to `CLEAN`) before any done claim |
| `BLOCKED` while `gh pr checks` is all green | A superseded run of a required check may still count: list and re-run it per [BLOCKED with every check green](references/merge-and-verification.md#blocked-with-every-check-green), re-check at the same head, then merge under Merge Authority (a ruleset-only self-review block never waits) |
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
- A PR opened by a worker on the other Mac (remote PR watch, settle): [agent-routing/references/cross-machine.md](../agent-routing/references/cross-machine.md) § 2 and § 4.
- `/coderabbit` owns receiving-side review technique; this skill owns advancement through the PR loop.
- `/never-fabricate` owns verification receipts and claim discipline.
- `/deploy-verify` owns post-merge deployed/live proof.
- Which proof each change kind owes: [Pick the proof](#pick-the-proof). Prove it the cheapest real way; mock-green is not live-green.
- `/false-green-gate` and `/qa-verdict-gate` flag their respective stop conditions (advisory).
