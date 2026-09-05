# Setup Symlinks Workflow

Create symlinks to enable golem-powers skills. The target directory depends on your CLI:

| CLI | Skill directory |
|-----|----------------|
| **Claude Code** | `~/.claude/skills/` |
| **Codex** | `~/.agents/skills/` (wire from `~/.codex/skills/` → `~/.agents/skills/`) |
| **Cursor / Gemini** | `~/.agents/skills/` |

---

## Prerequisites

- golems repository cloned
- Target skill directory exists (see table above)

---

## Create Target Directory

```bash
# Claude Code
mkdir -p ~/.claude/skills

# Codex / Cursor / Gemini
mkdir -p ~/.agents/skills
```

---

## Symlink Skills — Claude Code

Skills are installed as individual symlinks in `~/.claude/skills/`. Each skill gets its own symlink:

> **Never `~/.claude/commands/`.** Claude Code reads `~/.claude/skills/<name>/SKILL.md`
> one level deep, but walks `~/.claude/commands/**/*.md` recursively. A skill directory
> symlinked into `commands/` therefore lists every `workflows/`, `references/` and
> `evals/fixtures/` file as its own "skill" and blows the 40,000-char skill-listing
> budget. Any existing golem-powers symlink under `commands/` should be deleted.

```bash
#!/bin/bash
GOLEMS_DIR="${GOLEMS_DIR:-$HOME/path/to/golems}"
SKILLS_DIR="$HOME/.claude/skills"

echo "Creating individual skill symlinks..."
echo "Source: $GOLEMS_DIR/skills/golem-powers/*"
echo "Target: $SKILLS_DIR/"
echo ""

# Create skills directory if missing
mkdir -p "$SKILLS_DIR"

# Remove old namespace symlink if it exists
if [ -L "$SKILLS_DIR/golem-powers" ]; then
  rm -f "$SKILLS_DIR/golem-powers"
  echo "[REMOVED] old namespace symlink: golem-powers"
fi

# Create individual skill symlinks
for skill_dir in "$GOLEMS_DIR"/skills/golem-powers/*/; do
  skill_name=$(basename "$skill_dir")
  ln -sf "$skill_dir" "$SKILLS_DIR/$skill_name"
  echo "[OK] $skill_name symlink created"
done

# Drop every legacy commands/ copy — symlink, golems-cli backfill, or real dir.
# `rm -f` alone is NOT enough: old INSTALL_PROMPTs ran `mkdir -p ~/.claude/commands/<name>`
# and rm -f refuses a directory, leaving it recursively indexed.
bash "$GOLEMS_DIR/skills/golem-powers/golem-install/scripts/cleanup-legacy-commands.sh" \
  --golems-dir "$GOLEMS_DIR"

echo ""
echo "Skills now available in ~/.claude/skills/"
```

---

## Symlink Skills — Codex / Cursor / Gemini

Skills go in `~/.agents/skills/`. Codex also reads from `~/.codex/skills/` which should symlink into `~/.agents/skills/`:

```bash
#!/bin/bash
GOLEMS_DIR="${GOLEMS_DIR:-$HOME/path/to/golems}"
AGENTS_DIR="$HOME/.agents/skills"

echo "Creating skill symlinks in ~/.agents/skills/..."
mkdir -p "$AGENTS_DIR"

for skill_dir in "$GOLEMS_DIR"/skills/golem-powers/*/; do
  skill_name=$(basename "$skill_dir")
  ln -sf "$skill_dir" "$AGENTS_DIR/$skill_name"
  echo "[OK] $skill_name"
done

echo ""
echo "Skills linked in ~/.agents/skills/"
echo "To expose in Codex, also run:"
echo "  mkdir -p ~/.codex/skills"
echo "  for d in ~/.agents/skills/*/; do ln -sf \"\$d\" ~/.codex/skills/\$(basename \"\$d\"); done"
```

---

## Quick Setup (One-liner)

Replace `/path/to/golems` with your actual path:

```bash
# Claude Code
mkdir -p ~/.claude/skills && for d in /path/to/golems/skills/golem-powers/*/; do ln -sf "$d" ~/.claude/skills/$(basename "$d"); done

# Codex / Cursor / Gemini
mkdir -p ~/.agents/skills && for d in /path/to/golems/skills/golem-powers/*/; do ln -sf "$d" ~/.agents/skills/$(basename "$d"); done
# Wire Codex: mkdir -p ~/.codex/skills && for d in ~/.agents/skills/*/; do ln -sf "$d" ~/.codex/skills/$(basename "$d"); done
```

---

## Symlink Hooks — Claude Code

