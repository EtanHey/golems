# Merge, release, verification, and cleanup

Read this before an authorized merge and through remote verification, tracking, and cleanup, and at the
[feature-batch gate](#feature-batch-gate) for heavy/e2e, runtime, visual QA, and release/install.

For merge authority, the `--admin` default, and R-010, first read
[Merge Authority](pr-creation.md#merge-authority).

## Merge Receipts: commit message vs PR body (2026-09-08)

> git log is where you look when you already know something is wrong; the PR page is where you look to find out.

Eight PRs in one day had detailed receipts written only to merge commit messages, leaving their
reasoning, verification, deliberate non-changes, and caveats invisible on the PR page.

A receipt belongs on the PR body when it carries something a reader could act wrongly without: a
caveat, a deliberate non-change, a "this does not make X safe" qualifier, or a limitation on what the
merge proved. Pure narration of what changed need not be duplicated; the diff already says that.

Append the receipt before merging; never replace the author's original description:
`gh pr view <N> --json body --jq .body > f && cat addendum >> f && gh pr edit <N> --body-file f`

## Deploy Truth Gate

Fleet law for user-visible completion lives in canon #4. Before emitting `TASK_DONE` or any "done / deployed / green / render-complete" message, run the **false-green gate** on the turn (hook-enforced; not model-invocable) —
`bun skills/golem-powers/false-green-gate/scripts/false-green-gate-cli.mjs <transcript|->`,
exit 3 = FLAG. A FLAG means the claim is unearned — run the missing live probe, then claim. Compose with `/deploy-verify` and `/qa-verdict-gate` as the domain requires; for a narration render-done, also run `audio-dashboard`'s gate (`bun skills/golem-powers/audio-dashboard/scripts/render-done-gate-cli.mjs <transcript|->`).

Functional self-QA runs at the [feature-batch gate](#feature-batch-gate), before the batch is handed off
or declared done — "merged" ≠ "converged into one verified build."

## PR-Referenced Artifacts Must Be Committed

Artifacts cited in PR bodies, review threads, or merge verification **cannot live
only in gitignored `docs.local/`** — reviewers and CI cannot fetch them.

```
WRONG: PR body links orchestrator/docs.local/plans/foo.md (gitignored)
RIGHT: Commit the artifact to a tracked path, paste the excerpt inline, or link
       a committed copy; docs.local is local cache only when a committed record exists
```

## Single-Account Review Verdicts

On EtanHey repos (single GitHub account), agent PR verdicts go as **PR comments**
— inline review comments or `gh pr comment` — NOT formal self-review
REQUEST_CHANGES (GitHub blocks self-approve/self-request-changes).

**Single-GitHub-account reality:** `reviewDecision` can never reach APPROVED on
EtanHey repos (self-approve is structurally blocked). A clean routed review at
`headRefOid`, with any bot findings replied to, is the approval.

```
WRONG: gh pr review --request-changes on your own PR
RIGHT: Post structured verdict as a PR comment after a clean bot-reviewed loop
```

Then follow [Merge Authority](pr-creation.md#merge-authority).

### Worktree-Locked Local Merge

In multi-worktree repos, `gh pr merge <N> --merge --delete-branch` can fail
**locally** even though the PR is fully mergeable: the post-merge branch cleanup
checks out the default branch, and git refuses when another worktree holds it
(`failed to run git: fatal: 'main' is already used by worktree at
'$HOME/Gits/brainlayer-prod'`).

1. **Verify remote BEFORE retrying.** The remote merge often already succeeded —
   only the local checkout/delete failed:
   `gh pr view <N> --json state,mergedAt,mergeCommit`. If `state` is `MERGED`,
   do NOT re-merge; finish cleanup only.
2. **Remote fallback.** Merge server-side without touching local checkouts:
   `gh api graphql` with the `mergePullRequest` mutation, or
   `gh api -X PUT repos/{owner}/{repo}/pulls/<N>/merge -f merge_method=merge`.
3. **Delete the remote branch explicitly.** After a remote/API merge the branch
   can survive auto-cleanup — check `gh api repos/{owner}/{repo}/branches/<branch>`
   and `git push origin --delete <branch>` if it is still there.
4. **Fast-forward main where main lives.** Update the worktree that actually holds the
   default branch, not the linked worktree you worked in: run the guarded block in
   [Update Tracking](#after-merge-update-tracking-mandatory) step 1 with `<root>` set to that worktree.

Known topology: brainlayer — `main` is held by `$HOME/Gits/brainlayer-prod`; briefs
into multi-worktree repos must pin the exact worktree path (see /repogolem's
brainlayer topology note).

### Stacked PR Branch-Delete Trap

If a child PR is based on the branch you are merging, deleting the base branch
can auto-close the child. Closed PRs cannot be retargeted (`Cannot change the
base branch of a closed pull request`; #456 needed replacement #462).
Safe order: merge base **without** `--delete-branch`, then immediately retarget
children. If squash artifacts conflict, rebase children with
`git rebase --onto origin/<target-branch> origin/<base-branch>` while the base
exists. Delete the base branch only after children are retargeted, rebased if
needed, and mergeable. For golems/master, `<target-branch>` is `master`.

### Post-Merge Verification

After every merge, verify the merge commit contains the changes from your latest
pushed SHA. For squash merges, this is content/tree verification, not ancestor
containment. Mid-review external merges can strand fixes (#475 merged without
`d6a292a`; recovered by cherry-pick #476).

Deployment/live claims are governed by canon #4 and the Deploy Truth Gate above.

### After Merge: Update Tracking (MANDATORY)

**Every merged PR MUST update its tracking. No exceptions.**

1. **Root checkout** — "Leads keep the root checkout ff-only current after each merge." (Etan 2026-10-19, via orc)
   Why: root brainlayer sat 1,017 commits behind and its lead read stale instructions (bl-lead collab, 2026-10-19 21:06 IDT).
   After each merge, run this block once, with the two placeholders filled in. `<root>` is the repo's
   main checkout, not your linked worktree, and `<default>` is its default branch. It runs in a subshell,
   so its stops never close your shell. The default branch's configured `@{u}` selects the base:
   `upstream/<default>` when tracking upstream, otherwise `origin/<default>`; missing or unexpected tracking stops rather than guessing. A deliberate fork-origin policy must STOP if it differs from the PR base; never substitute fork proof for upstream proof.
   ```bash
   ROOT='<root>' DEFAULT='<default>'
   (
     set -eu
     BRANCH=$(git -C "$ROOT" branch --show-current)
     if [ "$BRANCH" != "$DEFAULT" ]; then
       echo "ROOT-FF STOP: $ROOT is on '${BRANCH:-detached HEAD}', not $DEFAULT; not merging. Report it." >&2
       exit 2
     fi
     BASE=$(git -C "$ROOT" rev-parse --abbrev-ref --symbolic-full-name '@{u}') ||
       { echo "ROOT-FF STOP: default branch has no tracking ref" >&2; exit 2; }
     BASE_REMOTE=${BASE%%/*}
     case "$BASE" in "origin/$DEFAULT"|"upstream/$DEFAULT") ;; *) echo "ROOT-FF STOP: unexpected tracking ref $BASE" >&2; exit 2 ;; esac
     OLD=$(git -C "$ROOT" rev-parse HEAD)
     git -C "$ROOT" fetch -q "$BASE_REMOTE" "refs/heads/${DEFAULT}:refs/remotes/$BASE" || { echo "ROOT-FF STOP: fetch failed; report it." >&2; exit 3; }
     git -C "$ROOT" merge -q --ff-only "$BASE" ||
       { echo "ROOT-FF STOP: ff-only failed (local changes or divergence); report it, never force." >&2; exit 4; }
     git -C "$ROOT" diff --name-only "$OLD" HEAD -- '*AGENTS.md' '*CLAUDE.md'
     HEAD_SHA=$(git -C "$ROOT" rev-parse HEAD)
     BASE_SHA=$(git -C "$ROOT" rev-parse "$BASE")
     COUNTS=$(git -C "$ROOT" rev-list --left-right --count "HEAD...$BASE" | tr '\t' '/')
     [ "$HEAD_SHA" = "$BASE_SHA" ] && [ "$COUNTS" = 0/0 ] || { echo "ROOT-FF STOP: $BASE ahead/behind=$COUNTS" >&2; exit 5; }
     printf 'root: %s HEAD=%s %s=%s ahead/behind=%s\n' "$ROOT" "$HEAD_SHA" "$BASE" "$BASE_SHA" "$COUNTS"
   )
   ```
   - A nonzero exit is a `ROOT-FF STOP`: report its line to your lead or collab and leave the root as it
     is. Never force it: no `reset --hard`, no stash, no rebase, no branch switch on the root.
   - Exit 0 prints the changed AGENTS.md and CLAUDE.md paths, then the root receipt readback. Re-read those files before your
     next action.
   - `scripts/tests/pr-loop-root-ff.test.mjs` executes this exact block against Git fixtures.
2. **Collab file** — If this PR is part of a collab, update the task board status to ✅ Done with PR number
3. **Roadmap** — If this PR completes a roadmap phase, update `$ORCHESTRATOR_REPO/roadmap/README.md`
4. **BrainLayer** — `brain_store` what changed and why (tagged `pr-merged`, `<project>`)

```
WRONG: Merge PR, exit silently               ← Tracking drift!
WRONG: "I'll update the collab later"         ← You won't. Do it NOW.
WRONG: Only update one of collab/roadmap/BL   ← Update ALL relevant trackers.
WRONG: Root checkout left behind origin       ← The next session reads stale instructions.
WRONG: git -C <root> reset --hard origin/main ← Never force; report the failed ff-only.
```

If you are an autonomous agent, this step is NON-NEGOTIABLE. The orchestrator should NEVER discover completed work by accident.

---

## Feature-Batch Gate

> **Merging:** small PRs merge right away on fast CI + 1 review. Heavy or e2e tests run per FEATURE BATCH (a full plan or feature change tested together), not per PR and not as a pre-merge gate.

(Etan 2026-10-18, via orc collab.) The batch is the lead's plan or feature change (`/large-plan`). Its
gate runs once, on the batch head, before the batch is released, installed or declared done. It is not
a per-PR pre-merge stop. Mid-batch PRs merge on the [risk-sized cadence](../SKILL.md#merge-cadence-risk-sized).

At the batch gate, in order:

1. Heavy/e2e suites on the batch head (the default branch after the batch's last merge).
2. The [Daemon Verification Gate](#daemon-verification-gate), if any batch PR touched daemon, socket, MCP or protocol code.
3. The [Visual Self-QA Gate](#visual-self-qa-gate), if any batch PR changed a visible surface.
4. Release/install, then `scripts/ci/release-gate.mjs <repo>` until `CLEAN`. Tag, release, install, deploy
   and upgrade without asking Etan; only one-way doors wait for him ([Hard Gates](../SKILL.md#hard-gates)).
   The lead routes the deploy hop (release → install → restart → live probe → seat reconnect) to the
   `deploy-local-prod` sub-agent and verifies the artifact it reports; it does not run the hop itself.
   Checks and waits go to the mechanical tier (`/agent-routing` § Cheap sub-agents). Mid-batch,
   `MERGED_UNRELEASED` is expected. At the batch endpoint, `MERGED_UNRELEASED`, `RELEASED_UNINSTALLED`
   or `UNKNOWN` is a stop.
5. The [Deploy Truth Gate](#deploy-truth-gate) live probe, then the done claim.

Canon #4 (done = installed) still holds, at the batch: the batch is not done until the installed
artifact carries the batch head, verified on the machine. A defect the batch gate finds opens a NEW PR
(canon #9), and the gate reruns on the new head. Record the gate results, and any `Verified-Runtime:`
line, in the batch's closing PR body.

**Single-PR batch:** a PR that alone ships to users runs this gate itself, before its release/install,
and before its merge when merging is what deploys it.

Heavy suites stay parallel-safe: each run takes its own ports and temp dirs, with no global
one-at-a-time lock.

---

## Daemon Verification Gate

> [!CAUTION]
> HARD STOP AT THE FEATURE-BATCH GATE: IF ANY PR IN THE BATCH TOUCHES DAEMON, SOCKET, MCP, OR PROTOCOL CODE, COMPLETE REAL CLIENT RUNTIME VERIFICATION ON THE BATCH HEAD BEFORE THE BATCH IS RELEASED, INSTALLED, OR DECLARED DONE. MARKDOWN INTENT IS NOT ENOUGH.

**When:** at the [feature-batch gate](#feature-batch-gate), not before every merge. A mid-batch daemon PR
merges on the size cadence and its real-client run is queued for the batch. A single-PR batch runs it
before that PR ships.

**Triggers when:** PR touches daemon, socket, MCP, protocol, VoiceBar runtime, or any socket-based daemon code (BrainBar, VoiceBar, cmux MCP, VoiceLayer MCP daemon, `flow-bar/**`, `launchd/**`, `src/mcp-server*.ts`, `src/mcp-socket-owner.ts`, `src/socket-*.ts`, `src/daemon*.ts`, `src/paths.ts`, `src/process-lock.ts`, `src/resolve-binary.ts`, `src/whisper-server.ts`).

**socat/curl/unit tests are NOT sufficient.** Real client test required.

**Live hook (VoiceLayer).** `hooks/daemon-gate-precheck.py` is still installed as a PreToolUse hook. It
blocks `gh pr merge --admin` in VoiceLayer on a daemon diff that has no matching `.verified/` artifact.
Until that hook is rescoped to the batch gate, a VoiceLayer daemon PR runs the steps below before its
admin merge. Never bypass the hook: no merge without `--admin`, no API merge, and no disabling it to
dodge the block. Tell your lead the hook and the batch rule conflict.

For VoiceLayer:

1. Run `./scripts/voicelayer-verify.sh` on the batch head before release/install (and before
   `gh pr merge --admin` while the live hook above enforces it).
2. If the script says runtime verification is required, rebuild/relaunch VoiceBar when prompted.
3. Press F5 in the real VoiceBar client, speak `verification test`, release, and confirm paste fired.
4. Confirm `.verified/verified-runtime-<branch>-<short-sha>.txt` exists and contains `Verified-Runtime: <sha>`.
5. Add the exact `Verified-Runtime: <sha>` line to the batch's closing PR body (the daemon PR's own
   body for a single-PR batch).
6. Only then release, install, or claim done.

If you release, install, or claim done on a batch without the matching verify artifact, you violated the gate. `brain_store` the violation immediately as an `orc-correction` with what happened, why the hook/skill failed, and how to prevent recurrence.

For non-VoiceLayer daemon PRs:

1. Open a NEW cmux pane (`cmux new-split right`).
2. Launch a fresh Claude Code session in that pane.
3. Verify MCP tools are available AND return real results.
4. If tools are unavailable or return errors, the PR is NOT done.

**Why:** Real regressions passed markdown-only gates and shell smoke tests. Persistent clients, app focus, hotkeys, paste behavior, and MCP framing failures only show up in live sessions.

---

## Visual Self-QA Gate

**Triggers when:** the PR touches anything a human SEES — UI views, dashboards,
HTML pages, menu-bar apps (BrainBar/VoiceBar), TUI surfaces.

**When:** at the [feature-batch gate](#feature-batch-gate), before the batch is released, installed or
declared done; a single-PR batch runs it before that PR ships. Mid-batch, the PR merges on the size
cadence and the visual pass is queued for the batch.

**The rule:** the BUILDER clicks INTO a real running session and screenshots it. Mechanical checks (PID running, commit-matches, server responds)
are NOT a functional pass — "generated" ≠ "verified."

1. Run the real thing (deployed URL or live app — not the build directory).
2. Click into a REAL session/state, exercising the changed surface.
3. Screenshot (desktop + mobile where the surface is mobile-first) and attach the
   `/never-fabricate` R7 Verification Receipt to the PR/collab message.
4. **Route visual QA of menu-bar apps to Codex computer-use** — Codex has driven
   BrainBar before; Claude CU is weak there. Known gotcha: the `LSUIElement`
   grant dialog is a focus state, not a hard block (fallback: `screencapture`
   CLI + coordinate clicks).
5. Cannot screenshot? Then say so: "VISUAL VERIFICATION NOT PERFORMED — needs
   manual check before release." Never claim a visual pass from text tools (R7).

---

## What NOT To Do

```
WRONG: gh pr create && gh pr merge --auto    ← No review!
WRONG: gh pr create && gh pr merge --merge   ← Same message, no review!
WRONG: "PR created, done!"                   ← Mission is MERGED, not created
WRONG: Skip review "because it's a small change" ← Small changes break things too
```

## Finishing a Branch (Alternative Endings)

Not every branch goes through the full PR flow. When implementation is done:

1. **Verify tests pass** before offering options
2. **Present options:**

| Option | When to Use | Commands |
|--------|-------------|----------|
| **Create PR** (default) | Most cases — full review loop | Continue with [steps 7-11](pr-creation.md#the-full-loop) |
| **Merge locally** | Small team, already reviewed | `git checkout main && git merge <branch> && git branch -d <branch>` |
| **Keep as-is** | Need to park work | Just stop. Worktree preserved. |
| **Discard** | Wrong approach, start over | Requires typed "discard" confirmation. `git branch -D <branch>` |

**Worktree cleanup (lane close):** The lead's leftover sweep covers settled or merged lanes under `<main>/.worktrees` only, after all consumers release and the contract permits retirement. Use the existing scoped `worktree-gc.sh` protections; live consumers and unpreserved data stay retained. T3-managed paths remain `KEEP-out-of-scope` for that sweep: never bypass managed-root ownership with a direct-removal fallback. For both harnesses, the authorized parent follows the contract's [interim retirement path](../../_shared/lifecycle/CONTRACT.md#parent-retirement-path-both-harnesses-interim) from outside the resource.

Before allocating, handing off, settling or retiring a workspace, read and follow the [workspace lifecycle contract](../../_shared/lifecycle/CONTRACT.md); record REMOVED, RETAINED or acknowledged TRANSFERRED.

After allocation, read files from the assigned worktree before editing; another checkout's reads do not carry over. For a linked-worktree merge, use the [remote fallback](#worktree-locked-local-merge) and [root update](#after-merge-update-tracking-mandatory) as applicable. These PR mechanics do not authorize workspace retirement.

### Cleanup Receipt

End the merge comment or lane report with this block. The contract owns preservation, consumers, collector authority and proof; there is no child-run removal recipe. The lead verifies the receipt against the direct remover result, fresh successful registration read and physical observation. Keep local-only history, dirty files and unresolved review consumers with a named owner; escalate holds to the lead.

Keep the existing field lines for parser compatibility. REMOVED requires the contract's direct remover result, fresh successful registration read and physical absence. RETAINED uses `kept because`; acknowledged TRANSFERRED records the successor/custody evidence on that same field with the retained path. A pushed unmerged handoff alone never releases consumers. Append proof or custody references without changing the `worktree:` and `branch:` tokens; historical receipts remain readable, but their shape does not establish valid removal.

```
CLEANUP RECEIPT (mandatory in the merge comment or the DONE report):
- root: <path> HEAD=<sha> <base-remote>/<default>=<sha> ahead/behind=0/0
  OR ROOT-FF STOP: <reason>
- worktree: removed: <path>; proof: git worktree remove rc 0; absent from git worktree list --porcelain; path absent (lstat)
  OR worktree: <path> kept because <reason>; escalated to <lead>
- branch: <name> deleted local+remote | kept because <reason>
- files this PR added outside src/tests: <list or none>; each is: committed reference (docs/reference|docs/rationale|README) |
  stored to BrainLayer <chunk-id> and deleted | moved to docs.local/<day>/ | deleted with an authorized disposition receipt
- docs.local this lane created: <paths>; preservation/disposition and linked receipts under the contract and /drive-filing
```

File dispositions record completed authorized actions; BrainLayer storage, moving or rollup alone grants no deletion authority. Workspace retirement follows Etan's DONE quote and PHX's merged-PR/last-consumer reading in the contract.

The required root field has exactly two forms (strip the Markdown bullet/indent before matching this regex):
```regex
^(?:root: (/[^\r\n]+) HEAD=([0-9a-f]{40}) ((?:origin|upstream)/[^\s=]+)=\2 ahead/behind=0/0|ROOT-FF STOP: \S[^\r\n]*)$
```
OK requires an absolute path, equal full 40-character lowercase hexadecimal SHAs, the configured base tracking ref, and ahead/behind exactly `0/0`; any other counts require STOP. Reuse [Update Tracking](#after-merge-update-tracking-mandatory) step 1's readback. Examples (OK, then STOP):
```text
root: /srv/repos/t3code HEAD=0123456789abcdef0123456789abcdef01234567 upstream/main=0123456789abcdef0123456789abcdef01234567 ahead/behind=0/0
ROOT-FF STOP: not merged
```
Unmerged handoffs must use `ROOT-FF STOP: not merged`. The lead rejects a DONE whose receipt lacks a valid root field. A STOP records a blocker; it is never a silent pass.

The lead's phase close (`/large-plan` exit criteria) checks for one receipt per
worker, including a valid root field (OK readback or explicit STOP blocker) and a contract-backed disposition. A bare `removed` line is invalid; a valid RETAINED or acknowledged TRANSFERRED records the continuing owner obligation.

---

## After Merge: Store Component Reasoning

For every NEW file > 50 lines or with non-obvious architecture decisions:

```
brain_store("New file: {path} ({lines} lines). Purpose: {why}. Key decisions: {list}. Alternatives considered: {list}.",
  tags=["component-reasoning", "{repo}", "pr-{N}"], importance=7)
```

Future sessions query this instead of opening files to understand design choices.

---
