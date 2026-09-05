#!/bin/bash
# scripts/cleanup-legacy-commands.sh
# Purpose: remove every legacy golem-powers entry from ~/.claude/commands/ and every
#          dead symlink from ~/.claude/skills/.
# Usage:   bash cleanup-legacy-commands.sh [--check | --dry-run] [--golems-dir DIR]
#
# AIDEV-NOTE: Claude Code reads ~/.claude/skills/<name>/SKILL.md ONE level deep but
# walks ~/.claude/commands/**/*.md RECURSIVELY. A skill under commands/ therefore
# lists every workflows/, references/ and evals/fixtures/ file as its own "skill".
# Three legacy shapes exist in the wild and all three are poison:
#   1. symlink -> $GOLEMS_DIR/skills/golem-powers/<name>   (old setup-symlinks)
#   2. symlink -> ~/.claude/skills/<name>                  (golems-cli backfill)
#   3. a REAL directory from `mkdir -p ~/.claude/commands/<name>` (old INSTALL_PROMPT)
# Shape 3 cannot be `rm -f`'d; it is migrated to skills/ or reported.

set -euo pipefail

MODE="fix"
SCOPE="all"
GOLEMS_DIR="${GOLEMS_DIR:-$HOME/Gits/golems}"

show_help() {
    echo "Usage: cleanup-legacy-commands.sh [options]"
    echo ""
    echo "Options:"
    echo "  --check            Report only; exit 1 if any fixable legacy entry remains"
    echo "  --dry-run          Print what would change; change nothing; exit 0"
    echo "  --only SCOPE       commands | skills | all (default: all)"
    echo "  --golems-dir DIR   golems checkout (default: \$GOLEMS_DIR or \$HOME/Gits/golems)"
    echo "  -h, --help         Show this help"
    echo ""
    echo "Cleans:"
    echo "  - ~/.claude/commands/golem-powers namespace symlink"
    echo "  - ~/.claude/commands/<skill> symlinks into golems or into ~/.claude/skills/"
    echo "  - ~/.claude/commands/<skill> REAL directories (migrated or de-duplicated)"
    echo "  - dead symlinks in ~/.claude/skills/"
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --check) MODE="check"; shift ;;
        --dry-run) MODE="dry-run"; shift ;;
        --only)
            case "${2:-}" in
                commands|skills|all) SCOPE="$2"; shift 2 ;;
                *) echo "ERROR: --only takes commands|skills|all" >&2; exit 2 ;;
            esac ;;
        --golems-dir)
            [ -n "${2:-}" ] || { echo "ERROR: --golems-dir takes a path" >&2; exit 2; }
            GOLEMS_DIR="$2"; shift 2 ;;
        -h|--help) show_help; exit 0 ;;
        *) echo "ERROR: Unknown option: $1" >&2; exit 2 ;;
    esac
done

COMMANDS_DIR="$HOME/.claude/commands"
SKILLS_DIR="$HOME/.claude/skills"
POWERS_DIR="$GOLEMS_DIR/skills/golem-powers"

LEGACY=0

# Report a fixable legacy entry, then apply the fix unless we are only reporting.
# act <label> <verb> <path> <command...>
act() {
    local label="$1" verb="$2" path="$3"; shift 3
    LEGACY=$((LEGACY + 1))
    case "$MODE" in
        check)   echo "[LEGACY] $path ($verb)" ;;
        dry-run) echo "[dry-run] would $verb: $path" ;;
        fix)     "$@"; echo "[$label] $path" ;;
    esac
}

warn() { echo "[WARN] $1"; }

# A legacy entry we will NOT fix automatically. It still counts for --check:
# a real commands/<name> dir keeps Claude Code recursively listing its sub-files.
leftover() {
    local path="$1" why="$2"
    LEGACY=$((LEGACY + 1))
    case "$MODE" in
        check) echo "[LEGACY] $path ($why — needs a human)" ;;
        *)     warn "$path $why" ;;
    esac
}

is_powers_skill() { [ -d "$POWERS_DIR/$1" ]; }

migrate_dir() {
    mkdir -p "$(dirname "$2")"
    mv "$1" "$2"
}

# --- Pass 1: ~/.claude/commands/ -------------------------------------------
if [ "$SCOPE" != "skills" ] && [ -d "$COMMANDS_DIR" ]; then
    for entry in "$COMMANDS_DIR"/*; do
        [ -e "$entry" ] || [ -L "$entry" ] || continue
        name="$(basename "$entry")"

        if [ -L "$entry" ]; then
            target="$(readlink "$entry")"
            case "$target" in
                "$POWERS_DIR"|"$POWERS_DIR"/*) ;;          # shape 1
                "$SKILLS_DIR"|"$SKILLS_DIR"/*) ;;          # shape 2
                *) is_powers_skill "$name" || continue ;;  # renamed target, known skill
            esac
            act REMOVED "remove legacy commands/ symlink" "$entry" rm -f "$entry"
            continue
        fi

        # shape 3: a real directory. Only golem-powers skill names are ours to touch.
        [ -d "$entry" ] || continue
        is_powers_skill "$name" || continue

        if [ ! -f "$entry/SKILL.md" ]; then
            leftover "$entry" "is a real directory with no SKILL.md — left in place, move it yourself"
            continue
        fi

        if [ ! -e "$SKILLS_DIR/$name" ]; then
            act MIGRATED "migrate real commands/ directory to $SKILLS_DIR/$name" "$entry" \
                migrate_dir "$entry" "$SKILLS_DIR/$name"
        elif diff -r -q "$entry" "$SKILLS_DIR/$name" >/dev/null 2>&1; then
            act REMOVED "remove real commands/ directory (duplicate of $SKILLS_DIR/$name)" "$entry" \
                rm -rf "$entry"
        else
            leftover "$entry" "is a real directory that differs from $SKILLS_DIR/$name — left in place, reconcile it yourself"
        fi
    done
fi

# --- Pass 2: dead symlinks in ~/.claude/skills/ ----------------------------
if [ "$SCOPE" != "commands" ] && [ -d "$SKILLS_DIR" ]; then
    for entry in "$SKILLS_DIR"/*; do
        [ -L "$entry" ] || continue
        [ -e "$entry" ] && continue    # target resolves — healthy
        act REMOVED "remove dead skills/ symlink" "$entry" rm -f "$entry"
    done
fi

if [ "$MODE" = "check" ]; then
    [ "$LEGACY" -eq 0 ] || exit 1
fi
exit 0
