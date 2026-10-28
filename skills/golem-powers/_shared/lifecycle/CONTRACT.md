# Workspace lifecycle contract

Status: shared instruction contract; runtime enforcement requires separately verified adapters.
Read before allocating, handing off, settling or retiring a workspace. This is the single home for ownership, consumers, preservation, terminal dispositions and recovery. Provider adapters supply mechanics; they cannot waive these gates.

## Creation and ownership

Persist a lease atomically before allocation; persistence failure means no allocation. Record stable request/lease ID and generation, host/environment, registered project, parent-task owner, allocator, resource kind, expected deliverables and artifact owners. Bind returned task/thread IDs and exact path/base/branch/HEAD after provisioning; an acknowledgment alone does not prove allocation completed.

Distinguish created, borrowed/reused and unknown resources. Only an exactly attributed created resource can qualify for retirement under its lease. Worktrees use canonical Git common-dir and filesystem identity; clones have separate leases; non-git lane directories use host/filesystem identity. Retiring a worktree never retires its parent clone. Existing unknown inventory is report-only; never infer ownership from age, names or clean status. The root checkout and another lane's root leftovers are never targets.

Scope authority to the exact operation, paths and containment plan; reuse existing authorization for that same scope. Inventory, upload, local-copy removal and workspace retirement are separate operations. Creation does not confer ownership of later personal or unknown contents. Link parent/child resources and artifact pins; holds propagate to the parent, and each affected local-copy disposition needs a linked receipt. Keep M4 Max and M1 Pro host identities and evidence separate.

## No temporary source clones

Etan's rule, verbatim (via PHX, 2026-10-27): "I hope that when we put the rule of not making those and doing everything much more. Safely, basically. would be better. Um, Like actually the leading work trees and making work trees the way to do the copies of repos and run them and deb and all that."

**PHX reading:** NO full temp clones of a repo. Every source working copy for release, verify, test or dev runs must be a registered worktree with an owner and a terminal state: `<repo>/.worktrees/<short>` or a T3 `isolation:"worktree"` child. The owner remains responsible for cleanup under this contract's consumer and terminal-boundary gates.

Banned substitutes: `git clone`, `git init` + bundle import, a directory copy, archive-extract, and any hidden `~/.<name>` copy of a repo. Existing clones remain subject to preservation and disposition gates; this law does not authorize their deletion.

Runtime and scratch directories (sockets, HOME, state, caches) are NOT worktrees. They need their own owned lane directory and their own disposition under the scratch rules below.

[Tmp-block](../../tmp-block/SKILL.md) covers worktree paths but not independently initialized repos; the no-clone law is text-enforced until a guard exists.

## Consumers and terminal boundary

Track implementer, reviewer, provider session, active/streaming task, terminal, test process, durable handoff and live reference consumers. DONE, cancel, settle and pane close release only their own consumer; they never release another consumer or an artifact pin. Open review keeps its consumers until released or acknowledged by the successor.

The owning lead harvests and verifies deliverables, records consumer releases, then transfers acknowledged custody or records a retained obligation, and only THEN settles when these gates permit. Settling is deletion-relevant: T3's hourly cleanup removes eligible settled worktrees. Releasing a provider and removing its checkout are separate outcomes. If supported official cleanup cannot honor preservation, record RETAINED with owner and the runtime limitation; do not settle to tidy a list. This text proves no guard coverage for unwrapped UI, shell or remote paths; never alter a live app database to bypass it.

Etan's rule is verbatim: "the implementer removes its worktree at DONE" (Etan 2026-10-18, via orc collab). **PHX reading, consistent with canon #2/#9:** DONE = the merged PR; retirement follows after the merge, once its last consumer releases, and the worktree is never left behind. The parent/authorized collector performs removal for the implementer. A RETAINED receipt keeps that owner's obligation open until every gate passes; a merged PR alone grants no deletion authority.

## Preservation and races

For a worktree or clone, require fresh exact remote Git coverage and a clean tree before retirement. A non-Git lane directory uses its host/filesystem identity and artifact-preservation proofs. Use the verified PR base remote (registered project remote for a non-PR lane). Verify HEAD against that remote's branch; if auto-deletion removed it, use that remote's actual default branch: for an origin-backed base, **HEAD is an ancestor of origin/<default>, plus a clean tree**; an upstream-backed base uses `upstream/<default>`. Never substitute fork-origin coverage for upstream proof. Squash merges require separately verified content coverage; never invent ancestry from a merged PR at another head.

Inventory tracked changes, untracked and ignored files at every relevant level, nested repositories/submodules, refs and local-only history. Ignored status does not establish regenerability: ignored `docs.local` is always preserved until its applicable harvest, preservation and exact local-copy retirement gates pass. Preserve live symlink consumers, active-thread paths and hook/skill sources; retain existing managed-root and GC protections.

