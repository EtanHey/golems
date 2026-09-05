#!/usr/bin/env bash
set -euo pipefail

# default.sh - Context7 skill usage help
# This runs automatically when the skill is loaded

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "## Context7 - Library Documentation Lookup"
echo ""
echo "Look up current documentation for any programming library."
echo ""

# Check API key status
if [[ -n "${CONTEXT7_API_KEY:-}" ]]; then
    echo "> API key configured"
    echo ""
else
    echo "> **Warning:** CONTEXT7_API_KEY not set. See setup instructions below."
    echo ""
fi

echo "### Quick Start"
echo ""
echo "**1. Find a library ID:**"
echo ""
echo "\`\`\`bash"
echo "${SCRIPT_DIR}/resolve-library.sh react"
echo "\`\`\`"
echo ""
echo "**2. Query documentation:**"
echo ""
echo "\`\`\`bash"
echo "${SCRIPT_DIR}/query-docs.sh /facebook/react 'useEffect cleanup function'"
echo "\`\`\`"
echo ""

echo "### Available Scripts"
echo ""
echo "| Script | Purpose | Example |"
echo "|--------|---------|---------|"
echo "| \`resolve-library.sh\` | Find library ID | \`./resolve-library.sh next.js\` |"
echo "| \`query-docs.sh\` | Get documentation | \`./query-docs.sh /vercel/next.js 'app router'\` |"
echo ""

if [[ -z "${CONTEXT7_API_KEY:-}" ]]; then
    echo "### Setup Required"
    echo ""
    echo "1. Get an API key from [context7.com](https://context7.com)"
    echo "2. Set the environment variable:"
    echo ""
    echo "   \`\`\`bash"
    echo "   export CONTEXT7_API_KEY=\"ctx7sk_your_key_here\""
    echo "   \`\`\`"
    echo ""
    echo "3. Add to your shell profile (\`~/.zshrc\` or \`~/.bashrc\`) for persistence."
    echo ""
fi

echo "### Common Library IDs"
echo ""
echo "| Library | ID |"
echo "|---------|-----|"
echo "| React | \`/facebook/react\` |"
echo "| Next.js | \`/vercel/next.js\` |"
echo "| Tailwind CSS | \`/tailwindlabs/tailwindcss\` |"
echo "| TypeScript | \`/microsoft/typescript\` |"
echo "| Node.js | \`/nodejs/node\` |"
echo ""
echo "Use \`resolve-library.sh\` to find other libraries."
