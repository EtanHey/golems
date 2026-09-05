#!/usr/bin/env bash
set -euo pipefail

# query-docs.sh - Query library documentation from Context7
# Usage: ./query-docs.sh <library-id> <query>
# Example: ./query-docs.sh /vercel/next.js 'how to use app router'

# REQUIRED: Self-detect script location (works from any cwd)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

# Configuration
API_BASE="https://context7.com/api"
ENDPOINT="/v2/context"

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

# Check for required arguments
if [[ $# -lt 2 ]]; then
    echo "## Error: Missing Arguments"
    echo ""
    echo "Usage: \`./query-docs.sh <library-id> <query>\`"
    echo ""
    echo "### Arguments"
    echo ""
    echo "- **library-id**: Context7 library ID (e.g., \`/vercel/next.js\`)"
    echo "- **query**: Your question or what you're looking for"
    echo ""
    echo "### Examples"
    echo ""
    echo "\`\`\`bash"
    echo "./query-docs.sh /vercel/next.js 'how to use app router'"
    echo "./query-docs.sh /facebook/react 'useEffect cleanup'"
    echo "./query-docs.sh /tailwindlabs/tailwindcss 'dark mode setup'"
    echo "\`\`\`"
    echo ""
    echo "### Tip"
    echo ""
    echo "Don't know the library ID? Use \`resolve-library.sh\` first:"
    echo ""
    echo "\`\`\`bash"
    echo "./resolve-library.sh next.js"
    echo "\`\`\`"
    exit 1
fi

LIBRARY_ID="$1"
QUERY="$2"

# URL encode the parameters
encode() {
    python3 -c "import urllib.parse; print(urllib.parse.quote('$1', safe=''))"
}

ENCODED_QUERY=$(encode "$QUERY")
ENCODED_ID=$(encode "$LIBRARY_ID")

# Request text format for Markdown output
URL="${API_BASE}${ENDPOINT}?query=${ENCODED_QUERY}&libraryId=${ENCODED_ID}&type=txt"

RESPONSE=$(curl -sS -w "\n%{http_code}" \
    -H "Authorization: Bearer ${CONTEXT7_API_KEY}" \
    -H "Accept: text/plain" \
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

    # Check for common errors
    if [[ "$HTTP_CODE" == "401" ]]; then
        echo "### Unauthorized"
        echo ""
        echo "Your API key may be invalid or expired. Check CONTEXT7_API_KEY."
    elif [[ "$HTTP_CODE" == "404" ]]; then
        echo "### Library Not Found"
        echo ""
        echo "The library ID \`$LIBRARY_ID\` was not found."
        echo ""
        echo "Use \`./resolve-library.sh\` to find the correct ID."
    elif [[ "$HTTP_CODE" == "429" ]]; then
        echo "### Rate Limited"
        echo ""
        echo "Too many requests. Wait a moment and try again."
    else
        echo "### Response"
        echo ""
        echo "\`\`\`"
        echo "$BODY"
        echo "\`\`\`"
    fi
    exit 1
fi

# Check for empty response
if [[ -z "$BODY" || "$BODY" == "null" ]]; then
    echo "## No Documentation Found"
    echo ""
    echo "No documentation matched your query for \`$LIBRARY_ID\`."
    echo ""
    echo "### Suggestions"
    echo ""
    echo "- Try a more specific query"
    echo "- Check the library ID is correct"
    echo "- Try different keywords"
    exit 0
fi

# Output the documentation
echo "## Documentation: $LIBRARY_ID"
echo ""
echo "**Query:** $QUERY"
echo ""
echo "---"
echo ""
echo "$BODY"
