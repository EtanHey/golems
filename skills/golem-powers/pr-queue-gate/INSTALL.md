# pr-queue-gate installation

The committed source of truth is
`skills/golem-powers/pr-queue-gate/`. The live hook must run from a full
installed copy at `~/.claude/hooks/pr-queue-gate/`; it must not execute from a
mutable checkout.

Install only after the PR is merged and `origin/master` is green.
Do not run this installation from an unmerged branch. This lane documents installation;
it does not edit `~/.claude/settings.json` or install the hook live.

## 1. Verify prerequisites

```bash
test -x $HOME/.nvm/versions/node/v22.22.0/bin/node
command -v gh
command -v jq
gh auth status
```

## 2. Publish the installed copy from `origin/master`

The canonical publish operation is
`git archive origin/master skills/golem-powers/pr-queue-gate`; the command
below adds `-C` so it is independent of the caller's current directory.

```bash
git -C $HOME/Gits/golems fetch origin master
install_root=$HOME/.claude/hooks/pr-queue-gate
mkdir -p "$install_root"
git -C $HOME/Gits/golems archive origin/master skills/golem-powers/pr-queue-gate \
  | tar -x -C "$install_root" --strip-components=3
```

This copies the full tree, including the primitive, hook wrapper, contract,
and offline evals. Never symlink the live hook to a worktree.

## 3. Verify the installed copy

```bash
bun test $HOME/.claude/hooks/pr-queue-gate/evals/pr-queue-gate.test.mjs
```

The suite uses a fixture repository and a PATH-shimmed `gh`; it makes no live
GitHub calls.

## 4. Wire the Claude Code Stop hook

Back up the settings file, then merge the entry from `install-snippet.json`
into the `hooks.Stop` array in `~/.claude/settings.json`:

```json
{
  "hooks": [
    {
      "type": "command",
      "command": "$HOME/.nvm/versions/node/v22.22.0/bin/node $HOME/.claude/hooks/pr-queue-gate/scripts/pr-queue-gate-hook.mjs",
      "timeout": 5
    }
  ]
}
```

Hook settings are snapshotted at session start, so verify in a new Claude Code
session. The hook state and JSONL ledger live under
`~/.claude/hooks/pr-queue-gate/state/`.

## Operational behavior

- First Stop in an EtanHey GitHub repository with open fleet PRs: block once
  and inject the queue plus the three allowed dispositions.
- Later Stops in the same session: allow without querying GitHub again.
- Non-git, missing/non-GitHub remote, non-fleet owner, malformed input,
  primitive failure, `gh` failure, timeout, or latch failure: allow and append
  a ledger record when possible.
- The hook does not merge, review, post dispositions, or change settings.