Archives, manifests, custody ledgers and recovery receipts must survive outside the whole retiring scope. `<persistent-root>/docs.local/worktree-archive/<lease-id>/` is LOCAL preservation staging, not a permanent store. Require a per-file SHA manifest (host/resource/lease, paths, sizes/hashes, held/omitted material), container size/hash readback, membership/readability checks and Git-ref preservation. A manifest alone grants no deletion. Verify full uploaded object bytes, membership and a restore drill before deleting an artifact's local original; metadata/sample checks are insufficient. Cloud bytes never substitute for Git coverage.

[Drive-filing](../../drive-filing/SKILL.md) owns taxonomy, durable-original destinations, archival mechanics and byte proofs; [research-lifecycle](../../research-lifecycle/SKILL.md) owns semantic freshness. A local-files adapter supplies artifact plans/pins, not another lifecycle authority. Never force-upload credentials or private data to make a parent eligible. Rollup, archive and DONE are not deletion authority.

Serialize by exact host/resource identity, including ancestor/descendant operations. Immediately before removal, recheck generation, canonical path/ancestors, common-dir where applicable, refs/content, pins and every consumer. Changed identity, an uncontrolled writer or incomplete evidence means RETAINED.

## Prohibitions and scratch

- No `--force` removal. No broad `git worktree prune`: it drops temporarily absent KEEP registrations; see [worktree-gc.sh](../../../../scripts/worktree-gc.sh).
- No child self-rm: a child never removes its own cwd, ancestor, worktree or task scratch, even after `cd`. Claude Code's built-in “Dangerous rm operation on working directory or its ancestor” prompt stalls non-interactive children even under bypass. Only the lifecycle guard or an authorized external collector retires from outside every retiring resource; changing Git's `-C` does not release the caller's session.
- Never delete unknown, borrowed, shared or other-lane data. Never widen GC or introduce a global reaper to bypass a hold.

Direct checkout scratch goes in `<repo>/.worktrees/<name>`; official managed allocations stay adapter-owned. File scratch goes in `<persistent-repo-root>/docs.local/scratch/<unique-lease-or-task-id>/`, OUTSIDE the child's worktree and any other workspace subtree scheduled for retirement. The scratch resource may later be retired by the authorized collector under its own recorded disposition and the same gates. Bind host, literal path, owner, expected outputs and consumers before use; non-git lanes use a registered persistent artifact root. Choose another registered surviving root or retain if that root will retire. The lead owns harvest and disposition; a scratch directory's name or age grants no deletion permission.

Ordinary scratch never goes in `/tmp`. [Tmp-block](../../tmp-block/SKILL.md) enforces placement where its guard is installed and verified. Its narrow session-scoped harness scratchpad exception is separate: only the exact sanctioned harness scratchpad shape, nothing durable, no permission for ordinary temp writes. Do not claim Codex enforcement from wiring alone.

Test runners' own ephemeral OS-tmpdir fixtures (`mkdtemp`) are not agent scratch. Never redirect a test run's TMPDIR into a persistent tree; hermetic tests assume no .env or other ancestors there.

Never generically reap active/pinned/adverse/recovery evidence, latest, partial, unharvested or timeless research, custody ledgers/manifests/receipts that are the only preservation proof or have dependent references, credentials, private/unknown/unscanned contents, runtime/DB/app/release/hook/skill state or originals lacking verified preservation. Keep a lightweight local ledger pointer after archival; relocation or compaction must preserve its reference chain outside the retiring scope. Exact owner-authorized local-copy retirement still needs every applicable gate; remote durable originals are outside generic cleanup scope.

## Receipt and recovery

Record exactly one current disposition, with durable owner and exact resource identity:

- **REMOVED:** capture the remover's return code directly, before any later command can mask it; require zero, a fresh successful Git-registration read showing absence for a worktree, AND fresh physical absence (`lstat`, not an inaccessible path). Clones/directories need their kind-specific identity and physical proof. Record the branch outcome separately.
- **RETAINED:** record reason, owner, holds and next obligation, including missing evidence, failed removal, unavailable host or unresolved consumers. Registration absence alone cannot dispose of a remaining directory.
- **TRANSFERRED:** successor acknowledgment names the same exact resource, artifacts, pins and receipts. A proposed owner or sent message without acknowledgment stays RETAINED.

Existing CLEANUP RECEIPT field lines remain valid; these dispositions define their meaning, not a new parser syntax. Append adverse attempts and immutable operation IDs/generations; never overwrite them. A later valid receipt references earlier failures.

At the next bounded dispatch/close pass, reconcile unresolved leases against exact creation provenance and fresh state. An unreachable host is RETAINED, not absent; ambiguous ownership stays unknown. Recovery after interrupted removal still needs the original remover result and both fresh absence checks. No age-only eligibility, recurring destructive job, HOME-wide prune or retries to erase adverse evidence.

