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
Max(S) == CHOOSE x \in S : \A y \in S : y <= x
NoReceipt == [posted |-> FALSE, head |-> 0, ok |-> FALSE, truth |-> FALSE]
Idle == [stage |-> "idle", lease |-> "none", leaseHead |-> 0,
         statusOk |-> FALSE, truth |-> FALSE, tokenOk |-> FALSE]

VARIABLES pHead,      \* P's current head on GitHub
          pOpen,
          macRun,     \* head a running local-run.sh read (0 = none running)
          macReceipt, \* head in P's golems-ratchet-mac sticky verdict (0 = none)
          green,      \* heads whose ratchet check passed
          leadSaw,    \* head at which the lead saw green checks (0 = not yet)
          mergedHead, \* head GitHub merged
          macAtMerge, \* Mac receipt head at the moment of merge
          qHead, qOpen,
          master,     \* first-parent master: one [pr, kind] per merge
          hooksLive,  \* master index the hooks-live worktree is at
          recent,     \* master indices merged less than 120 minutes ago
          live,       \* the running post-merge-live for P
          receipts    \* golems-ratchet-live sticky verdict per merged PR

vars == <<pHead, pOpen, macRun, macReceipt, green, leadSaw, mergedHead, macAtMerge,
          qHead, qOpen, master, hooksLive, recent, live, receipts>>

Init == /\ pHead = 1 /\ pOpen = TRUE /\ macRun = 0 /\ macReceipt = 0
        /\ green = {} /\ leadSaw = 0 /\ mergedHead = 0 /\ macAtMerge = 0
        /\ qHead = 1 /\ qOpen = TRUE
        /\ master = <<[pr |-> "base", kind |-> "hooks"]>>
        /\ hooksLive = 1 /\ recent = {} /\ live = Idle
        /\ receipts = [x \in PRs |-> IF x = "base"
                         THEN [posted |-> TRUE, head |-> 1, ok |-> TRUE, truth |-> TRUE]
                         ELSE NoReceipt]

Unserved == {i \in (hooksLive + 1)..Len(master) : master[i].kind \in HookKinds}

\* ---- P before the merge -------------------------------------------------
PPush == /\ pOpen /\ pHead < MaxPush + 1 /\ pHead' = pHead + 1
         /\ UNCHANGED <<pOpen, macRun, macReceipt, green, leadSaw, mergedHead, macAtMerge,
                        qHead, qOpen, master, hooksLive, recent, live, receipts>>

\* local-run.sh: gh pr view reads the head, rows run for minutes, then
\* table.mjs upserts the sticky verdict for that head (--head "$INSTALL").
MacStart == /\ pOpen /\ macRun = 0 /\ macRun' = pHead
            /\ UNCHANGED <<pHead, pOpen, macReceipt, green, leadSaw, mergedHead, macAtMerge,
                           qHead, qOpen, master, hooksLive, recent, live, receipts>>
MacPost == /\ macRun # 0 /\ macReceipt' = macRun /\ macRun' = 0
           /\ UNCHANGED <<pHead, pOpen, green, leadSaw, mergedHead, macAtMerge,
                          qHead, qOpen, master, hooksLive, recent, live, receipts>>

\* ratchet.yml "Mac rows (required on guarded paths)" -> checkVerdict.
CheckAccepts == macReceipt # 0 /\ (HeadBound => macReceipt = pHead)
CIRun == /\ pOpen /\ CheckAccepts /\ green' = green \cup {pHead}
         /\ UNCHANGED <<pHead, pOpen, macRun, macReceipt, leadSaw, mergedHead, macAtMerge,
                        qHead, qOpen, master, hooksLive, recent, live, receipts>>

LeadSeesGreen == /\ pOpen /\ pHead \in green /\ leadSaw' = pHead
                 /\ UNCHANGED <<pHead, pOpen, macRun, macReceipt, green, mergedHead, macAtMerge,
                                qHead, qOpen, master, hooksLive, recent, live, receipts>>

\* gh pr merge <N> --merge --admin merges the CURRENT head; --admin skips the
\* server's required-check gate, so only MatchHead re-checks the head.
Merge == /\ pOpen /\ leadSaw # 0 /\ (MatchHead => pHead = leadSaw)
         /\ pOpen' = FALSE /\ mergedHead' = pHead /\ macAtMerge' = macReceipt
         /\ master' = Append(master, [pr |-> "P", kind |-> "hooks"])
         /\ recent' = recent \cup {Len(master) + 1}
         /\ UNCHANGED <<pHead, macRun, macReceipt, green, leadSaw, qHead, qOpen,
                        hooksLive, live, receipts>>

