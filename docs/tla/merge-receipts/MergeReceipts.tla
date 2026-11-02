---------------------------- MODULE MergeReceipts ----------------------------
(* A guarded golems PR P merges while another lead's PR Q pushes or merges.
   Steps: the exact-head Mac receipt (local-run.sh), the ratchet check
   (check-comment.mjs), the lead's merge (pr-loop merge-and-verification.md),
   the post-merge live receipt (post-merge-live.mjs + live-rows.sh) with its
   token lease, and live-tier freshness with its 120-minute grace
   (live-freshness.mjs). README.md maps every action to its code.
   Each flag switches one fix (or one mutant) on or off:
     HeadBound      - the ratchet check needs receipt head = PR head (#689)
     MatchHead      - the merge refuses a head that moved since the lead saw green
     PinLease       - post-merge-live gets --lease-pr <the caller's own PR> (#1084)
     Status         - live/status.sh drift: "pre1063" counts every master commit,
                      "fx16" is #1063's line with the end-anchored parser,
                      "today" counts hook-loaded paths and parses behind= (#1071)
     GraceBound     - grace only within 120 minutes of the guarded merge (#1032)
     GuardHookPaths - guarded-paths.sh covers every hook-loaded path *)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS HeadBound, MatchHead, PinLease, Status, GraceBound, GuardHookPaths,
          QKinds,   \* the kinds of change Q may merge
          MaxPush   \* pushes per PR after its first head

Heads == 1..(MaxPush + 1)
\* "hooks": scripts/hooks/ (guarded and hook-loaded); "hookSkill": a hook's skill
\* root such as skills/golem-powers/model-pin-gate/ (hook-loaded, not guarded);
\* "docs": neither.
Kinds == {"hooks", "hookSkill", "docs"}
HookKinds == {"hooks", "hookSkill"}
GuardedKinds == IF GuardHookPaths THEN HookKinds ELSE {"hooks"}
PRs == {"base", "P", "Q"}
Stages == {"idle", "pinFetched", "updated", "leased", "reread", "statusFetched", "status", "token"}
Max(S) == CHOOSE x \in S : \A y \in S : y <= x
NoReceipt == [posted |-> FALSE, head |-> 0, ok |-> FALSE, truth |-> FALSE]
Idle == [stage |-> "idle", pinSeen |-> 0, lease |-> "none", leaseHead |-> 0,
         statusSeen |-> 0, statusOk |-> FALSE, truth |-> FALSE, tokenOk |-> FALSE]

VARIABLES pHead,      \* P's current head on GitHub
          pOpen,
          macRun,     \* head a running local-run.sh read (0 = none running)
          macReceipt, \* head in P's golems-ratchet-mac sticky verdict (0 = none)
          green,      \* heads whose ratchet check passed
          leadSaw,    \* head at which the lead saw green checks (0 = not yet)
          mergedHead, \* head GitHub merged
          macAtMerge, \* Mac receipt head at the moment of merge
          qHead,      \* Q's head on GitHub
          qLocal,     \* HEAD of Q's clean local worktree
          qOpen,
          master,     \* first-parent master: one [pr, kind] per merge
          hooksLive,  \* master index the hooks-live worktree is at
          recent,     \* master indices merged less than 120 minutes ago
          live,       \* the running post-merge-live for P
          receipts    \* golems-ratchet-live sticky verdict per merged PR

vars == <<pHead, pOpen, macRun, macReceipt, green, leadSaw, mergedHead, macAtMerge,
          qHead, qLocal, qOpen, master, hooksLive, recent, live, receipts>>
PFrame == UNCHANGED <<pHead, pOpen, macRun, macReceipt, green, leadSaw, mergedHead, macAtMerge>>
QFrame == UNCHANGED <<qHead, qLocal, qOpen>>
LiveVars == <<hooksLive, live, receipts>>

Init == /\ pHead = 1 /\ pOpen = TRUE /\ macRun = 0 /\ macReceipt = 0
        /\ green = {} /\ leadSaw = 0 /\ mergedHead = 0 /\ macAtMerge = 0
        /\ qHead = 1 /\ qLocal = 1 /\ qOpen = TRUE
        /\ master = <<[pr |-> "base", kind |-> "hooks"]>>
        /\ hooksLive = 1 /\ recent = {} /\ live = Idle
        /\ receipts = [x \in PRs |-> IF x = "base"
                         THEN [posted |-> TRUE, head |-> 1, ok |-> TRUE, truth |-> TRUE]
                         ELSE NoReceipt]

Behind(n) == {i \in (hooksLive + 1)..n : master[i].kind \in HookKinds}
Unserved == Behind(Len(master))

\* ---- P before the merge -------------------------------------------------
PPush == /\ pOpen /\ pHead < MaxPush + 1 /\ pHead' = pHead + 1
         /\ UNCHANGED <<pOpen, macRun, macReceipt, green, leadSaw, mergedHead, macAtMerge>>
         /\ QFrame /\ UNCHANGED <<master, recent>> /\ UNCHANGED LiveVars

\* local-run.sh: gh pr view reads the head, rows run for minutes, then
\* table.mjs upserts the sticky verdict for that head (--head "$INSTALL").
MacStart == /\ pOpen /\ macRun = 0 /\ macRun' = pHead
            /\ UNCHANGED <<pHead, pOpen, macReceipt, green, leadSaw, mergedHead, macAtMerge>>
            /\ QFrame /\ UNCHANGED <<master, recent>> /\ UNCHANGED LiveVars
MacPost == /\ macRun # 0 /\ macReceipt' = macRun /\ macRun' = 0
           /\ UNCHANGED <<pHead, pOpen, green, leadSaw, mergedHead, macAtMerge>>
           /\ QFrame /\ UNCHANGED <<master, recent>> /\ UNCHANGED LiveVars

\* ratchet.yml "Mac rows (required on guarded paths)" -> checkVerdict.
CheckAccepts == macReceipt # 0 /\ (HeadBound => macReceipt = pHead)
CIRun == /\ pOpen /\ CheckAccepts /\ green' = green \cup {pHead}
         /\ UNCHANGED <<pHead, pOpen, macRun, macReceipt, leadSaw, mergedHead, macAtMerge>>
         /\ QFrame /\ UNCHANGED <<master, recent>> /\ UNCHANGED LiveVars

LeadSeesGreen == /\ pOpen /\ pHead \in green /\ leadSaw' = pHead
                 /\ UNCHANGED <<pHead, pOpen, macRun, macReceipt, green, mergedHead, macAtMerge>>
                 /\ QFrame /\ UNCHANGED <<master, recent>> /\ UNCHANGED LiveVars

\* gh pr merge <N> --merge --admin merges the CURRENT head; --admin skips the
\* server's required-check gate, so only MatchHead re-checks the head.
Merge == /\ pOpen /\ leadSaw # 0 /\ (MatchHead => pHead = leadSaw)
         /\ pOpen' = FALSE /\ mergedHead' = pHead /\ macAtMerge' = macReceipt
         /\ master' = Append(master, [pr |-> "P", kind |-> "hooks"])
         /\ recent' = recent \cup {Len(master) + 1}
         /\ UNCHANGED <<pHead, macRun, macReceipt, green, leadSaw>>
         /\ QFrame /\ UNCHANGED LiveVars

\* ---- Q: another lead's PR with a clean worktree ---------------------------
\* Q's lane commits in its worktree, then pushes from it.
QCommit == /\ qOpen /\ qLocal = qHead /\ qLocal < MaxPush + 1 /\ qLocal' = qLocal + 1
           /\ PFrame /\ UNCHANGED <<qHead, qOpen, master, recent>> /\ UNCHANGED LiveVars
QPush == /\ qOpen /\ qLocal > qHead /\ qHead' = qLocal
         /\ PFrame /\ UNCHANGED <<qLocal, qOpen, master, recent>> /\ UNCHANGED LiveVars
\* gh pr update-branch, or a push from another checkout: the worktree stays behind.
QRemoteMove == /\ qOpen /\ qLocal = qHead /\ qHead < MaxPush + 1 /\ qHead' = qHead + 1
               /\ PFrame /\ UNCHANGED <<qLocal, qOpen, master, recent>> /\ UNCHANGED LiveVars
QMerge(k) == /\ qOpen /\ qOpen' = FALSE
             /\ master' = Append(master, [pr |-> "Q", kind |-> k])
             /\ recent' = recent \cup {Len(master) + 1}
             /\ PFrame /\ UNCHANGED <<qHead, qLocal>> /\ UNCHANGED LiveVars

\* More than 120 minutes pass.
Tick == /\ recent # {} /\ recent' = {}
        /\ PFrame /\ QFrame /\ UNCHANGED master /\ UNCHANGED LiveVars

\* ---- post-merge-live.sh --merged-pr P -----------------------------------
LiveFrame == PFrame /\ QFrame /\ UNCHANGED <<master, recent>>

\* install-hooks.sh --update --apply: selectedPin fetches origin master and
\* resolves origin/master; pinLive then moves hooks-live to that sha.
LivePinFetch == /\ ~pOpen /\ live.stage = "idle"
                /\ live' = [live EXCEPT !.stage = "pinFetched", !.pinSeen = Len(master)]
                /\ LiveFrame /\ UNCHANGED <<hooksLive, receipts>>
LivePin == /\ live.stage = "pinFetched" /\ hooksLive' = live.pinSeen
           /\ live' = [live EXCEPT !.stage = "updated"]
           /\ LiveFrame /\ UNCHANGED receipts

\* post-merge-live.mjs lease search: an open PR whose clean worktree is at its
\* exact head. "L" is an open PR the caller owns and does not move meanwhile.
LeaseChoices == IF PinLease THEN {"L"}
                ELSE {"L"} \cup (IF qOpen /\ qLocal = qHead THEN {"Q"} ELSE {})
LiveLease(l) == /\ live.stage = "updated" /\ l \in LeaseChoices
                /\ live' = [live EXCEPT !.stage = "leased", !.lease = l]
                /\ LiveFrame /\ UNCHANGED <<hooksLive, receipts>>

\* live-rows.sh: gh pr view reads the lease head (open or not), then dies
\* unless --lease-repo is at that head. Dying posts no receipt.
LeaseRemote == IF live.lease = "Q" THEN qHead ELSE 1
LeaseLocal == IF live.lease = "Q" THEN qLocal ELSE 1
LiveReread == /\ live.stage = "leased"
              /\ live' = IF LeaseLocal = LeaseRemote
                         THEN [live EXCEPT !.stage = "reread", !.leaseHead = LeaseRemote]
                         ELSE Idle
              /\ LiveFrame /\ UNCHANGED <<hooksLive, receipts>>

\* live-hooks-status: live/status.sh runs git fetch origin master, then
\* install-hooks --status counts drift against that fetched origin/master.
LiveStatusFetch == /\ live.stage = "reread"
                   /\ live' = [live EXCEPT !.stage = "statusFetched", !.statusSeen = Len(master)]
                   /\ LiveFrame /\ UNCHANGED <<hooksLive, receipts>>
DriftZero(n) == CASE Status = "pre1063" -> hooksLive = n
                  [] Status = "fx16"    -> FALSE
                  [] Status = "today"   -> Behind(n) = {}
LiveStatus == /\ live.stage = "statusFetched"
              /\ live' = [live EXCEPT !.stage = "status", !.statusOk = DriftZero(live.statusSeen),
                                      !.truth = (Behind(live.statusSeen) = {})]
              /\ LiveFrame /\ UNCHANGED <<hooksLive, receipts>>

\* live-human-confirm: hc-probe.py issues the token (step B) and feeds the
\* lease (step C); lead_scope allows each only while the lease PR is OPEN at
\* the leased head. Heads only advance and merges are final, so one check at C
\* gives the same verdict as checking at B and C.
LeaseStill == IF live.lease = "L" THEN TRUE ELSE qOpen /\ qHead = live.leaseHead
LiveToken == /\ live.stage = "status"
             /\ live' = [live EXCEPT !.stage = "token", !.tokenOk = LeaseStill]
             /\ LiveFrame /\ UNCHANGED <<hooksLive, receipts>>

\* table.mjs posts the golems-ratchet-live verdict at hooks-live's head.
LivePost == /\ live.stage = "token"
            /\ receipts' = [receipts EXCEPT !["P"] = [posted |-> TRUE, head |-> hooksLive,
                              ok |-> live.statusOk /\ live.tokenOk, truth |-> live.truth]]
            /\ live' = Idle
            /\ LiveFrame /\ UNCHANGED hooksLive

