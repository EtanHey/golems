---
name: verify-merge-receipts
description: Verify guarded-merge receipts when changing scripts/ratchet/ (local-run.sh, post-merge-live, live-rows.sh, live/status.sh, mac/hc-probe.py, live-freshness.mjs, check-comment.mjs, guarded-paths.sh, guarded-set.mjs), install-hooks.mjs status/selectedPin, hookDriftPaths (hooks/hook-paths.mjs), scripts/hooks/manifest.json, scripts/golems-lead-confirm, human-confirm-gate's tokens.py (lead_metadata, lead_scope), or pr-loop's merge step. Rerun MergeReceipts and check its mapping to the source.
---

# Verify merge receipts

Three promises, checked by TLC over every order of events in a small model of P merging while
another lead's PR Q pushes or merges:

- **ReceiptMatchesMerge**: a merge counts as receipted only if the Mac receipt's head is the merged head.
- **LiveReceiptIsolated**: a live receipt says PASS exactly when hooks-live serves every hook-loaded
  master change, whatever another PR does.
- **NoFalseFresh**: freshness PASS means hooks-live serves every hook-loaded master change, except
  changes still in their 120-minute grace.

Breaking them ships unmeasured code as receipted, turns healthy installs red, or keeps CI green
on stale live hooks.

## Run from the repository root

Needs Python 3, Node, bash, Java 11+ and a `tlc` executable using tla2tools 1.7.4 (TLC2 2.19).

```sh
python3 .claude/skills/verify-merge-receipts/verify.py
```

The command takes about 15 s. It first derives today's flags from the code: `HeadBound`,
`MatchHead`, `PinLease`, `Status`, `GraceBound` and `GuardHookPaths`. Two are behavioural:
- `Status` comes from running the real `live/status.sh` on the real `status()` line template.
- `GuardHookPaths` builds a scratch commit for each real `hookDriftPaths()` dir. The commit is an
  unreferenced object with no ref and no working-tree change, touching one file in that dir. The
  real `guarded-paths.sh` must call that commit guarded. Freshness must also cover the dir: either
  `live-freshness.mjs` imports `guarded-set.mjs`, or (master's form) its inline `guardedAt` list does.

The other four are text probes. The three `Today*` runs use configs built from those flags.
`TodayMerge`, `TodayLive` and `TodayFresh` must pass when their fix flag (`MatchHead`, `PinLease`,
`GuardHookPaths`) reads TRUE, and are known findings otherwise. If the committed `Today*.cfg`
snapshots disagree with the code, the command prints a NOTE. It then runs every other config in
`docs/tla/merge-receipts/`, plus `TodayWithFixes`: today's flags with all three fixes switched on,
so a regression in any other flag fails it. Evidence goes to `docs.local/verify-merge-receipts/run-*/`.

- Exit 0: everything passes as expected.
- Exit 1: only known findings remain (master at the sync commit: `TodayMerge`, `TodayLive`,
  `TodayFresh`). Report them; never certify.
- Exit 2: source drift, an unexpected pass or violation, or a missing tool.

Missing tools fail; they are never skipped. See the [results table](../../../docs/tla/merge-receipts/README.md).

Read every result with pstack `/statechart`, including passes. It turns each violation into its
shortest path in plain words and draws the reachable states. Take its commands and tooling from
its own instructions. The committed [bug-path chart](../../../docs/tla/merge-receipts/statechart.md)
records today's paths.

## Coverage and synchronization

Source sync commit: `475763a465b9e8f12d9706b0ba7efdb71522e34e` (master).

| Model surface | Source coverage |
|---|---|
| `MacStart`, `MacPost` | `scripts/ratchet/local-run.sh` (head read, `table.mjs --head "$INSTALL"`), `lib.sh` `ratchet_post_mode` |
| `CIRun`, `HeadBound` | `scripts/ratchet/check-comment.mjs` `checkVerdict`; `.github/workflows/ratchet.yml` Mac rows step |
| `LeadSeesGreen`, `Merge`, `MatchHead` | `skills/golem-powers/pr-loop/references/merge-and-verification.md`: merge command and step 1b |
| `LivePinFetch`, `LivePin` | `scripts/ratchet/post-merge-live.mjs` update call; `scripts/hooks/install-hooks.mjs` `selectedPin()` (fetch, resolve `origin/master`), `pinLive()` |
| `LiveLease`, `PinLease` | `scripts/ratchet/post-merge-live.mjs` lease search (`--lease-pr`, `--lease-repo`) |
| `LiveReread` | `scripts/ratchet/live-rows.sh`: `gh pr view` of the lease head and the `--lease-repo` head check |
| `LiveStatusFetch`, `LiveStatus`, `Status` | `scripts/ratchet/live/status.sh`; `scripts/hooks/install-hooks.mjs` `status()`, `hookDriftPaths()`; `scripts/hooks/manifest.json` (which paths count as hook-loaded) |
| `LiveToken` | `scripts/ratchet/mac/hc-probe.py` steps B and C; `scripts/golems-lead-confirm` (issuer); `skills/golem-powers/human-confirm-gate/hooks/tokens.py` `lead_metadata()`, `lead_scope()`; row `live-human-confirm` in `rows.json` |
| `Fresh`, `GraceBound`, `GuardHookPaths` | `scripts/ratchet/live-freshness.mjs` (`checkLiveFreshness`, `main`, `guardedAt`); `scripts/ratchet/guarded-paths.sh`; `scripts/ratchet/guarded-set.mjs` once it exists; `scripts/hooks/manifest.json` (via `hookDriftPaths()`, in `install-hooks.mjs` or `scripts/hooks/hook-paths.mjs`) |

Before judging a change, diff these files against the sync commit and trace each changed step,
guard or ordering to a model action. The flag probes catch only the six facts they test, so a
plain pass does not prove that the rest of the model still matches. Move the sync commit forward
only after confirming that the model describes the code at the new commit. When a fix lands, its
`Today*` run turns into a required pass on its own. Then flip the flag in the three committed
`Today*.cfg` snapshots, which clears the NOTE, and update the README and the chart. Use `/maintain-formal-verification-skill`
to bring an old coverage record up to date.

## Real bug or modeling error

Replay the counterexample against the code, one action at a time, with fakes for GitHub and
the hooks. Never post a real receipt or issue a real token to verify. If the replay reproduces, the
bug is real: report it with its path, and do not weaken the property. A step the code cannot take,
a wrong atomic boundary (for example a lease read that the code repeats), or a flag probe that
reads the wrong line is a modeling error. Fix the model or the probe, keep the history and rerun
every config.

Scope: one P, one Q and one lease PR that the caller owns. Each PR pushes at most once, and one
local-run and one post-merge-live run at a time. Hooks are assumed to work. Time is the single
step "120 minutes pass". Row timeouts, parity, M1 sync, Q's own receipts and the grace covering a
FAILED receipt (by design) are not modeled.

To check that the command catches a real source change, save `scripts/ratchet/live/status.sh`,
put the FX16 end-anchored regex back (`drift=([0-9]+)$`) and rerun. It must exit 2 with
`TodayWithFixes` violating LiveReceiptIsolated. Restore the exact bytes in a `finally` block and
rerun to get exit 1 again. Never commit the scratch change.
