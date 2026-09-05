#!/usr/bin/env bash
set -euo pipefail

# accessibility.sh - Accessibility (a11y) audit
# Filters CodeRabbit output for accessibility issues

# REQUIRED: Self-detect script location (works from any cwd)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

echo "## Accessibility Audit Results"
echo ""

# Check if cr CLI is available
if ! command -v cr &> /dev/null; then
    echo "> **Error:** CodeRabbit CLI (\`cr\`) not found."
    echo ""
    exit 1
fi

# Check if we're in a git repo
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo "> **Error:** Not in a git repository."
    echo ""
    exit 1
fi

REPO_NAME=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)")
echo "> Repository: \`${REPO_NAME}\`"
echo ""

# Run review and filter for a11y issues
echo "### Accessibility Findings"
echo ""

RESULTS=$(cr review --prompt-only 2>&1 | grep -iE 'accessibility|a11y|aria|alt|label|focus|keyboard|screen.?reader|contrast|role' || true)

if [[ -z "$RESULTS" ]]; then
    echo "✅ **No accessibility issues found**"
    echo ""
else
    echo "⚠️ **Accessibility issues detected:**"
    echo ""
    echo "\`\`\`"
    echo "$RESULTS"
    echo "\`\`\`"
    echo ""
fi

echo "### Accessibility Checklist"
echo ""
echo "| Check | What to Look For |"
echo "|-------|------------------|"
echo "| Images | Missing \`alt\` attributes |"
echo "| Forms | Missing \`label\` elements or \`aria-label\` |"
echo "| Buttons | Icon-only buttons without \`aria-label\` |"
echo "| Focus | Interactive elements not focusable |"
echo "| Keyboard | Can't navigate with Tab/Enter/Escape |"
echo "| Contrast | Low color contrast ratios |"
echo "| Roles | Missing ARIA roles on custom components |"
echo "| Headings | Skipped heading levels (h1 → h3) |"
echo ""
echo "### RTL Considerations"
echo ""
echo "For Hebrew/Arabic UIs:"
echo "- Check \`dir=\"rtl\"\` propagation"
echo "- Verify flex direction reversal"
echo "- Ensure text alignment is correct"
