#!/bin/bash
#
# GitHub Research - Systematic repo exploration
# Usage: ./explore.sh [repo_path] [output_dir]
#
# This script explores a Git repo and outputs structured findings.
# Designed to be called by Aider or other AI tools.
#

set -euo pipefail

REPO_PATH="${1:-.}"
OUTPUT_DIR="${2:-docs.local}"
PROJECT_NAME=$(basename "$(cd "$REPO_PATH" && pwd)")

cd "$REPO_PATH"
mkdir -p "$OUTPUT_DIR"

echo "=== GitHub Research: $PROJECT_NAME ==="
echo "Output: $OUTPUT_DIR/"
echo ""

# ─────────────────────────────────────────────────────────────
# Phase 1: Structure
# ─────────────────────────────────────────────────────────────
echo "Phase 1: Structure Discovery..."

STRUCTURE_FILE="$OUTPUT_DIR/${PROJECT_NAME}-structure.md"
cat > "$STRUCTURE_FILE" << EOF
# $PROJECT_NAME - Structure

Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

## Directory Tree
\`\`\`
$(tree -L 2 -I 'node_modules|.git|dist|build|__pycache__|.venv' . 2>/dev/null || find . -maxdepth 2 -type d | grep -v node_modules | head -50)
\`\`\`

## Config Files
\`\`\`
$(find . -maxdepth 2 \( -name "*.json" -o -name "*.yaml" -o -name "*.toml" -o -name "*.config.*" \) -not -path "*/node_modules/*" 2>/dev/null | head -20)
\`\`\`

## Documentation Files
\`\`\`
$(find . -name "*.md" -not -path "*/node_modules/*" 2>/dev/null | head -20)
\`\`\`

## Entry Points
EOF

# Check for package.json
if [ -f "package.json" ]; then
    {
        echo ""
        echo "### package.json (scripts)"
        echo '```json'
        grep -A20 '"scripts"' package.json 2>/dev/null | head -25 || echo "No scripts found"
        echo '```'
    } >> "$STRUCTURE_FILE"
fi

# Check for shell entry
if find . -maxdepth 1 -name "*.zsh" -o -name "*.sh" 2>/dev/null | head -1 | grep -q .; then
    {
        echo ""
        echo "### Shell Entry Points"
        echo '```'
        find . -maxdepth 1 \( -name "*.zsh" -o -name "*.sh" \) -exec ls -la {} + 2>/dev/null | head -10
        echo '```'
    } >> "$STRUCTURE_FILE"
fi

echo "  -> $STRUCTURE_FILE"

# ─────────────────────────────────────────────────────────────
# Phase 2: Commands/Functions
# ─────────────────────────────────────────────────────────────
echo "Phase 2: Command Discovery..."

COMMANDS_FILE="$OUTPUT_DIR/${PROJECT_NAME}-commands.md"
cat > "$COMMANDS_FILE" << EOF
# $PROJECT_NAME - Commands & Functions

Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

## Shell Functions
\`\`\`
$(grep -rh "^function \|^[a-zA-Z_][a-zA-Z0-9_]*() *{" --include="*.zsh" --include="*.sh" . 2>/dev/null | head -30 || echo "None found")
\`\`\`

## TypeScript Exports
\`\`\`
$(grep -rh "export function\|export const\|export async function" --include="*.ts" --include="*.tsx" . 2>/dev/null | grep -v node_modules | head -30 || echo "None found")
\`\`\`

## CLI Commands (if any)
\`\`\`
$(grep -rh "\.command(\|program\.\|yargs\." --include="*.ts" --include="*.js" . 2>/dev/null | grep -v node_modules | head -20 || echo "None found")
\`\`\`
EOF

echo "  -> $COMMANDS_FILE"

# ─────────────────────────────────────────────────────────────
# Phase 3: Key Files Content
# ─────────────────────────────────────────────────────────────
echo "Phase 3: Key Files..."

KEYFILES_FILE="$OUTPUT_DIR/${PROJECT_NAME}-keyfiles.md"
cat > "$KEYFILES_FILE" << EOF
# $PROJECT_NAME - Key Files Content

Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
EOF

for file in README.md CLAUDE.md GEMINI.md package.json; do
    if [ -f "$file" ]; then
        {
            echo ""
            echo "## $file"
            echo '```'
            head -100 "$file"
            echo '```'
            echo "(truncated to 100 lines)"
        } >> "$KEYFILES_FILE"
    fi
done

echo "  -> $KEYFILES_FILE"

# ─────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────
echo ""
echo "=== Research Complete ==="
echo "Output files:"
find "$OUTPUT_DIR" -maxdepth 1 -name "${PROJECT_NAME}-*" -exec ls -la {} + 2>/dev/null
echo ""
echo "Next: Read these files and analyze for gaps/issues."
