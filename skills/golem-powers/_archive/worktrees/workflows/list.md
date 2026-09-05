# List Worktrees

View all active git worktrees for the current repository.

---

## Quick Command

```bash
git worktree list
```

Output shows each worktree with its path, commit hash, and branch name:
```
/Users/me/projects/my-app         abc1234 [main]
/Users/me/worktrees/my-app/feat-a def5678 [feature-a]
/Users/me/worktrees/my-app/fix-b  ghi9012 [fix-b]
```

---

## Detailed View

### List with status

```bash
git worktree list --porcelain
```

Porcelain format shows:
- `worktree` - path to worktree
- `HEAD` - current commit hash
- `branch` - refs/heads/branch-name
- `locked` - if worktree is locked

### List only ~/worktrees paths

```bash
git worktree list | grep "worktrees/"
```

---

## Formatted Output

### Show as table with branch status

```bash
#!/bin/bash
echo "PATH | BRANCH | STATUS"
echo "-----|--------|-------"
git worktree list --porcelain | awk '
  /^worktree/ { path=$2 }
  /^branch/ {
    branch=$2
    sub("refs/heads/", "", branch)
  }
  /^$/ {
    # Get status for branch
    cmd = "git log --oneline -1 " branch " 2>/dev/null | head -c 50"
    cmd | getline status
    close(cmd)
    print path " | " branch " | " status
    path=""; branch=""; status=""
  }
'
```

---

## Check Specific Worktree

### Is worktree clean?

```bash
WORKTREE_PATH="$HOME/worktrees/my-app/feature-a"
cd "$WORKTREE_PATH" && git status --porcelain
```

Empty output = clean. Any output = uncommitted changes.

### Show worktree differences from main

```bash
cd "$WORKTREE_PATH" && git log main..HEAD --oneline
```

---

## Common Scenarios

### Find worktrees with uncommitted changes

```bash
for wt in $(git worktree list --porcelain | grep "^worktree" | cut -d' ' -f2); do
  changes=$(cd "$wt" && git status --porcelain 2>/dev/null | wc -l)
  if [ "$changes" -gt 0 ]; then
    echo "$wt has $changes uncommitted changes"
  fi
done
```

### Find stale worktrees (no commits in 7+ days)

```bash
for wt in $(git worktree list --porcelain | grep "^worktree" | cut -d' ' -f2); do
  last_commit=$(cd "$wt" && git log -1 --format="%cr" 2>/dev/null)
  echo "$wt - last commit: $last_commit"
done
```

---

## Troubleshooting

**Worktree shows "(error)"?**
- Path may have been deleted manually
- Run: `git worktree prune` to clean up stale entries

**Worktree shows "(locked)"?**
- Worktree was locked to prevent accidental removal
- Unlock with: `git worktree unlock <path>`
