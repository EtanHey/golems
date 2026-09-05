# Frustration Capture Hook Install

The committed source of truth is:

```text
skills/golem-powers/frustration-capture/hooks/frustration-capture-prompt.py
```

## Install / refresh — an installed COPY, never a symlink

```bash
skills/golem-powers/frustration-capture/scripts/install.sh          # install or refresh
skills/golem-powers/frustration-capture/scripts/install.sh --check  # exit 1 if stale
```

It copies the package to `~/.claude/hooks/frustration-capture/` per the ratified wired-gate
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

The whole package is copied, not just the `.py` — the hook resolves sibling
files (e.g. `../SKILL.md`) relative to itself.

**Before editing settings, create a backup:**

```bash
cp ~/.claude/settings.json ~/.claude/settings.json.bak-$(date +%Y-%m-%d)
```

**Append this command to the existing `UserPromptSubmit` hooks array in `~/.claude/settings.json`, after `brainlayer-prompt-search.py`:**

```json
{
  "type": "command",
  "command": "python3 ~/.claude/hooks/frustration-capture/hooks/frustration-capture-prompt.py",
  "timeout": 1000
}
```

Disable for a session with:

```bash
export FRUSTRATION_HOOK_DISABLED=1
```
