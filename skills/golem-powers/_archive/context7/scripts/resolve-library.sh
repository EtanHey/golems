#!/usr/bin/env bash
set -euo pipefail

# resolve-library.sh - Search for library and get Context7 ID
# Usage: ./resolve-library.sh <library-name>
# Example: ./resolve-library.sh react

# REQUIRED: Self-detect script location (works from any cwd)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

# Configuration
API_BASE="https://context7.com/api"
ENDPOINT="/v2/libs/search"

# Check for API key - try environment, then 1Password
if [[ -z "${CONTEXT7_API_KEY:-}" ]]; then
    # Try 1Password
    if command -v op &>/dev/null; then
        CONTEXT7_API_KEY=$(op read "op://development/context7/API_KEY" 2>/dev/null) || true
    fi
fi

if [[ -z "${CONTEXT7_API_KEY:-}" ]]; then
    echo "## Error: Missing API Key"
    echo ""
    echo "CONTEXT7_API_KEY environment variable is required."
    echo ""
    echo "### How to fix"
    echo ""
    echo "1. Get an API key from [context7.com](https://context7.com)"
    echo "2. Set the environment variable:"
    echo "   \`\`\`bash"
    echo "   export CONTEXT7_API_KEY=\"ctx7sk_your_key_here\""
    echo "   \`\`\`"
    echo ""
    echo "Or store in 1Password as 'context7' in 'development' vault with 'API_KEY' field."
    exit 1
fi

# Check for required argument
if [[ $# -lt 1 ]]; then
    echo "## Error: Missing Argument"
    echo ""
    echo "Usage: \`./resolve-library.sh <library-name>\`"
    echo ""
    echo "### Examples"
    echo ""
    echo "- \`./resolve-library.sh react\`"
    echo "- \`./resolve-library.sh next.js\`"
    echo "- \`./resolve-library.sh tailwindcss\`"
    exit 1
fi

LIBRARY_NAME="$1"
QUERY="${2:-$LIBRARY_NAME}"  # Optional second arg for query context

# URL encode the parameters
encode() {
    python3 -c "import urllib.parse; print(urllib.parse.quote('$1', safe=''))"
}

ENCODED_QUERY=$(encode "$QUERY")
ENCODED_NAME=$(encode "$LIBRARY_NAME")

# Make API call
URL="${API_BASE}${ENDPOINT}?query=${ENCODED_QUERY}&libraryName=${ENCODED_NAME}"

RESPONSE=$(curl -sS -w "\n%{http_code}" \
    -H "Authorization: Bearer ${CONTEXT7_API_KEY}" \
    -H "Accept: application/json" \
    "$URL" 2>&1) || {
    echo "## Error: API Request Failed"
    echo ""
    echo "Could not connect to Context7 API."
    echo ""
    echo "Response: $RESPONSE"
    exit 1
}

# Parse response
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [[ "$HTTP_CODE" != "200" ]]; then
    echo "## Error: API Error (HTTP $HTTP_CODE)"
    echo ""
    echo "The Context7 API returned an error."
    echo ""
    echo "### Response"
    echo ""
    echo "\`\`\`json"
    echo "$BODY"
    echo "\`\`\`"
    exit 1
fi

# Check if jq is available
if ! command -v jq &>/dev/null; then
    echo "## Error: jq Required"
    echo ""
    echo "This script requires \`jq\` for JSON parsing."
    echo ""
    echo "Install with: \`brew install jq\`"
    exit 1
fi

# Parse and format results
RESULT_COUNT=$(echo "$BODY" | jq -r '.results | length' 2>/dev/null || echo "0")

if [[ "$RESULT_COUNT" == "0" ]]; then
    echo "## No Results Found"
    echo ""
    echo "No libraries found matching \"$LIBRARY_NAME\"."
    echo ""
    echo "### Suggestions"
    echo ""
    echo "- Try a different spelling"
    echo "- Use the official library name"
    echo "- Check [context7.com](https://context7.com) for available libraries"
    exit 0
fi

echo "## Library Search: $LIBRARY_NAME"
echo ""
echo "Found $RESULT_COUNT matching libraries."
echo ""
echo "| Library | ID | Snippets | Score | Reputation |"
echo "|---------|-----|----------|-------|------------|"

# Parse and display each result
echo "$BODY" | jq -r '.results[] | "| \(.name // .title // "Unknown") | `\(.libraryId // .id // "N/A")` | \(.codeSnippetCount // .snippets // "-") | \(.benchmarkScore // "-") | \(.sourceReputation // "-") |"' 2>/dev/null || {
    echo "| Error parsing results |||||"
}

echo ""
echo "### Next Step"
echo ""
echo "Use the library ID with \`query-docs.sh\`:"
echo ""
FIRST_ID=$(echo "$BODY" | jq -r '.results[0].libraryId // .results[0].id // "/org/library"' 2>/dev/null)
echo "\`\`\`bash"
echo "./scripts/query-docs.sh \"$FIRST_ID\" \"your question here\""
echo "\`\`\`"
