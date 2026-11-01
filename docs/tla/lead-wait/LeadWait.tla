---------------------------- MODULE LeadWait ----------------------------
(* One PR, its owning lead and an optional orc fallback.
   Question: does a red or green PR that is not visibly held always get acted on?
   The three flags switch the 2026-11-01 fixes on and off:
     EndTurnCheck - the lead reads its open PRs before every turn ends (rule)
     Handoff      - a settle hands the PR's watch to a live lead (rule)
     Sentinel     - pr-sentinel nudges the owner, then moves the PR to orc (tool)
   A rule is only as good as compliance, so lead actions that skip a rule stay
   possible (and unfair) whenever the rule is off. *)
EXTENDS Naturals

CONSTANTS EndTurnCheck, Handoff, Sentinel

VARIABLES ci,      \* "pending" | "red" | "green"
          pr,      \* "open" | "merged"
          held,    \* TRUE when the PR is visibly held (draft + Held comment)
          thread,  \* "live" | "settled": the owner thread's state
          owner,   \* "lead" | "orc"
          wake,    \* a T3 watch wake or sentinel nudge is waiting for the owner
          nudges   \* sentinel nudges sent at this state

vars == <<ci, pr, held, thread, owner, wake, nudges>>

Actionable == pr = "open" /\ ci \in {"red", "green"} /\ ~held
Watched == thread = "live"

Init == ci = "pending" /\ pr = "open" /\ held = FALSE /\ thread = "live"
        /\ owner = "lead" /\ wake = FALSE /\ nudges = 0

\* CI finishes; a live watch delivers a wake (measured: delivery works).
CIFinish == /\ pr = "open" /\ ci = "pending"
            /\ ci' \in {"red", "green"}
            /\ wake' = Watched
            /\ nudges' = 0
            /\ UNCHANGED <<pr, held, thread, owner>>

\* The owner acts: fix (CI re-runs) or merge. Needs a live thread and a reason:
\* a wake, or, under EndTurnCheck or for orc (which follows the rule), any turn end.
CanAct == Actionable /\ Watched /\ (wake \/ EndTurnCheck \/ owner = "orc")
Act == /\ CanAct
       /\ IF ci = "red" THEN ci' = "pending" /\ UNCHANGED pr
                        ELSE pr' = "merged" /\ UNCHANGED ci
       /\ wake' = FALSE /\ nudges' = 0
       /\ UNCHANGED <<held, thread, owner>>

\* The defect: the lead takes the wake, decides "held" in its head, ends the turn.
SilentIgnore == /\ wake /\ owner = "lead"
                /\ wake' = FALSE
                /\ UNCHANGED <<ci, pr, held, thread, owner, nudges>>

\* A visible hold, and its later release.
Hold   == Actionable /\ Watched /\ held' = TRUE /\ wake' = FALSE
          /\ UNCHANGED <<ci, pr, thread, owner, nudges>>
Unhold == held /\ pr = "open" /\ held' = FALSE
          /\ UNCHANGED <<ci, pr, thread, owner, wake, nudges>>

\* Someone settles the lead thread while the PR is open. A handoff keeps a live owner.
Settle == /\ thread = "live" /\ owner = "lead" /\ pr = "open"
          /\ IF Handoff THEN UNCHANGED <<thread, owner, wake>>
                        ELSE thread' = "settled" /\ wake' = FALSE /\ UNCHANGED owner
          /\ UNCHANGED <<ci, pr, held, nudges>>

\* pr-sentinel: after a grace period, nudge the live owner once;
\* then (or at once for an orphan) move the PR to orc's live thread.
Nudge == /\ Sentinel /\ Actionable /\ ~wake /\ nudges < 2
         /\ IF thread = "live" /\ nudges = 0
               THEN /\ wake' = TRUE /\ UNCHANGED <<thread, owner>>
               ELSE /\ owner' = "orc" /\ thread' = "live" /\ wake' = TRUE
         /\ nudges' = nudges + 1
         /\ UNCHANGED <<ci, pr, held>>

Next == CIFinish \/ Act \/ SilentIgnore \/ Hold \/ Unhold \/ Settle \/ Nudge

\* Fair: CI, honest action and the sentinel. Not fair: ignoring, holding, settling.
Spec == Init /\ [][Next]_vars
        /\ WF_vars(CIFinish) /\ WF_vars(Act) /\ WF_vars(Unhold) /\ WF_vars(Nudge)

\* Every red or green PR that is not visibly held is eventually acted on or held.
Noticed == Actionable ~> (pr = "merged" \/ ci = "pending" \/ held)

TypeOK == /\ ci \in {"pending", "red", "green"} /\ pr \in {"open", "merged"}
          /\ held \in BOOLEAN /\ thread \in {"live", "settled"}
          /\ owner \in {"lead", "orc"} /\ wake \in BOOLEAN /\ nudges \in 0..2
=============================================================================
