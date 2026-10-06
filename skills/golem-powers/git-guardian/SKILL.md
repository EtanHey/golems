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

#501 denies recursive `rm` (with or without force) of `~/Gits`, ancestors
of the active checkout, direct child directories of `$HOME`, and directory entries at the first level of
`~/.claude`, `~/.codex`, `~/.cmux`, `~/.config`, `~/.ssh` and `~/Library`.
Existing paths use filesystem identity (including case and volume aliases);
unavailable identity falls back to case-folded physical spelling. Known regular
files remain eligible for cleanup and atomic moves. Inside `~/Gits`, targets outside a checkout
are probed for `.git` at depth at most 3 with a 5,000-entry cap; cap or filesystem
errors fail closed. The initial checkout stays protected after `cd`; `~`, `~+`
and `~-` use tracked HOME/cwd/oldpwd, and other tilde prefixes fail closed.

The same target policy covers `find -delete` roots and local `rsync --delete*`/`--del`
destinations. Find follows its selected `-H`/`-L`/`-follow` policy (last
`-P` overrides earlier flags); local rsync destinations are evaluated physically.
Both also fail closed for targets affected by earlier path creation. Rsync
option values are separated from operands; unknown trailing long options fail
closed when the destination becomes ambiguous.
Find collects BSD/bfs root operands throughout the expression, separating primary
values and nested command operands; unknown primaries fail closed. Selective
in-repo filters can permit cleanup while retaining home/config/container and
active-ancestor protections. Unfiltered, broad, negated or ambiguous branches
retain breadth checks. Regex dialects and wildcard-only filename classes do
not qualify for a breadth exemption. Positive age filters below a top-level
directory retain the repo-root boundary.
Moving protected roots is denied; deleting a path affected by an
earlier `ln`, `mv` or recursive `cp` fails closed. Removing an existing symlink
itself, safe deep cleanup and sanctioned disposable fixtures remain allowed.
Earlier `mkdir` retains protected directory roles while permitting known deep cleanup.

The opt-in `scripts/cleanup_corpus_gate.py` compares decision functions on exactly
200 frozen local commands. Capture requires `--capture-projects`; CI uses only
synthetic fixtures. It never executes commands and retains hashes plus private
source references. Each new denial requires a true-positive reason and evidence;
unclassified denials, missing frozen rows or a truncated sample fail the gate.
An exact in-repo `find . -name __pycache__ -type d -prune -exec rm -r {} +`
cache cleanup also remains allowed (including `-R`, `-rf`, `-fr`).

This is a bounded shell model, not a shell interpreter. Nonstandard containers
outside `~/Gits` and the active checkout, remote rsync destinations, `trash`,
interpreter deletion one-liners and filesystem changes between evaluation and
execution remain outside its boundary. The lead tracks interpreter deletion
as a separate issue; passing this policy is not permission to delete.

Wrapper evaluation is capped at 64 nested commands. Deeper input and any
`RecursionError` fail closed with a value-free reason. The hook also converts
unexpected policy-evaluation exceptions to a value-free block. The installed
git-guardian gate is `pre_tool_use.py` (source `hooks/pre_tool_use.py`), which
imports this skill's `git_safety.py`; it is distinct from the project
`block-dangerous-commands.py` and the human-confirm gate. Both host manifests
run it through `golems-fail-open.py --fail-closed` (#488). A missing, unreadable,
syntax-broken or crashed hook denies with a static, value-free reinstall hint:
`! bash ~/Gits/golems/scripts/hooks/install-hooks.sh --host <host> --update --apply`.
Flag this to the user: blocked Bash cannot perform agent recovery. A human uses
the prompt or an outside terminal (omit `!` there). The installer clears the
missing pin's locked registration, and `--update` moves a broken pin to a healthy
commit. Local damage inside hooks-live refuses (tamper evidence) until a human
inspects it and re-runs with `--restore-live`.
The prompt's `!` bypass remains the #411 assumption, not live-verified here.
Legitimate allow/deny results pass through. Other gates keep the default
fail-open launcher mode; tmp-block is the other selected policy gate.
The launcher is an installed copy so it survives a dangling hooks-live tree.
The registered command wraps it in a `/bin/sh` guard, so a missing pinned
interpreter or a launcher that cannot start also denies; a skipped harness
registration remains outside its own enforcement boundary. Lead installs through hooks-live after review/merge.
Known residuals: import-time hangs, native exits and harness timeouts can still
fail open, and registration/launcher edits can disable enforcement. Separate
follow-ups track these; only Python-level stdout/stderr is captured.

The "discard only what THIS session owns" rule is the key nuance: discarding your own
in-session edits is fine; discarding another agent's or the user's uncommitted work is the
footgun — prefer `git stash` so it is recoverable.

## Integration

- **`/pr-loop` step 5** — git-guardian's branch check is a prerequisite to commit; pr-loop handles CodeRabbit review.
- **`/pr-loop`** — calls git-guardian before any force-push during rebase/fixup cycle.
- **Native `git worktree`** — worktrees always operate on non-main branches; git-guardian still applies for reset/clean inside worktrees.
