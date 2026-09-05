#!/usr/bin/env bash
# cleaner-detect-bloat.sh — Rule 2 (descriptions >700ch) + Rule 3 (body+extras >5K tokens)
# Usage:
#   ./cleaner-detect-bloat.sh --descriptions   # Rule 2 only
#   ./cleaner-detect-bloat.sh --bodies         # Rule 3 only
#   ./cleaner-detect-bloat.sh --all            # both
# Output: tab-separated rows: <severity>\t<skill>\t<measurement>\t<value>

set -euo pipefail

GOLEM_DIR="${GOLEM_DIR:-${HOME}/Gits/golems/skills/golem-powers}"
MODE="${1:---all}"

[ -d "$GOLEM_DIR" ] || { echo "ERROR: $GOLEM_DIR not found" >&2; exit 1; }

check_descriptions() {
    while IFS= read -r skill_md; do
        skill_name="$(basename "$(dirname "$skill_md")")"
        [[ "$skill_name" =~ ^(_|\.) ]] && continue

        # Extract description: line (handles multi-line YAML)
        desc=$(awk '/^description: /{flag=1; sub(/^description: /, ""); } /^---/&&flag{exit} flag' "$skill_md" \
            | tr '\n' ' ' | sed 's/  */ /g')
        chars=$(echo -n "$desc" | wc -c | tr -d ' ')

        if [ "$chars" -gt 700 ]; then
            echo -e "BLOCKER\t$skill_name\tdescription_chars\t$chars"
        elif [ "$chars" -gt 500 ]; then
            echo -e "WARN\t$skill_name\tdescription_chars\t$chars"
        fi
    done < <(find "$GOLEM_DIR" -maxdepth 2 -name "SKILL.md" -not -path "*/_archive/*" -not -path "*/archive/*" 2>/dev/null)
}

check_bodies() {
    while IFS= read -r skill_dir; do
        skill_name="$(basename "$skill_dir")"
        [[ "$skill_name" =~ ^(_|\.) ]] && continue

        [ -f "$skill_dir/SKILL.md" ] || continue

        # Sum SKILL.md body + all .md files in workflows/, references/, adapters/, evals/
        total_chars=$(find "$skill_dir" -type f \( -name "*.md" -o -name "*.json" \) -not -path "*/.git/*" -exec wc -c {} \; \
            | awk '{sum+=$1} END {print sum+0}')
        # Token estimate (chars/4)
        est_tokens=$((total_chars / 4))

        if [ "$est_tokens" -gt 10000 ]; then
            echo -e "BLOCKER\t$skill_name\tbody_extras_est_tokens\t$est_tokens"
        elif [ "$est_tokens" -gt 5000 ]; then
            echo -e "WARN\t$skill_name\tbody_extras_est_tokens\t$est_tokens"
        fi
    done < <(find "$GOLEM_DIR" -maxdepth 1 -type d -not -name "_*" -not -name "archive" -not -name "*-workspace")
}

case "$MODE" in
    --descriptions) check_descriptions ;;
    --bodies) check_bodies ;;
    --all) check_descriptions; echo "---"; check_bodies ;;
    *) echo "Usage: $0 [--descriptions|--bodies|--all]" >&2; exit 2 ;;
esac
