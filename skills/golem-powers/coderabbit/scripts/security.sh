#!/usr/bin/env bash
set -euo pipefail

# security.sh - Security-focused code review
# Filters CodeRabbit output for security-related issues

# REQUIRED: Self-detect script location (works from any cwd)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

echo "## Security Scan Results"
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

# Run review and filter for security issues
echo "### Security Findings"
echo ""

RESULTS=$(cr review --plain 2>&1 | grep -iE 'security|inject|xss|csrf|auth|secret|password|token|credential|vulnerab' || true)

if [[ -z "$RESULTS" ]]; then
    echo "✅ **No security issues found**"
    echo ""
else
    echo "⚠️ **Security issues detected:**"
    echo ""
    echo "\`\`\`"
    echo "$RESULTS"
    echo "\`\`\`"
    echo ""
fi

echo "### Security Checklist"
echo ""
echo "| Category | What to Check |"
echo "|----------|---------------|"
echo "| Injection | SQL, NoSQL, command injection |"
echo "| XSS | Unsanitized user input in HTML |"
echo "| Auth | Weak auth, missing checks |"
echo "| Secrets | Hardcoded keys, tokens |"
echo "| CSRF | Missing tokens on mutations |"
