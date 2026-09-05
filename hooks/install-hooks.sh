#!/bin/bash
# install-hooks.sh — symlink ~/.claude/hooks/ entries to the versioned golems source.
#
# Part of PR-K1 (gen16 PLAN §3a, M1 resolution): the precompact-checkpoint.py hook now
# lives under golems/hooks/ so it is versioned and reviewable. This script wires the live
# Claude Code hook path to that source, backing up any pre-existing real file first.
#
# Idempotent. Run from anywhere; pass GOLEMS_DIR to override autodetect.
#
#   GOLEMS_DIR=~/Gits/golems bash hooks/install-hooks.sh
#
# It does NOT register the hook in settings.json — that wiring already exists for the live
# file; this only repoints the file at the versioned source. Verify after with:
#   ls -la ~/.claude/hooks/precompact-checkpoint.py
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GOLEMS_DIR="${GOLEMS_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
HOOKS_SRC="$GOLEMS_DIR/hooks"
HOOKS_DST="$HOME/.claude/hooks"

# Hooks to wire (filename only; must exist under golems/hooks/).
HOOK_FILES=("precompact-checkpoint.py")

echo "Wiring Claude Code hooks → versioned golems source"
echo "  source: $HOOKS_SRC"
echo "  target: $HOOKS_DST"
echo ""

mkdir -p "$HOOKS_DST"

for hook in "${HOOK_FILES[@]}"; do
  src="$HOOKS_SRC/$hook"
  dst="$HOOKS_DST/$hook"
  if [ ! -f "$src" ]; then
    echo "[SKIP] source missing: $src"
    continue
  fi
  # Already correctly symlinked? Leave it.
  if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$src" ]; then
    echo "[OK]   $hook already linked"
    continue
  fi
  # Back up any pre-existing real file (not our symlink) before replacing.
  if [ -e "$dst" ] && [ ! -L "$dst" ]; then
    backup="$dst.pre-k1.$(date +%Y%m%d-%H%M%S).bak"
    cp "$dst" "$backup"
    echo "[BACKUP] $hook → $(basename "$backup")"
  fi
  ln -sf "$src" "$dst"
  chmod +x "$src"
  echo "[LINK] $hook → $src"
done

echo ""
echo "Done. Verify: ls -la $HOOKS_DST/precompact-checkpoint.py"
