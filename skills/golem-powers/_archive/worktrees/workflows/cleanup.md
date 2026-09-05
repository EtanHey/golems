# Cleanup Worktrees

Remove worktrees that are no longer needed after completing work.

---

## Quick Cleanup

### Remove a single worktree

```bash
WORKTREE_PATH="$HOME/worktrees/my-app/feature-done"
git worktree remove "$WORKTREE_PATH"
```

### Force remove (has uncommitted changes)

```bash
git worktree remove --force "$WORKTREE_PATH"
```

---

## Safe Cleanup Workflow

### Step 1: List all worktrees

```bash
git worktree list
```

### Step 2: Check worktree status

Before removing, verify the branch is merged:

```bash
BRANCH_NAME="feature-done"

# Check if merged to main
git branch --merged main | grep -q "$BRANCH_NAME"
if [ $? -eq 0 ]; then
  echo "Branch '$BRANCH_NAME' is merged - safe to remove"
else
  echo "WARNING: Branch '$BRANCH_NAME' is NOT merged to main"
fi
```

### Step 3: Remove the worktree

```bash
git worktree remove "$HOME/worktrees/my-app/$BRANCH_NAME"
```

### Step 4: Optionally delete the branch

```bash
# Delete local branch (only if merged)
git branch -d "$BRANCH_NAME"

# Force delete (even if not merged)
git branch -D "$BRANCH_NAME"
```

---

## Bulk Cleanup

### Remove all worktrees for merged branches

```bash
#!/bin/bash
# Cleanup all worktrees for branches merged to main

REPO_NAME=$(basename "$(git rev-parse --show-toplevel)")
MERGED_BRANCHES=$(git branch --merged main | grep -v "main\|master\|\*")

for branch in $MERGED_BRANCHES; do
  WORKTREE_PATH="$HOME/worktrees/$REPO_NAME/$branch"
  if [ -d "$WORKTREE_PATH" ]; then
    echo "Removing worktree: $WORKTREE_PATH"
    git worktree remove "$WORKTREE_PATH"
  fi
done

# Prune stale references
git worktree prune
```

### Interactive cleanup (with gum)

```bash
#!/bin/bash
# Select worktrees to remove interactively

WORKTREES=$(git worktree list | tail -n +2)  # Skip main repo

if [ -z "$WORKTREES" ]; then
  echo "No worktrees to clean up"
  exit 0
fi

echo "Select worktrees to remove:"
SELECTED=$(echo "$WORKTREES" | gum filter --no-limit)

for line in $SELECTED; do
  PATH_TO_REMOVE=$(echo "$line" | awk '{print $1}')
  if gum confirm "Remove $PATH_TO_REMOVE?"; then
    git worktree remove "$PATH_TO_REMOVE"
    echo "Removed: $PATH_TO_REMOVE"
  fi
done
```

---

## Cleanup Stale References

If worktree directories were deleted manually (not via git worktree remove):

```bash
# Show stale worktree references
git worktree list

# Remove stale references
git worktree prune

# Dry-run (show what would be pruned)
git worktree prune --dry-run
```

---

## Full Cleanup Script

Complete cleanup for a finished feature:

```bash
#!/bin/bash
set -e

BRANCH_NAME="${1:?Usage: cleanup.sh <branch-name>}"
REPO_NAME=$(basename "$(git rev-parse --show-toplevel)")
WORKTREE_PATH="$HOME/worktrees/$REPO_NAME/$BRANCH_NAME"

# Step 1: Verify branch is merged
if ! git branch --merged main | grep -q "$BRANCH_NAME"; then
  echo "WARNING: Branch '$BRANCH_NAME' is not merged to main"
  read -p "Continue anyway? (y/n) " -n 1 -r
  echo
  [[ ! $REPLY =~ ^[Yy]$ ]] && exit 1
fi

# Step 2: Remove worktree
if [ -d "$WORKTREE_PATH" ]; then
  echo "Removing worktree: $WORKTREE_PATH"
  git worktree remove "$WORKTREE_PATH"
else
  echo "Worktree not found at: $WORKTREE_PATH"
fi

# Step 3: Delete local branch
if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
  echo "Deleting local branch: $BRANCH_NAME"
  git branch -d "$BRANCH_NAME"
fi

# Step 4: Prune stale references
git worktree prune

echo ""
echo "Cleanup complete for: $BRANCH_NAME"
```

---

## Troubleshooting

**"fatal: 'path' is a main working tree"?**
- Cannot remove the main repository, only worktrees
- Only worktrees in ~/worktrees/ can be removed

**"fatal: cannot remove locked worktree"?**
- Unlock first: `git worktree unlock <path>`
- Then remove: `git worktree remove <path>`

**"error: '<branch>' is not fully merged"?**
- Branch has commits not in main
- Either merge first, or use `-D` to force delete branch

**Worktree directory still exists after remove?**
- Git removes worktree reference but may leave empty directory
- Remove manually: `rmdir "$WORKTREE_PATH"`
