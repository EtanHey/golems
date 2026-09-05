# Switch Worktrees

Navigate between different git worktrees.

---

## Quick Navigation

### List worktrees and switch

```bash
# See all worktrees
git worktree list

# Navigate to a worktree
cd ~/worktrees/<repo>/<branch>
```

Example:
```bash
cd ~/worktrees/my-app/feature-login
```

---

## Interactive Selection (with gum)

If you have `gum` installed:

```bash
#!/bin/bash
# Select worktree interactively
WORKTREE=$(git worktree list | gum filter --placeholder "Select worktree..." | awk '{print $1}')
if [ -n "$WORKTREE" ]; then
  cd "$WORKTREE"
  echo "Switched to: $WORKTREE"
  pwd
fi
```

---

## Shell Function

Add to your `.zshrc` or `.bashrc`:

```bash
# Switch worktree with fuzzy matching
wt() {
  if [ -z "$1" ]; then
    # No argument - list worktrees
    git worktree list
  else
    # Find worktree matching pattern
    MATCH=$(git worktree list | grep -i "$1" | head -1 | awk '{print $1}')
    if [ -n "$MATCH" ]; then
      cd "$MATCH"
      echo "Switched to: $(pwd)"
    else
      echo "No worktree matching: $1"
      git worktree list
    fi
  fi
}
```

Usage:
```bash
wt login    # Switches to worktree containing "login"
wt fix-     # Switches to first worktree containing "fix-"
wt          # Lists all worktrees
```

---

## Switching Context

### Before switching, check current worktree status

```bash
# Check for uncommitted changes
git status --porcelain
if [ -n "$(git status --porcelain)" ]; then
  echo "WARNING: Uncommitted changes in current worktree"
fi
```

### Stash changes before switching

```bash
git stash push -m "WIP before switching"
cd ~/worktrees/my-app/other-branch
# ... work on other branch ...
cd -  # Return to previous directory
git stash pop
```

---

## Terminal Multiplexer Integration

### tmux - one window per worktree

```bash
# Create new tmux window for worktree
WORKTREE_PATH="$HOME/worktrees/my-app/feature-a"
tmux new-window -c "$WORKTREE_PATH" -n "feature-a"
```

### zellij - new tab for worktree

```bash
WORKTREE_PATH="$HOME/worktrees/my-app/feature-a"
zellij action new-tab --cwd "$WORKTREE_PATH"
```

---

## VS Code Integration

### Open worktree in new VS Code window

```bash
WORKTREE_PATH="$HOME/worktrees/my-app/feature-a"
code "$WORKTREE_PATH"
```

### Open worktree in Cursor

```bash
cursor "$WORKTREE_PATH"
```

---

## Troubleshooting

**"cd: no such file or directory"?**
- Worktree may have been deleted
- Check with: `git worktree list`
- If shown as "(error)", run: `git worktree prune`

**Wrong branch after switching?**
- Each worktree has its own checked-out branch
- Run `git branch` to verify current branch
