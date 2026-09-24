# Merge, release, verification, and cleanup

Read this before an authorized merge and through remote verification, release/install, tracking, and cleanup.

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

Functional self-QA happens BEFORE handoff — "merged" ≠ "converged into one verified build."

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
EtanHey repos (self-approve is structurally blocked). A clean loop with bot
reviews replied-to is the approval.

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
4. **Pull main where main lives.** Update the worktree that actually holds the
   default branch (`git -C <main-worktree> pull`), not the linked worktree you
   worked in.

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

1. **Collab file** — If this PR is part of a collab, update the task board status to ✅ Done with PR number
2. **Roadmap** — If this PR completes a roadmap phase, update `$ORCHESTRATOR_REPO/roadmap/README.md`
3. **BrainLayer** — `brain_store` what changed and why (tagged `pr-merged`, `<project>`)

```
WRONG: Merge PR, exit silently               ← Tracking drift!
WRONG: "I'll update the collab later"         ← You won't. Do it NOW.
WRONG: Only update one of collab/roadmap/BL   ← Update ALL relevant trackers.
```

If you are an autonomous agent, this step is NON-NEGOTIABLE. The orchestrator should NEVER discover completed work by accident.

---

## Daemon Verification Gate

> [!CAUTION]
> NON-NEGOTIABLE HARD STOP: IF A PR TOUCHES DAEMON, SOCKET, MCP, OR PROTOCOL CODE, YOU MUST COMPLETE REAL CLIENT RUNTIME VERIFICATION BEFORE MERGE. MARKDOWN INTENT IS NOT ENOUGH.

**Triggers when:** PR touches daemon, socket, MCP, protocol, VoiceBar runtime, or any socket-based daemon code (BrainBar, VoiceBar, cmux MCP, VoiceLayer MCP daemon, `flow-bar/**`, `launchd/**`, `src/mcp-server*.ts`, `src/mcp-socket-owner.ts`, `src/socket-*.ts`, `src/daemon*.ts`, `src/paths.ts`, `src/process-lock.ts`, `src/resolve-binary.ts`, `src/whisper-server.ts`).

**socat/curl/unit tests are NOT sufficient.** Real client test required.

For VoiceLayer:

1. Run `./scripts/voicelayer-verify.sh` BEFORE `gh pr merge`.
2. If the script says runtime verification is required, rebuild/relaunch VoiceBar when prompted.
3. Press F5 in the real VoiceBar client, speak `verification test`, release, and confirm paste fired.
4. Confirm `.verified/verified-runtime-<branch>-<short-sha>.txt` exists and contains `Verified-Runtime: <sha>`.
5. Add the exact `Verified-Runtime: <sha>` line to the PR body.
6. Only then merge.

If you run `gh pr merge --admin` without the matching verify artifact, you violated the gate. `brain_store` the violation immediately as an `orc-correction` with what happened, why the hook/skill failed, and how to prevent recurrence.

For non-VoiceLayer daemon PRs:

1. Open a NEW cmux pane (`cmux new-split right`).
2. Launch a fresh Claude Code session in that pane.
3. Verify MCP tools are available AND return real results.
4. If tools are unavailable or return errors, the PR is NOT done.

**Why:** Real regressions passed markdown-only gates and shell smoke tests. Persistent clients, app focus, hotkeys, paste behavior, and MCP framing failures only show up in live sessions.

---

## Visual Self-QA Gate — builders click IN before merge

**Triggers when:** the PR touches anything a human SEES — UI views, dashboards,
HTML pages, menu-bar apps (BrainBar/VoiceBar), TUI surfaces.

**The rule:** the BUILDER clicks INTO a real running session and screenshots it
BEFORE merge. Mechanical checks (PID running, commit-matches, server responds)
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
   manual check before merge." Never claim a visual pass from text tools (R7).

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

**Worktree cleanup:** For options 1 (after merge), 3 (never), and 4 (after discard):
```bash
# Check if in worktree
git worktree list | grep $(git branch --show-current)
# If yes, after merging/discarding:
git worktree remove <worktree-path>
```

After `git worktree add`, read the file from the worktree path before editing.
Reads from the primary checkout or another worktree do not carry over.

When operating from a linked worktree, do not merge or cleanup from that
worktree. Move to the original checkout, run `gh pr merge`, verify the remote
merge SHA, delete the remote branch, then remove the worktree. This avoids the
local failure when `main` is checked out elsewhere and keeps cleanup from
deleting the session underneath you. If even the original checkout cannot hold
the default branch (bare-mirror-style hubs like brainlayer), use the
"Worktree-Locked Local Merge" remote fallback above.

---

## After Merge: Store Component Reasoning

For every NEW file > 50 lines or with non-obvious architecture decisions:

```
brain_store("New file: {path} ({lines} lines). Purpose: {why}. Key decisions: {list}. Alternatives considered: {list}.",
  tags=["component-reasoning", "{repo}", "pr-{N}"], importance=7)
```

Future sessions query this instead of opening files to understand design choices.

---
