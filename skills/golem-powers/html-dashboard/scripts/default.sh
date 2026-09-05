#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
TEMPLATE="${SKILL_DIR}/templates/template.html"

if [[ ! -f "$TEMPLATE" ]]; then
  echo "ERROR: html-dashboard template missing at $TEMPLATE" >&2
  exit 1
fi

template_lines="$(wc -l < "$TEMPLATE" | tr -d ' ')"
if [[ "$template_lines" -lt 900 ]]; then
  echo "ERROR: html-dashboard template appears incomplete: $template_lines lines, expected at least 900" >&2
  exit 1
fi

cat <<EOF
## /html-dashboard loaded

Clone this template before producing a dashboard:
$TEMPLATE

Required gate:
- Open the newest/best prior dashboard in docs.local/dashboards first.
- Never build from scratch.
- Preserve gen-12 CSS, cards -> drawer, tabs, glossary, pills, and dark theme.
- Use only verified real content.
- Save to docs.local/dashboards/YYYY-MM-DD-<topic>.html.

Reference priority:
1. Etan canonical references when available:
   - $ORCHESTRATOR_ROOT/docs.local/dashboards/2026-05-30-orchestration-status.html
   - $ORCHESTRATOR_ROOT/docs.local/dashboards/2026-05-31-brainlayer-conductor.html
2. Newest/best local docs.local/dashboards/YYYY-MM-DD-*.html in the target repo.
3. Fallback: $TEMPLATE

Mandatory before shipping any generated dashboard:
- Replace every {{PLACEHOLDER}} marker.
- Replace sample TRACKS, GLOSS, FINDINGS, PR numbers, statuses, dates, and agent states with verified real content.
- Run: grep -nE '\\{\\{[A-Z0-9_-]+\\}\\}' docs.local/dashboards/YYYY-MM-DD-<topic>.html
  It must return no matches.
- Verify in Helium only. If Helium is unavailable, write: VISUAL VERIFICATION NOT PERFORMED. Do not use Brave for dashboards.
EOF
