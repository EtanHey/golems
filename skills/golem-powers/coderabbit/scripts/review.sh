#!/usr/bin/env bash
set -euo pipefail

# review.sh - Run CodeRabbit code review
# This runs automatically when the skill is loaded

# REQUIRED: Self-detect script location (works from any cwd)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

echo "## CodeRabbit Code Review"
echo ""

# Check if cr CLI is available
if ! command -v cr &> /dev/null; then
    echo "> **Error:** CodeRabbit CLI (\`cr\`) not found."
    echo ""
    echo "Install it with:"
    echo ""
    echo "\`\`\`bash"
    echo "curl -fsSL https://cli.coderabbit.ai/install.sh | sh"
    echo "\`\`\`"
    echo ""
    exit 1
fi

# Check if we're in a git repo
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo "> **Error:** Not in a git repository."
    echo ""
    exit 1
fi

# Get repo name for allowed repo check
REPO_NAME=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)")

echo "> Repository: \`${REPO_NAME}\`"
echo ""

# Run the review
echo "### Review Results"
echo ""
echo "\`\`\`"

# Run cr review and capture output
if ! cr review --plain 2>&1; then
    echo "\`\`\`"
    echo ""
    echo "> **Note:** Review completed with warnings or no changes found."
fi

echo "\`\`\`"
echo ""
echo "---"
echo ""
echo "### Quick Actions"
echo ""
echo "| Action | Command |"
echo "|--------|---------|"
echo "| Security scan | \`./scripts/security.sh\` |"
echo "| Secrets scan | \`./scripts/secrets.sh\` |"
echo "| A11y audit | \`./scripts/accessibility.sh\` |"
echo "| PR-ready check | \`./scripts/pr-ready.sh\` |"