Next == \/ PPush \/ MacStart \/ MacPost \/ CIRun \/ LeadSeesGreen \/ Merge
        \/ QCommit \/ QPush \/ QRemoteMove \/ \E k \in QKinds : QMerge(k) \/ Tick
        \/ LivePinFetch \/ LivePin \/ \E l \in {"L", "Q"} : LiveLease(l) \/ LiveReread
        \/ LiveStatusFetch \/ LiveStatus \/ LiveToken \/ LivePost

Spec == Init /\ [][Next]_vars

\* ---- live-tier freshness (checkLiveFreshness + main) ---------------------
GuardedIdx == {i \in 1..Len(master) : master[i].kind \in GuardedKinds}
Valid(i, lo, hi) == LET r == receipts[master[i].pr]
                    IN r.posted /\ r.ok /\ lo <= r.head /\ r.head <= hi
Fresh == LET g == Max(GuardedIdx) IN
           \/ Valid(g, g, Len(master))
           \/ /\ g > 1 /\ (GraceBound => g \in recent)
              /\ LET pg == Max({i \in GuardedIdx : i < g}) IN Valid(pg, pg, g - 1)

\* ---- properties ----------------------------------------------------------
TypeOK == /\ pHead \in Heads /\ qHead \in Heads /\ qLocal \in Heads
          /\ pOpen \in BOOLEAN /\ qOpen \in BOOLEAN
          /\ macRun \in 0..(MaxPush + 1) /\ macReceipt \in 0..(MaxPush + 1)
          /\ green \subseteq Heads /\ leadSaw \in 0..(MaxPush + 1)
          /\ hooksLive \in 1..Len(master) /\ recent \subseteq 1..Len(master)
          /\ live.stage \in Stages
          /\ \A i \in 1..Len(master) : master[i].kind \in Kinds

\* A merge counts as receipted only if the Mac receipt's head is the merged head.
ReceiptMatchesMerge == ~pOpen => macAtMerge = mergedHead

\* A live receipt's verdict is the truth about the live install: PASS exactly
\* when hooks-live serves every hook-loaded change on the master its status
\* row fetched, whatever Q does.
LiveReceiptIsolated == receipts["P"].posted => receipts["P"].ok = receipts["P"].truth

\* Freshness PASS means hooks-live serves every hook-loaded master change,
\* except changes still inside their 120-minute grace.
NoFalseFresh == Fresh => Unserved \subseteq recent
=============================================================================
