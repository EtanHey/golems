# MergeReceipts bug paths

pstack `/statechart` drew these paths from the violating configs (TLC2 2.19, tla2tools 1.7.4).
Each config reaches more than the 500-state chart budget, so `/statechart` draws only bug paths. This
chart merges those paths into one picture. Red states break a property. Each red state lists its
config and its fix below. Normal review and CI steps, P's own rows and Q's own receipts are left out.

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
  Updated --> LeaseQ: lease auto-picked
  Updated --> LeaseOwn: --lease-pr pinned
  LeaseQ --> Bad2: Q merges or moves on, token denied
  LeaseOwn --> Bad3: Q merged docs after the pin fetch [drift counts every commit]
  LeaseOwn --> Bad4: rows run [behind= with end-anchored parser]
  LeaseOwn --> Pass: rows run [today]
  Open --> QHook: Q merges an unguarded hook path
  QHook --> Bad5: 120 minutes pass
  classDef bug fill:#ffecee,stroke:#e72e3b,stroke-width:2.5px,color:#cd2834
  class Bad1,Bad2,Bad3,Bad4,Bad5 bug
```

1. **ReceiptMatchesMerge**, two routes. `TodayMerge` (**current finding**, no fix yet): the lead saw
   green at H1, P pushed H2, and `gh pr merge --merge --admin` merged H2. The proposed fix is
   `--match-head-commit <the head seen green>`. `NoHeadBound` (a mutant): with no
   `verdict.head !== head` check, a receipt read at H1 passes H2's check. The head binding comes from
   [#689](https://github.com/EtanHey/golems/pull/689).
2. **LiveReceiptIsolated**, `TodayLive` (**current finding**): #1007's run 1. The lease went to
   [#1083](https://github.com/EtanHey/golems/pull/1083)'s branch, which moved and merged mid-receipt.
   [#1084](https://github.com/EtanHey/golems/pull/1084) documents `--lease-pr`, but the code still
   auto-picks a lease when that flag is omitted.
3. **LiveReceiptIsolated**, `Pre1063`: drift counted every master commit. Fixed by
   [#1063](https://github.com/EtanHey/golems/pull/1063).
4. **LiveReceiptIsolated**, `FX16`: #1063's ` behind=` field met the end-anchored parser. Fixed by
   [#1071](https://github.com/EtanHey/golems/pull/1071).
5. **NoFalseFresh**, `TodayFresh` (**current finding**, no fix yet): a hook's skill root such as
   `skills/golem-powers/model-pin-gate/` is outside `guarded-paths.sh`. `NoGraceBound` (a mutant)
   reaches the same state by removing the age check that came with
   [#1032](https://github.com/EtanHey/golems/pull/1032).

`AllFixes` passes all three properties (15,888 states). The chart proves no timing: "120 minutes
pass" is one step.
