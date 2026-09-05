#!/usr/bin/env bash
set -euo pipefail

# pr-ready.sh - Comprehensive pre-PR check
# Runs full review against main branch

# REQUIRED: Self-detect script location (works from any cwd)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

echo "## PR-Ready Check"
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
BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")

echo "> Repository: \`${REPO_NAME}\`"
echo "> Branch: \`${BRANCH}\`"
echo "> Comparing against: \`main\`"
echo ""

echo "---"
echo ""

# Full review against main
echo "### Full Review (vs main)"
echo ""
echo "\`\`\`"
cr review --plain --base main 2>&1 || true
echo "\`\`\`"
echo ""

echo "---"
echo ""

# Security check
echo "### Security Check"
echo ""
SECURITY=$(cr review --prompt-only 2>&1 | grep -iE 'security|inject|xss|csrf|auth|secret' || true)
if [[ -z "$SECURITY" ]]; then
    echo "✅ No security issues"
else
    echo "⚠️ Security issues found:"
    echo "\`\`\`"
    echo "$SECURITY"
    echo "\`\`\`"
fi
echo ""

# Secrets check
echo "### Secrets Check"
echo ""
SECRETS=$(cr review --prompt-only 2>&1 | grep -iE 'secret|api.?key|token|password|credential' || true)
if [[ -z "$SECRETS" ]]; then
    echo "✅ No hardcoded secrets"
else
    echo "🚨 Potential secrets found:"
    echo "\`\`\`"
    echo "$SECRETS"
    echo "\`\`\`"
fi
echo ""

# A11y check
echo "### Accessibility Check"
echo ""
A11Y=$(cr review --prompt-only 2>&1 | grep -iE 'accessibility|a11y|aria|alt|label|focus' || true)
if [[ -z "$A11Y" ]]; then
    echo "✅ No accessibility issues"
else
    echo "⚠️ Accessibility issues found:"
    echo "\`\`\`"
    echo "$A11Y"
    echo "\`\`\`"
fi
echo ""

echo "---"
echo ""
echo "### Pre-PR Checklist"
echo ""
echo "- [ ] CodeRabbit review passes (no CRITICAL/HIGH)"
echo "- [ ] Security issues addressed"
echo "- [ ] Accessibility checked (if UI changes)"
echo "- [ ] No hardcoded secrets"
echo "- [ ] Tests pass"
echo "- [ ] Types check"
