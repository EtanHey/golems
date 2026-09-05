---
name: worktrees
description: "Create and manage git worktrees for isolated feature development. Prevents branch cross-contamination by giving each feature its own working directory with shared git history. Includes workflows for creating worktrees from scratch or from Linear issues, listing active worktrees, switching between them, and cleaning up completed ones. Use when starting a new feature that needs isolation from current work, running parallel implementations, or preventing uncommitted changes from leaking between tasks. Triggers on 'worktree', 'isolated branch', 'parallel feature', 'branch isolation', 'new worktree', 'feature isolation'. NOT for: simple branch switching (use git checkout), Linear-only operations (use linear), or temporary experiments (just use a branch)."
---

# Git Worktrees

> Create isolated working directories for each task. Worktrees share git history but have separate working files, preventing cross-contamination between branches.

## Quick Actions

| What you want to do | Workflow |
|---------------------|----------|
| Create new worktree from branch name | [workflows/create.md](workflows/create.md) |
| Create worktree from Linear issue | [workflows/from-linear.md](workflows/from-linear.md) |
| List active worktrees | [workflows/list.md](workflows/list.md) |
| Switch to a worktree | [workflows/switch.md](workflows/switch.md) |
| Clean up completed worktrees | [workflows/cleanup.md](workflows/cleanup.md) |

---

## Default Paths

Worktrees are created at: `~/worktrees/<repo>/<branch>`

Example:
- Main repo: `/Users/me/projects/my-app`
- Worktree: `~/worktrees/my-app/feature-login`

---

## Safety Rules

- One branch, one worktree. For parallel work on the same repo, create a separate worktree for each branch.
- Do not reuse a single shared checkout for multiple active branches. If the user proposes "just switch branches in one folder" for parallel work, stop and redirect them to worktrees.
- Do not remove a worktree until you verify its branch is merged. Unmerged or in-progress worktrees stay in place.
- Do not use `git worktree remove --force` unless the user explicitly confirms that uncommitted work can be discarded.

---

## Environment Setup (Automatic)

Worktrees automatically handle:
- **Env files**: Uses 1Password `op inject` if `.env.template` exists, else copies `.env*.local` from source
- **Dependencies**: Auto-detects package manager (bun/pnpm/yarn/npm) and installs

| Condition | Action |
|-----------|--------|
| `.env.template` + `op` available | `op inject -i .env.template -o .env.local` |
| `op inject` fails | Fallback: copy from source repo |
| No `.env.template` | Copy all `.env*.local` from source |

---

## Quick Commands

```bash
# List all worktrees
git worktree list

# Create worktree with new branch
git worktree add ~/worktrees/$(basename "$PWD")/feature-name -b feature-name

# Parallel branches require separate worktrees. Do not multiplex one checkout.
git worktree add ~/worktrees/$(basename "$PWD")/feat-pr-loop-audit -b feat-pr-loop-audit
git worktree add ~/worktrees/$(basename "$PWD")/fix-commit-trailer -b fix-commit-trailer

# Check if branch is merged before removal. If not merged, stop.
BRANCH_NAME=feature-name
git branch --merged main | grep -Fxq "$BRANCH_NAME" || {
  echo "STOP: '$BRANCH_NAME' is not merged into main. Do not remove this worktree."
  exit 1
}

# Remove merged worktree
git worktree remove ~/worktrees/$(basename "$PWD")/$BRANCH_NAME

# Prune stale references
git worktree prune
```

---

## Troubleshooting

**"fatal: 'path' already exists"**
- Worktree or directory already exists at that path
- Remove existing directory or choose different name

**"branch already exists"**
- Branch was created previously
- Use without `-b` flag: `git worktree add <path> <existing-branch>`

**"Cannot create worktree from detached HEAD"**
- Must be on a branch in main repo
- Run `git checkout main` first
