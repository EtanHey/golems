# tmp-block Hook Install

The committed source of truth is this package:

```text
skills/golem-powers/tmp-block/
```

It is installed as a **real copy** at `~/.claude/hooks/tmp-block/`, per the
ratified wired-gate layout (`skill-creator/CLAUDE.md` rule 7: *"Wired gates live
at `~/.claude/hooks/<gate>/` — installed copies"*), matching its wired peers
`false-green-gate`, `model-pin-gate`, and `worktree-convention-gate`. Only
`false-green-gate` is golems-sourced. `worktree-convention-gate` is sourced from
`skill-creator/hooks-lab/gates/`. `model-pin-gate` is **dual-homed** — a package
exists both here (`skills/golem-powers/model-pin-gate/`) and in
`skill-creator/hooks-lab/gates/` — but the copy `~/.claude/settings.json` wires
came from **skill-creator**, so re-install it from there, not from golems:
`diff -rq` against the installed copy gives 26 differences for golems and 1 for
skill-creator, and the wired entrypoint `scripts/model-pin-gate-hook.mjs` is
byte-identical to skill-creator's while differing from golems' at line 28.
Refreshing that gate from golems would silently swap the live gate for a
different implementation.

> **Never symlink this hook into the working tree.** Until 2026-08-19 the live
> path was a symlink into `$HOME/Gits/golems`, which made the fleet-wide guard for
> every Claude session on this Mac whatever branch happened to be checked out —
> a `git checkout` silently swapped a live security control, and a mid-rebase
> tree left it as whatever the rebase had staged. Both were observed.
> See golems PR #732 (merged `6a9c9661`).

## Install / refresh

```bash
skills/golem-powers/tmp-block/scripts/install.sh
```

It copies the package to `~/.claude/hooks/tmp-block/`, reinstalls the legacy-path
shim (below), and then runs the seven live probes in `scripts/probes.sh` against
the installed copy: `/tmp` denies, `$(mktemp)` denies, the harness scratchpad
allows, a repo path allows, an off-convention `git worktree add` denies, a
`.worktrees/` one allows, and a Cursor `Shell` write into `/tmp` denies. It exits
non-zero if any probe fails, so an installed-but-dead guard cannot pass silently.

## Keeping the copy fresh — this is the copy's failure mode

A symlink was silently *live*; a copy is silently *stale*. **After merging any
change to this package, re-run the installer.** Nothing does it for you.

```bash
skills/golem-powers/tmp-block/scripts/install.sh --check   # exit 1 if stale
skills/golem-powers/tmp-block/scripts/install.sh           # fix it
```

`--check` compares content (`rsync --checksum`), not timestamps, so a `touch` is
not reported as drift, and it catches added, changed, and deleted files. Run it
whenever you doubt what is actually wired — and note that
`skill-creator/hooks-lab/gate-regress.sh` will **not** cover this package: it
only discovers hooks whose name ends in `-gate` or `-lint`.

**Before editing settings, create a backup:**

```bash
cp ~/.claude/settings.json ~/.claude/settings.json.bak-$(date +%Y-%m-%d)
```

**Append this entry to the `PreToolUse` hooks array in `~/.claude/settings.json`:**

```json
{
  "matcher": "Write|Edit|NotebookEdit|Bash",
  "hooks": [
    {
      "type": "command",
      "command": "python3 ~/.claude/hooks/tmp-block/hooks/tmp-block-pretooluse.py",
      "timeout": 5000
    }
  ]
}
```

Notes:

- Hook settings are snapshotted at session start — already-running sessions
  will not pick this up; new sessions (and their Task subagents) will.
- The hook **fails CLOSED**: any internal error denies the tool call with a
  `TMP-BLOCK FAIL-CLOSED` reason. If that ever false-fires fleet-wide, remove
  the settings entry (do NOT silently patch the hook to fail open).
- Escape hatch for genuinely-ephemeral writes: `WEAVE_ALLOW_TMP=1` —
  allowed AND logged to `~/.claude/logs/tmp-block-ledger.jsonl`
  (override path with `TMP_BLOCK_LEDGER`). An unwritable ledger denies.
- Escape hatch for the migration window of the worktree-location rule:
  `WEAVE_ALLOW_WT_MIGRATION=1` — same ledger, same unwritable-denies rule.
  It does **not** unlock the temp path-class.

### Legacy path shim

Claude Code snapshots hook settings at **session start**, so sessions that began
before the path swap still invoke the old top-level
`~/.claude/hooks/tmp-block-pretooluse.py`. The installer writes a shim there, generated from
`skills/golem-powers/_shared/legacy-path-shim.py.tmpl`, that `exec`s the
installed copy. It carries zero
policy logic, so it cannot drift, and it fails CLOSED with a deny if the
installed copy is missing. Delete it once no pre-swap sessions remain.

Verify after install (new shell):

```bash
echo '{"tool_name":"Write","tool_input":{"file_path":"/tmp/probe.md","content":"x"},"session_id":"verify"}' \
  | python3 ~/.claude/hooks/tmp-block/hooks/tmp-block-pretooluse.py; echo "exit=$?"
# expect: {"decision": "block", ...} exit=2

# Rule 2 — off-convention worktree location denies with the fixed command:
echo '{"tool_name":"Bash","tool_input":{"command":"git worktree add $HOME/Gits/golems.wt/probe -b probe"},"session_id":"verify"}' \
  | python3 ~/.claude/hooks/tmp-block/hooks/tmp-block-pretooluse.py; echo "exit=$?"
# expect: {"decision": "block", ... WORKTREE-CONVENTION ...} exit=2

# ...and the ratified location stays silent:
echo '{"tool_name":"Bash","tool_input":{"command":"git worktree add $HOME/Gits/golems/.worktrees/probe -b probe"},"session_id":"verify"}' \
  | python3 ~/.claude/hooks/tmp-block/hooks/tmp-block-pretooluse.py; echo "exit=$?"
# expect: {} exit=0
```

## Other harnesses

**Cursor — already installed, nothing to do.** `cursor-agent` reads
`~/.claude/settings.json` unconditionally and translates Claude's matcher
(`Bash → Shell`, `Edit → Write`), so the installed copy wired above already
covers Cursor panes. Verify with the same payload Cursor actually sends:

```bash
echo '{"tool_name":"Shell","tool_input":{"command":"printf x > /tmp/probe.txt","cwd":"","timeout":30000},"session_id":"verify"}' \
  | python3 ~/.claude/hooks/tmp-block/hooks/tmp-block-pretooluse.py; echo "exit=$?"
# expect: {"decision": "block", ... "permissionDecision": "deny" ...} exit=2
```

**Codex — NOT installed, deliberately.** The wiring below is correct as far as
the documented contract goes, but two things are unverified and must be
measured in a live pane before anyone claims Codex is covered:

1. whether Codex honours a refusal delivered as exit 2 with JSON on stdout
   (the documented deny shape is emitted; the exit-code contract is not
   documented), and
2. that the hook's **trust review** has been completed — Codex silently skips a
   non-managed hook until its exact definition is trusted via `/hooks`.

```json
// ~/.codex/hooks.json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|apply_patch",
        "hooks": [
          {
            "type": "command",
            "command": "python3 ~/.claude/hooks/tmp-block/hooks/tmp-block-pretooluse.py",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

A stronger option than the hook, and complementary to it: Codex can deny the
temp class in its **sandbox**, which catches `python3 -c`, `cp`/`mv`, and
relative-path-from-a-temp-cwd — everything the static parse cannot see.

```toml
# ~/.codex/config.toml
[sandbox_workspace_write]
exclude_slash_tmp = true
exclude_tmpdir_env_var = true
```

Confirm the effective roots change, with no model tokens spent:

```bash
codex sandbox -- /bin/sh -c 'printf x > /tmp/probe.txt && echo WROTE || echo BLOCKED'
```