\* ---- Q: another lead's PR with a clean worktree at its head --------------
QPush == /\ qOpen /\ qHead < MaxPush + 1 /\ qHead' = qHead + 1
         /\ UNCHANGED <<pHead, pOpen, macRun, macReceipt, green, leadSaw, mergedHead, macAtMerge,
                        qOpen, master, hooksLive, recent, live, receipts>>
QMerge(k) == /\ qOpen /\ qOpen' = FALSE
             /\ master' = Append(master, [pr |-> "Q", kind |-> k])
             /\ recent' = recent \cup {Len(master) + 1}
             /\ UNCHANGED <<pHead, pOpen, macRun, macReceipt, green, leadSaw, mergedHead,
                            macAtMerge, qHead, hooksLive, live, receipts>>

\* More than 120 minutes pass.
Tick == /\ recent # {} /\ recent' = {}
        /\ UNCHANGED <<pHead, pOpen, macRun, macReceipt, green, leadSaw, mergedHead, macAtMerge,
                       qHead, qOpen, master, hooksLive, live, receipts>>

\* ---- post-merge-live.sh --merged-pr P -----------------------------------
LiveFrame == UNCHANGED <<pHead, pOpen, macRun, macReceipt, green, leadSaw, mergedHead,
                         macAtMerge, qHead, qOpen, master, recent>>

\* install-hooks.sh --update --apply moves hooks-live to origin/master.
LiveUpdate == /\ ~pOpen /\ live.stage = "idle"
              /\ hooksLive' = Len(master) /\ live' = [live EXCEPT !.stage = "updated"]
              /\ LiveFrame /\ UNCHANGED receipts

\* The lease search, then live-rows.sh's own gh pr view of the lease head.
\* "L" is an open PR the caller owns and does not push during the receipt.
LeaseChoices == IF PinLease THEN {"L"} ELSE {"L"} \cup (IF qOpen THEN {"Q"} ELSE {})
LiveLease(l) == /\ live.stage = "updated" /\ l \in LeaseChoices
                /\ live' = [live EXCEPT !.stage = "leased", !.lease = l,
                                        !.leaseHead = IF l = "Q" THEN qHead ELSE 1]
                /\ LiveFrame /\ UNCHANGED <<hooksLive, receipts>>

\* live-hooks-status: live/status.sh fetches origin/master and parses drift=.
DriftZero == CASE Status = "pre1063" -> hooksLive = Len(master)
               [] Status = "fx16"    -> FALSE
               [] Status = "today"   -> Unserved = {}
LiveStatus == /\ live.stage = "leased"
              /\ live' = [live EXCEPT !.stage = "status", !.statusOk = DriftZero,
                                      !.truth = (Unserved = {})]
              /\ LiveFrame /\ UNCHANGED <<hooksLive, receipts>>

\* live-human-confirm: hc-probe.py step C; the token for the lease's old head
\* is denied once that branch has moved or merged (#1007's run 1).
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
        \/ QPush \/ \E k \in QKinds : QMerge(k) \/ Tick
        \/ LiveUpdate \/ \E l \in {"L", "Q"} : LiveLease(l)
        \/ LiveStatus \/ LiveToken \/ LivePost

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
TypeOK == /\ pHead \in Heads /\ qHead \in Heads /\ pOpen \in BOOLEAN /\ qOpen \in BOOLEAN
          /\ macRun \in 0..(MaxPush + 1) /\ macReceipt \in 0..(MaxPush + 1)
          /\ green \subseteq Heads /\ leadSaw \in 0..(MaxPush + 1)
          /\ hooksLive \in 1..Len(master) /\ recent \subseteq 1..Len(master)
          /\ \A i \in 1..Len(master) : master[i].kind \in Kinds

\* A merge counts as receipted only if the Mac receipt's head is the merged head.
ReceiptMatchesMerge == ~pOpen => macAtMerge = mergedHead

\* A live receipt's verdict is the truth about the live install: PASS exactly
\* when hooks-live serves every hook-loaded master change, whatever Q does.
LiveReceiptIsolated == receipts["P"].posted => receipts["P"].ok = receipts["P"].truth

\* Freshness PASS means hooks-live serves every hook-loaded master change,
\* except changes still inside their 120-minute grace.
NoFalseFresh == Fresh => Unserved \subseteq recent
=============================================================================
