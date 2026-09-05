#!/usr/bin/env bash
# cleaner-register-orphan.sh — Phase B fix for Rule 8 violations (orphan registration)
# Creates symlinks in ~/.claude/skills/ for golem-powers skills missing a registration.
# Idempotent: safe to re-run; will skip skills that already have a symlink.
#
# Usage:
#   ./cleaner-register-orphan.sh             # dry-run (print plan)
#   ./cleaner-register-orphan.sh --apply     # actually create symlinks
#   ./cleaner-register-orphan.sh --list      # show current orphans (delegates to detect)
#
# Notes:
#   - User-global change. Requires user authorization (mandate or direct).
#   - Does NOT touch ~/.claude/settings.json.
#   - Does NOT remove existing symlinks; additive only.

set -euo pipefail

GOLEM_DIR="${HOME}/Gits/golems/skills/golem-powers"
SKILLS_DIR="${HOME}/.claude/skills"

# Canonical list of orphan skills to register (curated from recon-04 + harness-visibility cross-check)
ORPHANS_TO_REGISTER=(
    "brain-store-fallback"
    "architectural-conformance-audit"
    "deploy-verify"
    "cron-payload-discipline"
)

# Ambiguous skills (have archive duplicates or project-scoped) — NOT auto-registered
# - taskowl: project-scoped to TaskOwl app; intentional non-registration per recon-03
# - linkedin-post: duplicate of _archive/linkedin-post + maintenance/workflows/linkedin
# - railway: duplicate of _archive/railway + superseded by service/deployment

MODE="${1:-}"

case "$MODE" in
    --list)
        bash "$(dirname "$0")/cleaner-detect-orphan-symlinks.sh"
        exit 0
        ;;
    --apply)
        APPLY=1
        ;;
    "")
        APPLY=0
        ;;
    *)
        echo "Usage: $0 [--list|--apply]" >&2
        exit 2
        ;;
esac

[ -d "$SKILLS_DIR" ] || { echo "ERROR: $SKILLS_DIR not found" >&2; exit 1; }
[ -d "$GOLEM_DIR" ] || { echo "ERROR: $GOLEM_DIR not found" >&2; exit 1; }

planned=0
skipped=0
applied=0

for skill in "${ORPHANS_TO_REGISTER[@]}"; do
    skill_dir="$GOLEM_DIR/$skill"
    cmd_link="$SKILLS_DIR/$skill"

    if [ ! -d "$skill_dir" ]; then
        echo "WARN: $skill — skill dir missing at $skill_dir; skipping"
        continue
    fi

    if [ ! -f "$skill_dir/SKILL.md" ]; then
        echo "WARN: $skill — no SKILL.md in $skill_dir; skipping"
        continue
    fi

    if [ -e "$cmd_link" ]; then
        echo "SKIP: $skill — symlink already exists at $cmd_link"
        skipped=$((skipped + 1))
        continue
    fi

    if [ "$APPLY" -eq 1 ]; then
        ln -s "$skill_dir" "$cmd_link"
        echo "APPLIED: $skill — symlinked $cmd_link -> $skill_dir"
        applied=$((applied + 1))
    else
        echo "PLAN: $skill — would symlink $cmd_link -> $skill_dir"
        planned=$((planned + 1))
    fi
done

echo "---"
if [ "$APPLY" -eq 1 ]; then
    echo "Applied: $applied | Skipped (already linked): $skipped"
    echo "Next: restart Claude Code panes to refresh the skill index, OR run ~/.claude/scripts/generate-skill-index.sh if available"
else
    echo "Planned: $planned | Skipped (already linked): $skipped"
    echo "Re-run with --apply to create symlinks"
fi