## Parent retirement path (both harnesses, interim)

For a T3 child or cmux worker, run this only in the parent from outside the worktree, after merge and the last consumer's release. The parent must first verify this contract's exact ownership/authority, complete inventory/preservation, managed-root policy and consumer gates; record that preflight outside the retiring scope. Hold the exact resource lock across the final preflight and this block; an uncontrolled writer means RETAINED. A file's mere presence is not authority. This is an interim final-action procedure, not a replacement lifecycle guard or permission to bypass an official adapter's refusal.

Supply canonical `MAIN` (persistent checkout), `WT`, `EXPECTED_HEAD`, verified `BASE_REMOTE`/`DEFAULT`, and `PREFLIGHT_RECEIPT` (the parent-verified preflight record). No child runs this block, even after changing cwd. Until the guard's machine receipt is adopted, use the interim receipt below; keep failed attempts and the preflight outside the retiring scope.

```bash
(
  set -u
  : "${MAIN:?}" "${WT:?}" "${EXPECTED_HEAD:?}" "${BASE_REMOTE:?}" "${DEFAULT:?}" "${PREFLIGHT_RECEIPT:?}"
  keep() { printf 'worktree: %s kept because %s; escalated to parent owner\n' "$WT" "$1"; }
  MAIN=$(cd "$MAIN" && pwd -P) || exit 1
  WT=$(cd "$WT" && pwd -P) || exit 1
  case "$(pwd -P)/" in "$WT/"*) keep 'caller is inside retiring worktree'; exit 1 ;; esac
  [ "$WT" != "$MAIN" ] || { keep 'root checkout is never a target'; exit 1; }
  PREFLIGHT_RECEIPT=$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$PREFLIGHT_RECEIPT") || exit 1
  case "$PREFLIGHT_RECEIPT/" in "$WT/"*) keep 'preflight would be lost'; exit 1 ;; esac
  [ -s "$PREFLIGHT_RECEIPT" ] || { keep 'verified preflight missing'; exit 1; }
  COMMON=$(git -C "$MAIN" rev-parse --path-format=absolute --git-common-dir) || exit 1
  [ "$(git -C "$WT" rev-parse --path-format=absolute --git-common-dir)" = "$COMMON" ] || exit 1
  case "$BASE_REMOTE" in origin|upstream) ;; *) keep 'unverified base remote'; exit 1 ;; esac
  git check-ref-format "refs/heads/$DEFAULT" || exit 1
  git -C "$MAIN" fetch -q "$BASE_REMOTE" "refs/heads/$DEFAULT:refs/remotes/$BASE_REMOTE/$DEFAULT" || exit 1
  if ! git -C "$WT" merge-base --is-ancestor HEAD "$BASE_REMOTE/$DEFAULT"; then
    keep 'HEAD is not on the verified default branch'; exit 0
  fi
  CONTENT=$(git -C "$WT" status --porcelain --untracked-files=all --ignored) || exit 1
  [ -z "$CONTENT" ] || { keep 'unpreserved tracked, untracked or ignored content'; exit 0; }
  [ "$(git -C "$WT" rev-parse HEAD)" = "$EXPECTED_HEAD" ] || { keep 'identity changed'; exit 1; }
  git -C "$MAIN" worktree remove "$WT"
  REMOVE_RC=$?
  WORKTREES=$(git -C "$MAIN" worktree list --porcelain)
  LIST_RC=$?
  python3 - "$WT" <<'PY_LSTAT'
import os, sys
try:
    os.lstat(sys.argv[1])
except FileNotFoundError:
    sys.exit(0)
except OSError:
    sys.exit(2)
sys.exit(1)
PY_LSTAT
  PHYSICAL_RC=$?
  if [ "$REMOVE_RC" -eq 0 ] && [ "$LIST_RC" -eq 0 ] && [ "$PHYSICAL_RC" -eq 0 ] &&
     ! printf '%s\n' "$WORKTREES" | grep -Fx -- "worktree $WT"; then
    printf 'worktree: removed: %s; proof: git worktree remove rc 0; absent from git worktree list --porcelain; path absent (lstat)\n' "$WT"
  else
    keep "retirement failed: remove_rc=$REMOVE_RC list_rc=$LIST_RC physical_absence_rc=$PHYSICAL_RC"
    [ "$REMOVE_RC" -eq 0 ] || exit "$REMOVE_RC"
    exit 1
  fi
)
```

The code requires fresh merged ancestry and retains all ignored contents, including apparent caches. More complex content/ancestry preservation uses the authorized guard, not relaxed checks here. Record branch disposition separately; this block never deletes a branch. `list` failure or inaccessible physical state is not absence. Keep the direct remover result and both observations even on failure.
