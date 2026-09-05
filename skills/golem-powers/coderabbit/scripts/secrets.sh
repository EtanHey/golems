#!/usr/bin/env bash
set -euo pipefail

# secrets.sh - Scan for hardcoded secrets
# Filters CodeRabbit output for potential secrets/credentials

# REQUIRED: Self-detect script location (works from any cwd)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

echo "## Secrets Scan Results"
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

# Run review and filter for secrets
echo "### Secret Detection Results"
echo ""

RESULTS=$(cr review --prompt-only 2>&1 | grep -iE 'secret|api.?key|token|password|credential|private.?key|bearer|jwt' || true)

if [[ -z "$RESULTS" ]]; then
    echo "✅ **No hardcoded secrets detected**"
    echo ""
else
    echo "🚨 **Potential secrets found:**"
    echo ""
    echo "\`\`\`"
    echo "$RESULTS"
    echo "\`\`\`"
    echo ""
fi

echo "### Known Secret Patterns"
echo ""
echo "| Pattern | Risk Level | Example |"
echo "|---------|------------|---------|"
echo "| \`sk-ant-*\` | CRITICAL | Anthropic API key |"
echo "| \`sk-*\` (32+ chars) | CRITICAL | OpenAI API key |"
echo "| \`ghp_*\` | CRITICAL | GitHub PAT |"
echo "| \`xoxb-*\` | CRITICAL | Slack bot token |"
echo "| \`pk_live_*\` | CRITICAL | Stripe live key |"
echo ""
echo "### If Secrets Found"
echo ""
echo "1. **Rotate immediately** - Consider the key compromised"
echo "2. Remove from code"
echo "3. Add to \`.env\` or 1Password"
echo "4. Check git history: \`git log -p --all -S \"the-secret\"\`"
