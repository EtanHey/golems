# Stamp/Status Lint Hook Install (Fix-5, weave 2026-06-07 Phase 2)

The committed source of truth is:

```text
skills/golem-powers/never-fabricate/hooks/stamp-lint.py
```

It is a **PostToolUse** hook on `Write|Edit`, **advisory only — it never denies a
write**. It targets `collab/*.md`, `docs.local/weaves/*.md`, and
`docs.local/handoffs/**.md`, lints **NEW lines only** (Edit diff / Write
line-cache), and warns when:

1. a NEW `### name (HH:MM)` header or `(HH:MM)` stamp diverges >10 min from the
   real clock (the 19:05-stamped/18:49-written class — CORRECTIONS.md §4), or
2. a NEW `DONE/MERGED/COMPLETE` status line with numbers references an absolute
   path that does not exist (the S22 invented-staging class).

**Honest scope (B-taxonomy-adversary CH4):** stamp + artifact-existence
subclasses ONLY — it cannot catch measurement errors, laundering propagation,
stale cites, or compressed quotes.

## Install / refresh — an installed COPY, never a symlink

```bash
skills/golem-powers/never-fabricate/scripts/install.sh          # install or refresh
skills/golem-powers/never-fabricate/scripts/install.sh --check  # exit 1 if stale
```

It copies the package to `~/.claude/hooks/never-fabricate/` per the ratified wired-gate
layout (`skill-creator/CLAUDE.md` rule 7: *"Wired gates live at
`~/.claude/hooks/<gate>/` — installed copies"*), then runs live probes against
the installed copy and exits non-zero if any fail.

> **Never symlink this hook into the working tree.** Until 2026-08-19 the live
> path was a symlink into `$HOME/Gits/golems`, which made the hook that runs in every
> Claude session on this Mac whatever branch happened to be checked out — a
> `git checkout` silently swapped it. See
> golems PR #732 (merged `6a9c9661`).

**Keeping the copy fresh — this is the copy's failure mode.** A symlink was
silently *live*; a copy is silently *stale*. **After merging any change here,
re-run the installer.** Nothing does it for you; `--check` compares content, not
timestamps.

The whole package is copied, not just the `.py`, so any sibling file a hook
resolves relative to itself is present. (stamp-lint keeps its line-cache state
outside the package, at `~/.claude/hooks/state/stamp-lint/`.)

**Before editing settings, create a backup:**

```bash
cp ~/.claude/settings.json ~/.claude/settings.json.bak-$(date +%Y-%m-%d)
```

**Then append this to the existing `PostToolUse` array in `~/.claude/settings.json`:**

```json
{
  "matcher": "Write|Edit",
  "hooks": [
    {
      "type": "command",
      "command": "python3 ~/.claude/hooks/never-fabricate/hooks/stamp-lint.py",
      "timeout": 5000
    }
  ]
}
```

State (line-cache for append-style collabs) lives durably at
`~/.claude/hooks/state/stamp-lint/` — never `/tmp`.

Disable for a session with:

```bash
export STAMP_LINT_DISABLED=1
```

Tests:

```bash
cd skills/golem-powers/never-fabricate/hooks && python3 -m pytest tests/test_stamp_lint.py -q
```
