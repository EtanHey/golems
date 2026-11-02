# MergeReceipts: does a guarded merge get a receipt that tells the truth?

`MergeReceipts.tla` models one guarded PR **P** merging while another lead's PR **Q** pushes or
merges. It covers P's exact-head Mac receipt, the merge, the post-merge live receipt with its
token lease, hooks-live moving to master, and live-tier freshness with its 120-minute grace.

Three properties, each one sentence of harm:

- **ReceiptMatchesMerge**: a merge counts as receipted only if the Mac receipt's head is the
  merged head. Otherwise code nobody measured on a Mac ships as "receipted".
- **LiveReceiptIsolated**: a live receipt says PASS exactly when hooks-live serves every
  hook-loaded master change, whatever Q does. Otherwise a healthy install reads red (or the reverse).
- **NoFalseFresh**: freshness PASS means hooks-live serves every hook-loaded master change, except
  changes still inside their 120-minute grace. Otherwise CI is green while the live hooks are stale.

## Results (TLC2 2.19, tla2tools 1.7.4, one worker, each config under 2 s)

| Config | What it switches | Property | Result | Real bug / fix |
|---|---|---|---|---|
| `TodayMerge` | today's master | ReceiptMatchesMerge | **violated: finding** | Mac receipt at H1, check green at H1, lead sees green, P pushes H2, `gh pr merge --merge --admin` merges H2. `--admin` skips the server's required-check gate, and the merge step has no `--match-head-commit`. No fix yet. |
| `MatchHead` | merge refuses a moved head | ReceiptMatchesMerge | passes | proposed fix for the finding above |
| `NoHeadBound` | mutant: no `verdict.head !== head` in `check-comment.mjs` | ReceiptMatchesMerge | violated | the stale-receipt class: local-run reads H1, P pushes H2, the H1 receipt passes H2's check. The head binding is [#689](https://github.com/EtanHey/golems/pull/689); tonight it correctly held #834/#1007/#1009 red on stale receipts. |
| `TodayLive` | today's master (`--lease-pr` required) | LiveReceiptIsolated | passes | Fixed by [#1092](https://github.com/EtanHey/golems/pull/1092) (merge `10cd7c56`): `post-merge-live.mjs` refuses to run without `--lease-pr` and leases only that PR, and pr-loop's merge step passes it. Before the fix this was a finding, [#1007](https://github.com/EtanHey/golems/pull/1007)'s run 1: the lease search auto-picked [#1083](https://github.com/EtanHey/golems/pull/1083)'s branch, which moved and merged mid-receipt (02:43Z), so the token was denied. Shortest path: lease on Q, Q merges, `live-rows.sh`'s reread still passes (`gh pr view` does not check that the PR is open), and `lead_scope` denies the token. |
| `PinnedLease` | `--lease-pr <own PR>` | LiveReceiptIsolated | passes | [#1084](https://github.com/EtanHey/golems/pull/1084)'s safe usage, required since #1092 |
| `Pre1063` | drift counted every master commit | LiveReceiptIsolated | violated | Q merges a docs change after hooks-live updates, so `drift=1` and the receipt fails. Fixed by [#1063](https://github.com/EtanHey/golems/pull/1063) (drift counts only hook-loaded paths). |
| `FX16` | #1063's ` behind=` line with the end-anchored `status.sh` parser | LiveReceiptIsolated | violated | FX16: `drift=unknown`, so every live receipt failed. Fixed by [#1071](https://github.com/EtanHey/golems/pull/1071). |
| `TodayFresh` | today's master | NoFalseFresh | passes | Fixed by [#1097](https://github.com/EtanHey/golems/pull/1097) (merge `ba06e290`): `guarded-set.mjs` derives the guarded set from `hookDriftPaths()`, and both `guarded-paths.sh` and `live-freshness.mjs` use it. Before the fix this was a finding: Q merges a change to a hook's skill root (for example `skills/golem-powers/model-pin-gate/`), `guarded-paths.sh` calls it unguarded, so pr-loop skips the post-merge step and freshness keeps accepting the older receipt: green after 120 minutes with that hook stale. 13 of the 17 `hookDriftPaths()` directories were outside the guarded set. |
| `GuardHookPaths` | guarded set covers every hook-loaded path | NoFalseFresh | passes | the fix #1097 landed |
| `NoGraceBound` | mutant: drop `age <= GRACE_MINUTES` | NoFalseFresh | violated | grace without its bound covers a stale install forever. The bound is [#1032](https://github.com/EtanHey/golems/pull/1032)'s. |
| `AllFixes` | all three fixes (#1092 and #1097 landed, `MatchHead` still proposed) | all three | passes | |

Probes confirm the passes are not vacuous. Under `AllFixes`, a merge, an ok live receipt, a
freshness PASS after the grace, and a master merge after the status row's fetch are all reachable.
Under the pre-#1092 `TodayLive` (`PinLease = FALSE`), the lease worktree drifting from its PR head
before `live-rows.sh` rereads it (a run that dies without a receipt) is reachable too.

## How the model maps to the code

| Action | Code |
|---|---|
| `MacStart`, `MacPost` | `scripts/ratchet/local-run.sh`: `gh pr view` reads `headRefOid`; `table.mjs --head "$INSTALL"` upserts the sticky `golems-ratchet-mac` verdict |
| `CIRun` | `.github/workflows/ratchet.yml` "Mac rows (required on guarded paths)" → `check-comment.mjs` `checkVerdict` |
| `LeadSeesGreen`, `Merge` | `skills/golem-powers/pr-loop/references/merge-and-verification.md`: green checks at `headRefOid`, then `gh pr merge <N> --merge --admin` |
| `QCommit`, `QPush`, `QRemoteMove` | Q's lane commits in its worktree and pushes from it; `gh pr update-branch` or another checkout moves the GitHub head while the worktree stays behind |
| `LivePinFetch`, `LivePin` | `post-merge-live.mjs` → `install-hooks.sh --host mbp --update --apply`: `selectedPin` fetches origin master and resolves `origin/master`, then `pinLive` moves hooks-live to that sha |
| `LiveLease` | `post-merge-live.mjs` lease search: an open PR (`gh pr list`) whose clean worktree is at its exact head, or only `--lease-pr` |
| `LiveReread` | `live-rows.sh`: `gh pr view` of the lease head (state unchecked), then `die` unless `--lease-repo` is at that head; a death posts no receipt |
| `LiveStatusFetch`, `LiveStatus` | row `live-hooks-status`: `scripts/ratchet/live/status.sh` runs `git fetch origin master`, then `install-hooks.mjs` `status()` counts `drift=` over `hookDriftPaths` against that fetched ref |
| `LiveToken` | row `live-human-confirm`: `scripts/ratchet/mac/hc-probe.py` steps B (issue via `scripts/golems-lead-confirm`) and C (the hook), each gated by `human-confirm-gate/hooks/tokens.py` `lead_scope`/`lead_metadata`: lease PR OPEN, unmerged, head = the leased sha |
| `LivePost` | `live-rows.sh` → `table.mjs --marker golems-ratchet-live --head "$LIVE_HEAD"` |
| `Fresh` | `live-freshness.mjs` `checkLiveFreshness` + `main`: latest guarded first-parent commit, `allowedHeads`, one prior receipt within `GRACE_MINUTES` |
| `Tick` | 120 minutes pass |

## What the model leaves out

- One run of each kind at a time. Two overlapping `local-run.sh` runs can overwrite a newer
  verdict with an older one; the head check makes that a false red, never a false pass.
- Q's own Mac and live receipts, conflicts, review, and every row other than the two live rows.
  The hooks themselves are assumed to work: a live row fails only for the reasons modeled.
- `installed-skill-parity` (report-only) and the M1 sync.
- By design, grace also covers a FAILED latest receipt for 120 minutes (`standards/ratchet.md`);
  that is not checked here.
- Time is one jump ("120 minutes pass"); there is no clock arithmetic. Each PR pushes at most once.
- Atomic steps the code splits more finely, with the reason each split cannot change a verdict:
  `live-rows.sh`'s `gh pr view` and its `--lease-repo` check (adjacent lines; a move between
  them only kills the run, with no receipt), and steps B and C of the token row (heads only
  advance and merges are final, so one check at C gives the same verdict).
- LiveReceiptIsolated judges a verdict against the master its status row fetched. A merge that
  lands after that fetch is left to the next receipt, and NoFalseFresh checks that freshness
  still catches it.

## Rerun

Every config, with the flags derived from today's code (from the repository root; see the
[verify skill](../../../.claude/skills/verify-merge-receipts/SKILL.md)):

```sh
python3 .claude/skills/verify-merge-receipts/verify.py
```

Or from this folder, one config at a time:

```sh
tlc -deadlock -workers 1 -metadir <scratch dir> -config TodayLive.cfg MergeReceipts.tla
```

`-deadlock` because the protocol has no end state. Keep `-metadir` outside the tree. Read
results with pstack `/statechart`; the committed bug paths are in [statechart.md](statechart.md).
