# post-merge-live needs a stable lease PR

Status: observed 2026-11-02 (ci-hygiene lead). The fix is a follow-up; this note documents today's safe usage.

## What the lease is
`scripts/ratchet/post-merge-live.sh --merged-pr N` runs the LIVE rows after a guarded merge. The
`live-human-confirm` row proves the installed human-confirm hook with a real lead token. That token is
issued against a **lease**: an OPEN PR that has a clean local worktree on its branch at the PR's exact head
(`post-merge-live.mjs`, the lease search before `live-rows.sh`). With no `--lease-pr`, the script picks the
first open PR whose worktree matches.

## What went wrong (2026-11-02, golems #1007)
- Run 1 auto-picked another lead's open PR branch (`docs/collab-monitor-lead-watches-collab`, #1083). That
  branch was pushed and merged while the receipt ran, so the token issued for the old head was denied:
  `live-human-confirm` step C = DENY, receipt `ok=false` (1/3).
- Run 2: that PR was merged, so no open PR had a matching worktree: `no valid lease: need an OPEN PR with a
  clean local worktree on its branch at its exact head`.
- Run 3, pinned with `--lease-pr 1079 --lease-repo <that PR's own clean worktree>`: 2/3 + parity WARN, PASS.
  #1007's code was never at fault.

## Safe usage until the fix lands
- Always pin the lease to a PR **you own** and won't push during the receipt:
  `scripts/ratchet/post-merge-live.sh --merged-pr N --lease-pr <your open PR> --lease-repo <its clean worktree>`.
- Never let it auto-pick: another lead's branch can move mid-receipt.
- The lease PR can't be the PR you just merged; it has to still be open. If you have none, open a small
  draft PR for real follow-up work and use that.
- The row only checks a force-push command against the hook. It never runs the push, so the lease PR is
  not modified.

## Options considered
1. **Keep the auto-pick, document pinning** (this note): zero code risk tonight, but relies on leads reading it.
2. **Require `--lease-pr`**: the error names the flag. A small code change; every caller passes its own PR.
3. **Auto-pick only the caller's own PRs** (by author or a lane label): keeps the convenience, but "own" is
   ambiguous when every PR's author is EtanHey.

Decision: 1 now, 2 as the follow-up. Rationale: option 3's ownership signal doesn't exist (all PRs share one
GitHub author), and an explicit flag is the cheapest way to make the receipt deterministic.

## Follow-up (the fix)
`post-merge-live.mjs` should not fall back to an arbitrary open PR. It should require `--lease-pr`, or limit
the auto-pick to PRs the caller owns, and say so in the error.
