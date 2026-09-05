#!/usr/bin/env bash
# Install / refresh a wired Claude Code hook as an INSTALLED COPY.
#
# Ratified layout (skill-creator/CLAUDE.md rule 7): wired gates live at
# ~/.claude/hooks/<name>/ as installed copies, NEVER as symlinks into a git
# working tree. A symlink makes the live fleet-wide hook whatever branch happens
# to be checked out, so a `git checkout` silently swaps it — observed twice on
# 2026-08-18/19. See golems PR #732 (merged 6a9c9661).
#
# A copy has the opposite failure mode: it goes stale silently. That is what
# --check is for. Nothing runs it for you — re-run after merging.
#
# Usage:
#   install-wired-hook.sh --skill <name> --hook <rel/path.py> [--legacy <basename>] [--check]
#
# --fail-open makes that shim warn-and-exit-0 when the installed copy is
# unreachable, instead of denying. Use it for OBSERVER hooks (PostToolUse lints,
# UserPromptSubmit enrichers); never for a security gate.
#
# --legacy installs a drift-free shim at ~/.claude/hooks/<basename> that exec's
# the installed copy, because Claude Code snapshots hook settings at SESSION
# START: sessions older than the path swap still call the old path.
#
# If <skill>/scripts/probes.sh exists it is run after install with the installed
# hook path as $1; a non-zero exit fails the install. An installed-but-dead hook
# is a worse outcome than the symlink it replaced.
set -euo pipefail

SHARED_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
POWERS_DIR="$(dirname "$SHARED_DIR")"
HOOKS_ROOT="${WIRED_HOOKS_ROOT:-$HOME/.claude/hooks}"

skill="" hook_rel="" legacy="" fail_mode="closed" check_only=0
while (($#)); do
  case "$1" in
    --skill)  skill="$2";    shift 2 ;;
    --hook)   hook_rel="$2"; shift 2 ;;
    --legacy) legacy="$2";   shift 2 ;;
    --fail-open) fail_mode="open"; shift ;;
    --check)  check_only=1;  shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$skill"    ]] || { echo "FATAL: --skill is required" >&2; exit 2; }
[[ -n "$hook_rel" ]] || { echo "FATAL: --hook is required"  >&2; exit 2; }

SRC="$POWERS_DIR/$skill"
DEST="$HOOKS_ROOT/$skill"

[[ -f "$SRC/$hook_rel" ]] || { echo "FATAL: source hook missing: $SRC/$hook_rel" >&2; exit 1; }

# Caches and test scratch are build artifacts, not part of the installed hook.
EXCLUDES=(--exclude '__pycache__' --exclude '.pytest_cache' --exclude '*.pyc')

if (( check_only )); then
  if [[ ! -d "$DEST" ]]; then
    echo "DRIFT: installed copy missing at $DEST"
    exit 1
  fi
  # -n dry-run + -i itemize: one line per file that would change. --checksum
  # compares CONTENT, so a bare `touch` is not drift. The awk filter keeps only
  # real drift — transfers (>), creations (c), deletions (*deleting), and
  # content/size changes (itemize columns 3-4 = c/s) — dropping lines that
  # differ only in mtime or permissions.
  drift="$(rsync -rin --checksum --delete "${EXCLUDES[@]}" "$SRC/" "$DEST/" \
    | awk '/^\*deleting/ || /^[>c]/ || substr($1,3,2) ~ /[cs]/')"
  if [[ -n "$drift" ]]; then
    echo "DRIFT: installed copy is stale relative to $SRC"
    echo "$drift"
    echo "Fix: $0 --skill $skill --hook $hook_rel${legacy:+ --legacy $legacy}"
    exit 1
  fi
  echo "OK: $DEST matches $SRC"
  exit 0
fi

mkdir -p "$DEST"
rsync -rlti --delete "${EXCLUDES[@]}" "$SRC/" "$DEST/"
chmod +x "$DEST/$hook_rel"

if [[ -n "$legacy" ]]; then
  LEGACY_PATH="$HOOKS_ROOT/$legacy"
  if [[ -L "$LEGACY_PATH" ]]; then
    echo "removing legacy SYMLINK into a working tree: $LEGACY_PATH -> $(readlink "$LEGACY_PATH")"
    rm "$LEGACY_PATH"
  fi
  sed -e "s|@CANONICAL@|$DEST/$hook_rel|g" -e "s|@SKILL@|$skill|g" \
    -e "s|@FAIL_MODE@|$fail_mode|g" \
    "$SHARED_DIR/legacy-path-shim.py.tmpl" > "$LEGACY_PATH"
  chmod 755 "$LEGACY_PATH"
  echo "legacy shim installed: $LEGACY_PATH -> $DEST/$hook_rel"
fi

echo
echo "Installed to: $DEST/$hook_rel"
echo "Wire it in ~/.claude/settings.json as: python3 $DEST/$hook_rel"
echo

if [[ -x "$SRC/scripts/probes.sh" ]]; then
  echo "Live probes against the installed copy:"
  if ! "$SRC/scripts/probes.sh" "$DEST/$hook_rel"; then
    echo "INSTALL VERIFY FAILED — the wired hook is not behaving. Do not ship." >&2
    exit 1
  fi
  echo "Install verified."
else
  echo "NOTE: no $skill/scripts/probes.sh — installed WITHOUT live behaviour proof."
fi
