# MergeReceipts bug paths

pstack `/statechart` drew these paths from the violating configs (TLC2 2.19, tla2tools 1.7.4).
Each config reaches more than the 500-state chart budget, so `/statechart` draws only bug paths. This
chart merges those paths into one picture. Every numbered state breaks a property. Red marks a path
today's master can still take; grey dashed marks a path a landed fix has closed. Each numbered state
lists its config and its fix below. Normal review and CI steps, P's own rows and Q's own receipts are left out.

```mermaid
stateDiagram-v2
  direction LR
  Open: P open, no Mac receipt
  Receipted: Mac receipt at P's head
  Older: Mac receipt at an older head
  Green: Lead saw green
  Moved: Green seen, then P pushed
  Bad1: 1 Merged at an unreceipted head
  Merged: Merged at the receipted head
  Updated: hooks-live pinned to the fetched master
  LeaseQ: Lease on Q's branch
  LeaseOwn: Lease on own PR
  Bad2: 2 Live receipt FAIL, install healthy (Q moved)
  Bad3: 3 Live receipt FAIL, install healthy (docs merge)
  Bad4: 4 Live receipt FAIL, install healthy (drift unknown)
  Pass: Live receipt PASS
  QHook: Q merged a hook skill change
  Bad5: 5 Freshness PASS, hook stale past grace
  [*] --> Open
  Open --> Receipted: local-run posts
  Open --> Older: P pushes during local-run
  Receipted --> Green: ratchet check passes
  Older --> Bad1: check passes with no head check, lead merges
  Green --> Moved: P pushes
  Moved --> Bad1: lead merges with --admin
  Green --> Merged: lead merges
  Merged --> Updated: post-merge-live fetches, then pins
  Updated --> LeaseQ: lease auto-picked [before #1092]
  Updated --> LeaseOwn: --lease-pr pinned [required since #1092]
  LeaseQ --> Bad2: Q merges or moves on, token denied
  LeaseOwn --> Bad3: Q merged docs after the pin fetch [drift counts every commit]
  LeaseOwn --> Bad4: rows run [behind= with end-anchored parser]
  LeaseOwn --> Pass: rows run [today]
  Open --> QHook: Q merges an unguarded hook path [before #1097]
  QHook --> Bad5: 120 minutes pass
  classDef bug fill:#ffecee,stroke:#e72e3b,stroke-width:2.5px,color:#cd2834
  classDef fixed fill:#f3f3f3,stroke:#8a8a8a,stroke-width:1.5px,stroke-dasharray:4 3,color:#555555
  class Bad1 bug
  class Bad2,Bad3,Bad4,Bad5 fixed
```

1. **ReceiptMatchesMerge**, two routes. `TodayMerge` (**current finding**, no fix yet): the lead saw
   green at H1, P pushed H2, and `gh pr merge --merge --admin` merged H2. The proposed fix is
   `--match-head-commit <the head seen green>`. `NoHeadBound` (a mutant): with no
   `verdict.head !== head` check, a receipt read at H1 passes H2's check. The head binding comes from
   [#689](https://github.com/EtanHey/golems/pull/689).
2. **LiveReceiptIsolated**, `TodayLive` before #1092: #1007's run 1. The lease went to
   [#1083](https://github.com/EtanHey/golems/pull/1083)'s branch, which moved and merged mid-receipt.
   [#1084](https://github.com/EtanHey/golems/pull/1084) documented `--lease-pr`, but the code still
   auto-picked a lease when that flag was omitted. Fixed by
   [#1092](https://github.com/EtanHey/golems/pull/1092) (merge `10cd7c56`), which makes `--lease-pr`
   required; `TodayLive` now passes.
3. **LiveReceiptIsolated**, `Pre1063`: drift counted every master commit. Fixed by
   [#1063](https://github.com/EtanHey/golems/pull/1063).
4. **LiveReceiptIsolated**, `FX16`: #1063's ` behind=` field met the end-anchored parser. Fixed by
   [#1071](https://github.com/EtanHey/golems/pull/1071).
5. **NoFalseFresh**, `TodayFresh` before #1097: a hook's skill root such as
   `skills/golem-powers/model-pin-gate/` was outside `guarded-paths.sh`. Fixed by
   [#1097](https://github.com/EtanHey/golems/pull/1097) (merge `ba06e290`), which guards every
   `hookDriftPaths()` dir; `TodayFresh` now passes. `NoGraceBound` (a mutant) still reaches the same
   state by removing the age check that came with [#1032](https://github.com/EtanHey/golems/pull/1032).

`AllFixes` passes all three properties (15,888 states). The chart proves no timing: "120 minutes
pass" is one step.
