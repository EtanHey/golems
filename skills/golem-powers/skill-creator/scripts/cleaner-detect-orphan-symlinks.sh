#!/usr/bin/env bash
# cleaner-detect-orphan-symlinks.sh — Rule 8: SKILL.md exists in golems but no symlink in ~/.claude/skills/
# Usage: ./cleaner-detect-orphan-symlinks.sh
# Output: tab-separated rows: <severity>\t<skill>\t<reason>

set -euo pipefail

GOLEM_DIR="${HOME}/Gits/golems/skills/golem-powers"
SKILLS_DIR="${HOME}/.claude/skills"

[ -d "$GOLEM_DIR" ] || { echo "ERROR: $GOLEM_DIR not found" >&2; exit 1; }

found_orphans=0

while IFS= read -r skill_md; do
    skill_name="$(basename "$(dirname "$skill_md")")"
    # Skip private/archive dirs
    [[ "$skill_name" =~ ^(_|\.) ]] && continue
    [[ "$skill_name" == "archive" ]] && continue
    [[ "$skill_name" == "*-workspace" ]] && continue

    # ~/.claude/skills/ is the only discovery path Claude Code reads one level deep
    skill_link="$SKILLS_DIR/$skill_name"

    if [ ! -e "$skill_link" ]; then
        echo -e "BLOCKER\t$skill_name\tno symlink in ~/.claude/skills/ — skill invisible to harness"
        found_orphans=$((found_orphans + 1))
    fi
done < <(find "$GOLEM_DIR" -maxdepth 2 -name "SKILL.md" -not -path "*/_archive/*" -not -path "*/archive/*" -not -path "*-workspace/*" 2>/dev/null)

echo "---" >&2
echo "Total orphans: $found_orphans" >&2
exit 0
