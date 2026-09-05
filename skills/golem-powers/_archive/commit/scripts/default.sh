#!/usr/bin/env bash
set -euo pipefail

# Commit with CodeRabbit Review
# Usage: default.sh [commit-message]

echo "## Commit with Code Review"
echo ""

# Check if we're in a git repo
if ! git rev-parse --is-inside-work-tree &>/dev/null; then
    echo "**Error:** Not in a git repository"
    exit 1
fi

# Check for staged changes
STAGED=$(git diff --staged --stat)
if [ -z "$STAGED" ]; then
    echo "**No staged changes.** Stage files first with \`git add\`"
    echo ""
    echo "### Unstaged changes:"
    echo '```'
    git status --short
    echo '```'
    exit 1
fi

echo "### Staged Changes"
echo '```'
echo "$STAGED"
echo '```'
echo ""

# Run CodeRabbit review
echo "### Running CodeRabbit Review..."
echo ""

CR_OUTPUT=$(cr review 2>&1) || CR_EXIT=$?
CR_EXIT=${CR_EXIT:-0}

echo "$CR_OUTPUT"
echo ""

if [ $CR_EXIT -eq 0 ]; then
    echo "---"
    echo "**CodeRabbit: PASSED**"
    echo ""
    echo "Ready to commit. Provide a commit message to proceed."
else
    echo "---"
    echo "**CodeRabbit: ISSUES FOUND** (exit code: $CR_EXIT)"
    echo ""
    echo "Review the issues above. You can:"
    echo "1. Fix the issues and run \`/commit\` again"
    echo "2. Ask me to commit anyway (I'll include a note about skipped review)"
fi
