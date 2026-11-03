# Full stop: finish PR preparation

Full stop is an endpoint of `/pr-loop`, shared by workers, leads and successors.
It changes where the work ends; proof, review, signatures, size labels and the
Loop-record still follow the normal loop. It grants no force-push, deletion,
protection-bypass or messaging permission.

## Select and preserve the endpoint

Select it for a PR-workflow “full stop” command, a request to leave the PR
unmerged, or a third-party upstream base. A read-only inspection stays read-only.
Quoted text, discussion of the phrase and emphatic “Full stop.” do not select it.
An explicit no-merge constraint wins over a general ship request. Keep the
endpoint in the lane record and every handoff until the user changes it.

Identify the live PR’s base owner/repository. A fork’s origin, clean branch or
passing fork checks cannot establish upstream readiness or authority. The
EtanHey standing merge grant does not extend to pingdotgg/t3code or another
third-party base. A bare “full send” does not confer that authority. Changing
an upstream task to merge requires explicit task-specific upstream merge
authority and an account with that permission; respect upstream protections.

## Prevent automatic completion before changing anything

Never merge, enable auto-merge, join a merge queue, push the default branch,
or ask another agent to do any of those for this task.
For an existing task PR, inspect its auto-merge and queue state before work
and again before each push. Read `autoMergeRequest.enabledBy` and the current
account identity. Disable auto-merge or remove queue enrollment only when this
task’s account enabled it, or it is our own PR’s setting we control; read back
both states before proceeding and report changes. Use
`gh pr merge <N> --repo <base-owner/repo> --disable-auto` for an owned auto-merge
setting, then query the PR again. If a maintainer or another
account armed it on an upstream PR, do not override them: stop before code
changes or any push and report **BLOCKED: maintainer-armed auto-merge; a push
would merge**, naming the maintainer as permission owner. Unknown ownership or
inability to verify that automatic completion is off is also BLOCKED before
mutation. Touch only the assigned PR. Open a new PR as a draft without
automatic merging.

## Readiness at the final head

Run the usual draft inner loop and lead-routed other-vendor review. Mark ready
only after the inner reviewer approves and local checks pass, then apply the
target repository’s bot policy. Before handoff, read the current head, base,
open/closed state, draft flag, mergeability, required checks, routed review,
findings, auto-merge and queue state. Refresh proof/review for meaningful
changes; evidence from an earlier head cannot establish readiness.

- **READY UNMERGED:** open and ready, final-head proof/checks/routed review clean,
  findings handled, base and mergeability acceptable under the target policy,
  auto-merge disabled and queue absent.
- **WAITING FOR MAINTAINER APPROVAL:** the same evidence is clean, and the only
  remaining requirement is a verified upstream human approval. Name that
  requirement and maintainer; do not invent an approval gate on Etan’s repos.
- **BLOCKED:** any other missing proof, check, review, permission or unresolved
  conflict/finding. List each blocker and next owner. Draft or failing work
  cannot be called ready. If someone else merged or closed the PR, report its
  actual state instead of asserting it remains open. Full stop is exempt from
  review-loop’s “mark it held” path: report BLOCKED to the owner instead. Never
  convert an upstream PR to draft or post hold comments upstream.

## Watches, ownership and receipt

Workers never watch; hand pending CI/review and the no-merge endpoint to the
owning parent lead. That lead uses the existing waiting policy and retains the
endpoint on every wake. A green wake leads to readiness verification and
handoff, never merging. While checks/review are pending, retain their owned
wake source. At terminal handoff the watch owner unwatches.

An acknowledged ready or maintainer-approval handoff ends this task’s PR
ownership. It is intentionally ready and unmerged, exempt from the generic
held-draft and green-PR merge rules. A successor receiving unfinished work
must acknowledge custody and preserve no-merge; a sent pointer alone is not
acceptance. BLOCKED handoffs name the blocker and continuing owner.

Report URL, base repository, final head, verdict, proof, required checks,
routed reviewer outcome, remaining risks and next owner. Confirm open/unmerged
state at handoff. Keep the branch/worktree under the workspace lifecycle
contract and include `ROOT-FF STOP: not merged` in the cleanup receipt.
Completion here proves PR preparation only, with no release, installation,
deployment or LIVE claim.
