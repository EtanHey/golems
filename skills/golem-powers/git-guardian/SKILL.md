---
name: git-guardian
description: "Safety gate for destructive git/main commits. Triggers: force-push, reset, branch delete, clean, main commit."
---

# Git Guardian

Prevents git footguns by checking blast radius, uncommitted state, and branch safety before any destructive operation.

## Trigger Operations

Invoke this skill when about to run ANY of these:

| Operation | Risk |
|-----------|------|
| `git push --force` / `git push -f` | Overwrites upstream history |
| `git reset --hard` | Destroys local changes permanently |
| `git branch -D` / `git branch -d` | May lose unmerged commits |
| `git checkout .` / `git restore .` | Destroys uncommitted local changes |
| `git clean -f` / `git clean -fd` | Permanently deletes untracked files |
| `git rebase` on a shared branch | Rewrites shared history |
| Commit or push while on `main`/`master` | Pollutes main branch history |
| `--no-verify` on any command | Bypasses safety hooks |

## Protocol

For every destructive operation, run these checks in order:

### 1. Branch Safety Check

```bash
git branch --show-current
```

- **If on `main` or `master`:** STOP. Do not proceed with force-push, reset --hard, or unprotected commits. Redirect to a feature branch.
- **Exception:** `git pull --rebase` and `git merge` are safe on main.

### 2. Uncommitted Changes Check

```bash
git status --short
git stash list
```

- List any modified, staged, or untracked files that would be destroyed.
- If there are uncommitted changes: **name them explicitly** before asking for confirmation.
- Never silently proceed past uncommitted changes.

### 3. Impact Summary

Before executing, show:

```
⚠️ Git Guardian — [OPERATION] on [BRANCH]

Commits to be lost:    [N commits, with short hashes + messages]
Files to be lost:      [list of modified/untracked files]
Branch status:         [merged | UNMERGED — N commits only here]
Upstream:              [N commits ahead/behind origin/branch]

Proceed? [y/N]
```

**Only proceed after explicit user confirmation** — or if user explicitly says "yes, proceed", "force it", "I know".

### 4. Specific Rules by Operation

#### Force Push (`--force` / `-f`)
1. Check current branch — block if `main`/`master` unconditionally.
2. Run `git log origin/<branch>..HEAD --oneline` to show what will be overwritten.
3. Show confirmation summary. Proceed only after user confirms.
4. **Never** suggest `--force-with-lease` as a workaround to silently bypass this check.

#### Reset Hard (`reset --hard`)
1. Run `git log HEAD~<N>..HEAD --oneline` to list commits being dropped.
2. Run `git status --short` to show uncommitted work that will be lost.
3. If uncommitted changes exist: explicitly list each file. Ask for confirmation.
4. Proceed only after explicit confirmation.

#### Branch Delete (`-D` / `-d`)
1. Run `git branch --merged` to check if the branch is merged.
2. If **not merged**: list the N commits that exist only on this branch.
3. Warn: "These commits are not in any other branch. Deleting will make them unrecoverable without `git reflog`."
4. Ask for explicit confirmation.

#### Checkout/Restore (`.` or path)
1. List the files that will be reverted.
2. Show which files have staged changes that would also be dropped.
3. Ask for confirmation.

#### Clean (`-f`)
1. Run `git clean -n` (dry run) to list files that would be deleted.
2. Flag any `.env*` or secret-looking files prominently.
3. Ask for explicit confirmation. Never auto-clean.

#### Commit/Push on `main`/`master`
1. Detect current branch = `main` or `master`.
2. Suggest: "Create a feature branch first: `git checkout -b feat/<name>`"
3. Do NOT commit or push. Redirect the user.

#### `--no-verify`
1. Never run any git command with `--no-verify`.
2. Instead: investigate why the hook is failing and fix the root cause.
3. If user insists, surface this as a hard stop: "The hook failure is protecting you. What does the error say?"

## Non-Negotiables

- **NEVER** force-push to `main`/`master` under any circumstances.
- **NEVER** use `--no-verify` to bypass hooks.
- **NEVER** silently proceed past uncommitted changes.
- **NEVER** delete an unmerged branch without explicit confirmation.
- If user overrides a warning ("I know, just do it"), proceed — but log what was overridden.

## Mechanical checks (gen-18 Track 6 D6 — build the gate, not the prose)

The mechanical rules are pure, importable, replayably-tested functions in
[`git_safety.py`](git_safety.py) (RED→GREEN fixtures in [`tests/test_git_safety.py`](tests/test_git_safety.py),
run `python3 -m pytest tests/`). The active `~/.claude/hooks/pre_tool_use.py` imports these
instead of re-deriving the rules as prose:

| Function | Catches |
|----------|---------|
| `is_destructive_restore(command, owned_paths)` | `git checkout -- …` / `git restore …` / `git checkout .` that would discard **UNOWNED** in-session changes — returns a `git stash` suggestion. Distinguishes a working-tree discard from a bare branch switch. |
| `pr_body_is_empty(body)` | `gh pr create` with a blank / template-only body (post-create non-empty assert). |
| `is_unauthorized_no_verify(command, authorized)` | `--no-verify` on commit/push without authorization (`git push -n` = --dry-run is correctly NOT flagged). |
| `is_dangerous_rm(command, cwd, env)` | Resolves shell assignments and cwd before judging recursive-delete breadth; a repo-contained literal prefix suppresses false blocks when a suffix remains dynamic. |
| `shell_text_without_heredoc_bodies(command)` | Removes file-write heredoc prose from destructive scans while retaining executable substitutions in unquoted heredocs. |
| `dangerous_shell_reason(command, cwd, env)` | Combined hook-facing F8 verdict for rm breadth and destructive command patterns. |

The "discard only what THIS session owns" rule is the key nuance: discarding your own
in-session edits is fine; discarding another agent's or the user's uncommitted work is the
footgun — prefer `git stash` so it is recoverable.

## Integration

- **`/pr-loop` step 5** — git-guardian's branch check is a prerequisite to commit; pr-loop handles CodeRabbit review.
- **`/pr-loop`** — calls git-guardian before any force-push during rebase/fixup cycle.
- **Native `git worktree`** — worktrees always operate on non-main branches; git-guardian still applies for reset/clean inside worktrees.
