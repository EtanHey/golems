# Branch, commit, and PR creation

Read this when preparing the branch, commit, PR body, size label, or pre-review repository state.

## The Full Loop

1. BRANCH    git checkout main && git pull && git checkout -b feat/name
2. IMPLEMENT Write code — write the failing test FIRST (AGENTS.md law);
             the /tdd-guard hook enforces the edit limit
3. TEST      Run full test suite — ALL must pass
4. VERIFY    Invoke /never-fabricate
             ↳ DAEMON GATE: If this PR touches daemon/socket/MCP code,
               you MUST test with a real client session before proceeding.
               See [Daemon Verification Gate](merge-and-verification.md#daemon-verification-gate).
5. COMMIT    git add `<specific files>` → CodeRabbit pre-commit review → commit
             ↳ Codex env: run `coderabbit review --agent` with a ~3 minute
               hard timeout BEFORE committing. If the local CLI hangs or hits
               rate/review limits, stop it, record the limitation, and commit
               on fresh test evidence. After the PR exists, require PR-level
               bot status/comments before merge.
               If CRITICAL issues found → fix first. If minor → proceed.
               Ralph mode: `--story=ID --message=MSG` for atomic commit + criterion.
             ↳ Commit trailer = `Co-Authored-By: <seat> running <model>
               <noreply@anthropic.com>` ([Agent Identity Signature](github-identity.md)).
6. PUSH      git push -u origin feat/name
7. PR        Create PR (see "Creating the PR" below) — body ends with the signature block
8. REVIEW    Fetch + read review comments (see [Reading Review Comments](review-loop.md#reading-review-comments))
             ↳ Every comment/reply you POST ends with the signature block
9. FIX       Address real bugs from review
10. MERGE    gh pr merge `<N>` --merge --admin --delete-branch
             ↳ Leads are ADMINS on Etan's repos: `--admin` is the DEFAULT.
               `reviewDecision: REVIEW_REQUIRED` is a GitHub LABEL, never a
               stop condition. See "Merge Authority" below.
             ↳ `--body` on `gh pr merge` sets the MERGE COMMIT message, **not** the PR description.
               If the receipt is meant to be read by a human, `gh pr edit <N> --body-file` it onto
               the PR **before** merging.
11. CLEANUP  git checkout main && git pull

<a id="merge-authority"></a>
## Merge Authority (Etan's ruling, 2026-08-04 — mechanism, not prose)

> *"The reason we have branch protection on my own repos is so OTHER PEOPLE don't merge to my
> repo. Our agents are working on things I asked for — that's why the leads are there, they have
> full permission to merge when they see something is really good. It's not GitHub's approval
> you're waiting for, it's my approval, and it's stupid."*

1. **Branch protection exists to stop OUTSIDERS. Leads are not outsiders.** On Etan's repos,
   leads merge with **`gh pr merge <N> --admin`** as the default. A protection rule is never a
   reason to stop, wait, or report "blocked."
2. **`reviewDecision: REVIEW_REQUIRED` is a GitHub label, not a refusal.** The ONLY real merge
   blockers are: **actual conflicts · failing CI · an unresolved review finding**. Nothing else.
3. **The review step above still happens** (independent reviewer ACCEPT per lane contract —
   rules 1–5). What is abolished is the *post-review* stop: once the lane's review is clean,
   MERGE. Do not wait for a human, GitHub, or a permission that already exists.
4. **Never fabricate a missing authority.** "Etan has NOT granted merge" without a verbatim
   Etan statement for THIS lane is the fabricated-authority class (weave-verified specimen).
   Absence of a grant is not a revocation — the standing grant above is the default.
5. **Why this is a gate, not advice — measured cost of the opposite:** nine brainlayer PRs sat
   unmerged on the label (one 9 days old; six merged within 15 minutes of using `--admin`), and
   unreleased merge #638 meant enrichment restarted against a 15-day-old binary and **overwrote
   `provenance_class` on 5,137 rows.** Unmerged reviewed work is not neutral; it costs data.

> [!IMPORTANT]
> **R-010 interim merge law (2026-07-10):** merge commits are the default.
> Etan's conditional ruling was: "if we can trace everything back to the commits
> in BrainLayer... then it's fine that we do PR squashes, but we need to make
> sure that's the case." Squash returns only after the commit-traceability gate
> ships and BrainLayer-present detection is verified. Check the canonical
> registry's R-010 row state at
> `$ORCHESTRATOR_ROOT/weave-records/registry/RULES.md` before assuming that condition has been
> discharged.

---

## Git Sanitization Gate (MANDATORY)

- [ ] `git status` is clean (no uncommitted changes, no staged or unstaged work-in-progress)
- [ ] If untracked files exist, each one is explicitly accounted for with:
  - `keeping because X`, or
  - `should be gitignored`, or
  - `committing now`
- [ ] No stale branches are left behind
- [ ] Working directory is on the expected branch for this task

## Codex Worktree Patch Gate

If the assigned worktree differs from the session cwd, every `apply_patch` filename must be an absolute path inside the worktree. `exec_command.workdir` does not apply to `apply_patch`; relative patch paths resolve against the session cwd and can mutate the main checkout silently. If a patch lands unexpectedly, check `git status` in both the main checkout and the assigned worktree before continuing.

## Step 7: Creating the PR

### Prerequisites

- `gh` CLI installed (`brew install gh`)
- Authenticated: `gh auth login`
- On a feature/fix branch (not main/master/dev)
- All changes committed

### Create the PR

```bash
# Push branch first
git push -u origin HEAD

# Create PR with structured body
gh pr create --title "feat: description" --body-file - <<'EOF'
## Summary
- What changed and why

## Test plan
- [ ] Tests pass
- [ ] Manual verification done

## Bot policy
- Read `<repo>/AGENTS.md` → panel applied: <bots summoned> (<bots excluded, and why>)

— golemsClaude (lead) · claude-code/opus-4.6
<!-- golem-id v1 {"seat":"golemsClaude","role":"lead","harness":"claude-code","model":"claude-opus-4.6","model_source":"session-jsonl","session":"db7f3bb9","ts":"2026-08-08T18:40:00Z"} -->
EOF
```

### Size label (canon 9) — apply it at open, not later

The scheme is **colon**: `size:XS` `size:S` `size:M` `size:L`. `size/XS` (slash)
is retired; `ensure` renames it in place so old PRs keep their label.

Immediately after `gh pr create` returns the PR number:

```bash
# creates/normalizes the four labels in the repo (idempotent, safe to re-run)
scripts/ci/pr-size-labels.sh ensure <owner/repo>

# sizes the PR from its hand-written diff and applies exactly one size:* label,
# removing any other size:* or size/* it carries
scripts/ci/pr-size-labels.sh compute <pr> --repo <owner/repo>
```

Sizing is additions over non-generated files (locks, `dist/`,
`node_modules/`, snapshots, fixtures and `testdata/` are excluded — the full
glob list is in the script header). Deletions never count, so a big deletion
stays small:

| label | hand-written lines |
|---|---|
| `size:XS` | 0–50 |
| `size:S` | 51–150 |
| `size:M` | 151–400 |
| `size:L` | over 400 |

**A measured diff over 400 hand-written lines owes a one-line `size:L` why** in
the PR body — canon 9 says to split past ~400 lines, so explain why this change
could not be split. For example:
`size:L because the generated client and its consumers cannot land separately
without breaking the build.`

CI (`.github/workflows/pr-size-label.yml`) **fails** on a lying or conflicting
label. It **warns** on a missing label and emits a non-fatal reminder on every
measured diff over 400 hand-written lines to cover a large PR with no stated
why. The check does not parse the PR body or judge rationale prose.

The signature block goes **last** in the body, and the same block ends every PR
comment, review, and issue comment ([Agent Identity Signature](github-identity.md)). Commits use
the `Co-Authored-By: <seat> running <model>` trailer instead — never the block.

If the PR body or comment contains backticks, use `--body-file` (or stdin).
Shell command substitution will mangle inline code and can silently rewrite the
evidence you meant to preserve — including the `golem-id` blob.

### Edge Cases

- **On main/dev/master**: Don't create PR. Switch to a branch first.
- **Uncommitted changes**: Commit first.
- **PR already exists**: Use `gh pr view` to check, don't create duplicate.
- **Custom base branch**: `gh pr create --base dev`

---
