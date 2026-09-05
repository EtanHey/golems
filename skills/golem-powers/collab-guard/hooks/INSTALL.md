# collab-guard Hook Install

The committed source of truth is:

```text
skills/golem-powers/collab-guard/hooks/collab-guard.py
```

The existing Claude Code `PreToolUse` registration already points to
`~/.claude/hooks/collab-guard.py`; no settings change is required.

Install only from an updated default-branch checkout after the PR is merged:

```bash
mkdir -p ~/.claude/hooks
REPO_ROOT=$(git rev-parse --show-toplevel)
cp "$REPO_ROOT/skills/golem-powers/collab-guard/hooks/collab-guard.py" \
  ~/.claude/hooks/collab-guard.py
```

Every deliberate shrink override is appended as JSON Lines to:

```text
~/.claude/hooks/collab-guard-shrink.log
```

Verify the installed hook with the regression suite:

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
COLLAB_GUARD_HOOK_UNDER_TEST="$HOME/.claude/hooks/collab-guard.py" \
  python3 -m pytest \
  "$REPO_ROOT/skills/golem-powers/collab-guard/hooks/tests/test_collab_guard.py" -q
```