Some golems ship Claude Code hooks (versioned under `golems/hooks/`). The PreCompact
safety-net checkpoint hook (`precompact-checkpoint.py`) is wired to its versioned source
so fixes are reviewable and the live file never drifts:

```bash
GOLEMS_DIR="${GOLEMS_DIR:-$HOME/path/to/golems}" bash "$GOLEMS_DIR/hooks/install-hooks.sh"
```

`install-hooks.sh` is idempotent — it backs up any pre-existing real file as
`*.pre-k1.<ts>.bak`, then symlinks `~/.claude/hooks/precompact-checkpoint.py` →
`golems/hooks/precompact-checkpoint.py`. It does NOT edit `settings.json` (the hook is
already registered there for the live path; this only repoints the file at the source).

Verify:
```bash
ls -la ~/.claude/hooks/precompact-checkpoint.py   # should point into golems/hooks/
```

---

## Verify Symlinks

Check that individual skill symlinks are correctly pointing:

```bash
# Claude Code
ls -la ~/.claude/skills/ | grep "^l"

# Codex / Cursor / Gemini
ls -la ~/.agents/skills/ | grep "^l"
```

Expected output (one symlink per skill):
```
1password -> $HOME/golems/skills/golem-powers/1password/
archive -> $HOME/golems/skills/golem-powers/archive/
pr-loop -> $HOME/golems/skills/golem-powers/pr-loop/
...
```

---

## Test Skill Discovery

- **Claude Code**: In a new session, skills appear as top-level commands (e.g., `/1password`, `/pr-loop`, `/golem-install`).
- **Codex**: Skills invokable as `$skill-name` or referenced by name in prompts.
- **Cursor / Gemini**: Reference the skill by name in your prompt.

---

## Remove Legacy `commands/` Symlinks (Claude Code)

Older installs symlinked skill directories into `~/.claude/commands/`. Claude Code walks
that tree recursively, so each one listed its `workflows/`, `references/` and
`evals/fixtures/` files as separate "skills". Remove every golem-powers entry there —
`~/.claude/skills/` is the only supported target:

Three legacy shapes exist in the wild and `rm -f` only handles the first two:

| Shape | Where it came from | What the cleanup does |
|---|---|---|
| `commands/<name>` → `$GOLEMS_DIR/skills/golem-powers/<name>` | old `setup-symlinks` | delete the symlink |
| `commands/<name>` → `~/.claude/skills/<name>` | golems-cli backfill | delete the symlink |
| `commands/<name>` as a **real directory** | old `mkdir -p ~/.claude/commands/<name>` INSTALL_PROMPT | move to `~/.claude/skills/<name>` if absent there; delete if byte-identical to it; otherwise leave it and warn |

Run the script — it also removes the old `commands/golem-powers` namespace symlink
and any dead symlink left in `~/.claude/skills/`:

```bash
GOLEMS_DIR="${GOLEMS_DIR:-$HOME/Gits/golems}"

# See what it would do first
bash "$GOLEMS_DIR/skills/golem-powers/golem-install/scripts/cleanup-legacy-commands.sh" --dry-run

# Apply
bash "$GOLEMS_DIR/skills/golem-powers/golem-install/scripts/cleanup-legacy-commands.sh"

# Assert the invariant (exit 1 while anything fixable remains)
bash "$GOLEMS_DIR/skills/golem-powers/golem-install/scripts/cleanup-legacy-commands.sh" --check
```

It never touches non-golems entries under `commands/` (your own `*.md` commands and
symlinks pointing elsewhere are left alone). Behaviour is pinned by
`scripts/tests/test-cleanup-legacy-commands.bats`.

Then re-run the setup script above to create the `~/.claude/skills/` symlinks.

---

## Troubleshooting

### Symlink broken (red in ls -la)

The source directory was moved. Re-run the setup script with the correct `GOLEMS_DIR` path.

### Skills not appearing in Claude Code

1. Check Claude Code version supports skills
2. Verify symlinks exist: `ls -la ~/.claude/skills/ | grep "^l"`
3. Restart Claude Code session

### Skills not appearing in Codex

1. Verify `~/.agents/skills/` has symlinks: `ls -la ~/.agents/skills/ | grep "^l"`
2. Verify `~/.codex/skills/` symlinks to `~/.agents/skills/`: `ls -la ~/.codex/skills/`
3. Restart Codex session

### Permission denied

Fix permissions:
```bash
# Claude Code
chmod 755 ~/.claude/skills && chmod -R 755 ~/.claude/skills/*/

# Codex / Cursor / Gemini
chmod 755 ~/.agents/skills && chmod -R 755 ~/.agents/skills/*/
```

---

## Next Steps

After creating symlinks:
1. Run [validate](validate.md) to test the full installation
2. Skills are ready to invoke in your AI CLI of choice
