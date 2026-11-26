# Merge gate: nothing merges red

Status: decided 2026-11-26 (golems-green lane, PR #1369), on the owner's ask that nothing merges red.
Changes 1 and 3 are in PR #1369. Change 2 (the ruleset) is **not applied yet**: the agent's `gh api -X PUT`
was refused by a PreToolUse hook ("changing repo settings can't be undone, so Etan has to approve it"), so it
waits for Etan. The ruleset rows wait for it too (see change 3).

## The rule

A PR cannot merge into master while the latest guarded master merge has no passing live receipt.

## Why it was needed

Between 24 and 26 Nov the live tier sat red for 48 hours. Three holes let merges through:

1. **Admin override.** Ruleset `master: core checks + PR` (id 23948189) listed the admin role as a
   bypass actor (`bypass_mode: always`). Every agent merges with the same EtanHey token, which is
   admin, and /pr-loop merged with `gh pr merge --admin`. So #1348 merged with its required
   `ratchet` check CANCELLED (rule suite `result=bypass`).
2. **Stale green.** `strict_required_status_checks_policy` was false. A PR whose `ratchet` ran green
   stayed mergeable after master gained a guarded merge with no receipt.
3. **PR-time grace and exemption.** `live-freshness.mjs` exempted non-guarded PRs and gave a new
   guarded merge 120 minutes' grace, accepting the previous receipt. #1357 merged inside #1348's
   grace.

## The three changes

1. **PR-time freshness is strict** (`scripts/ratchet/live-freshness.mjs`). With PR scope
   (`RATCHET_PR_BASE`/`RATCHET_PR_HEAD`, the PR-time `live-tier-freshness` row) there is no
   non-guarded exemption and no grace. The latest guarded master merge needs its own exact-head
   all-PASS receipt now. Master pushes, manual dispatch and the hourly schedule keep the 120-minute
   grace, so the alert cadence is unchanged. The FAIL line names the merged PR and the
   `post-merge-live.sh --merged-pr N --lease-pr <your open PR>` command.
2. **Ruleset 23948189** gets `bypass_actors: []` and `strict_required_status_checks_policy: true`.
   Every other rule and required check stays unchanged. Apply it with `gh api -X PUT` from a fresh
   GET, changing only those two fields (the exact diff is in PR #1369's body). Then a PR must be up
   to date with master, and every required check must pass, for everyone, including the admin token.
3. **A check that it stays tight.** GitHub returns `bypass_actors` only to a caller who can edit
   the ruleset; an Actions run showed the workflow `GITHUB_TOKEN` gets no such key. So:
   - ratchet `ci` row `ruleset-strict` checks what `GITHUB_TOKEN` can see (active, `ratchet`
     required, strict) and prints that it did not check bypass actors;
   - ratchet `live` row `ruleset-tight` runs under the lead's admin token after each guarded merge
     and also requires `bypass_actors: []`. If it fails, the receipt is `ok: false`, and step 1
     blocks every PR.
   The script (`scripts/ci/ruleset-tight.mjs`, `--visible` for the CI form) is in PR #1369. The two
   rows join only after change 2 is applied: before it, `ruleset-strict` FAILs, and the local
   pre-push ratchet correctly refuses to push a guarded branch carrying a red CI row.

## When the gate deadlocks

The gate can lock itself: if the live receipt cannot pass until a code fix merges, no PR can merge,
including the fix. The way out is Etan's alone, in GitHub Settings → Rules → Rulesets →
`master: core checks + PR`: add the Repository admin role to the bypass list, merge the fix, then
remove the bypass again. `ruleset-tight` stays red while the bypass is present, so a forgotten
removal shows up on the next receipt. Agents never re-add the bypass themselves.

## Why not T3 project folders or local hooks

T3's project folders decide which directories a thread can see and run git in. T3 never talks to
GitHub's merge API and has no merge gate. Every agent merges through `gh` with the one EtanHey
token, and some seats (Codex, Antigravity) run without our hooks. Only GitHub can refuse a merge:
its ruleset and required checks.

## Verification

- `scripts/tests/ratchet-live-freshness.test.mjs`: real git history with only `gh` stubbed. PR scope
  with a 5-minute-old unreceipted guarded merge FAILs (master's code: PASS by grace); a non-guarded
  PR with an unreceipted guarded merge FAILs (master's code: PASS by exemption); without PR scope
  the grace still passes inside 120 minutes and fails after.
- `scripts/tests/ruleset-tight.test.mjs`: the pre-change ruleset fails on both holes; a hidden
  `bypass_actors` fails closed unless `--visible`.
- Live, pending the ruleset change: `gh pr merge --merge --admin --match-head-commit` on a throwaway
  PR with a red `ratchet` must be refused.
