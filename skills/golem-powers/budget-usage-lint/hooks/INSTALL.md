# budget-usage-lint Hook Install

The committed source of truth is:

```text
skills/golem-powers/budget-usage-lint/hooks/budget-usage-lint.py
```

This is an **advisory, non-blocking** hook. It scans agent-facing output and
emits a warning when it finds conserve-Claude / weekly-budget / "stay thin" /
"go light" framing. It **always exits 0** — it never blocks a tool call or a
stop. The signal is a `{"systemMessage": ...}` on stdout (and a stderr note).

## Install / refresh — an installed COPY, never a symlink

```bash
skills/golem-powers/budget-usage-lint/scripts/install.sh          # install or refresh
skills/golem-powers/budget-usage-lint/scripts/install.sh --check  # exit 1 if stale
```

It copies the package to `~/.claude/hooks/budget-usage-lint/` per the ratified
wired-gate layout (`skill-creator/CLAUDE.md` rule 7: *"Wired gates live at
`~/.claude/hooks/<gate>/` — installed copies"*).

> **Never symlink a hook into the working tree.** That makes the hook running in
> every Claude session on this Mac whatever branch happens to be checked out, so
> a `git checkout` silently swaps it. Three hooks were fixed this way on
> 2026-08-19; see golems PR #732 (merged `6a9c9661`).

**A copy goes stale silently — after merging any change here, re-run the
installer.** Nothing does it for you; `--check` compares content, not timestamps.

**Before editing settings, create a backup:**

```bash
cp ~/.claude/settings.json ~/.claude/settings.json.bak-$(date +%Y-%m-%d)
```

**Append to BOTH the `PostToolUse` and `Stop` hooks arrays in `~/.claude/settings.json`:**

```json
{
  "matcher": "*",
  "hooks": [
    {
      "type": "command",
      "command": "python3 ~/.claude/hooks/budget-usage-lint/hooks/budget-usage-lint.py",
      "timeout": 5000
    }
  ]
}
```

(The `Stop` event has no matcher field — drop `"matcher"` there, keep the
`hooks` array.)

Notes:

- This hook is **document-only registration** — do NOT auto-register it
  globally for the whole fleet without an owner's call. The committed source
  lives in the repo; wiring it into a given seat's `settings.json` is a
  per-seat decision.
- Hook settings are snapshotted at session start — already-running sessions
  won't pick this up; new sessions (and their Task subagents) will.
- The hook **fails OPEN**: any internal error, malformed payload, or empty
  stdin exits 0 with no warning. It can never block real work.

Verify after install (new shell):

```bash
echo '{"hook_event_name":"Stop","last_assistant_message":"we are at 76% of the weekly budget, let'"'"'s conserve Claude"}' \
  | python3 ~/.claude/hooks/budget-usage-lint/hooks/budget-usage-lint.py; echo " exit=$?"
# expect: {"systemMessage": "⚠️ BUDGET-USAGE-LINT: ..."} exit=0

echo '{"hook_event_name":"Stop","last_assistant_message":"plenty of context budget left, full throttle"}' \
  | python3 ~/.claude/hooks/budget-usage-lint/hooks/budget-usage-lint.py; echo " exit=$?"
# expect: (no output) exit=0
```
