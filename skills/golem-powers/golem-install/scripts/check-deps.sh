#!/bin/bash
# scripts/check-deps.sh
# Purpose: Check all required dependencies for golems
# Usage: bash check-deps.sh

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Help text
show_help() {
    echo "Usage: check-deps.sh [options]"
    echo ""
    echo "Options:"
    echo "  --verbose    Show version details"
    echo "  --json       Output as JSON"
    echo "  -h, --help   Show this help"
    echo ""
    echo "Checks for:"
    echo "  - gh (GitHub CLI)"
    echo "  - op (1Password CLI)"
    echo "  - gum (Interactive prompts)"
    echo "  - fswatch (File watching)"
    echo "  - jq (JSON processing)"
    echo "  - git (Version control)"
    echo "  - bun (TypeScript runtime)"
    echo "  - cr (CodeRabbit CLI, optional)"
}

VERBOSE=false
JSON_OUTPUT=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --verbose) VERBOSE=true; shift ;;
        --json) JSON_OUTPUT=true; shift ;;
        -h|--help) show_help; exit 0 ;;
        *) echo -e "${RED}ERROR: Unknown option: $1${NC}"; exit 1 ;;
    esac
done

echo -e "${BLUE}Checking golems dependencies...${NC}"
echo ""

# Function to get description for a command
get_desc() {
    case $1 in
        gh) echo "GitHub CLI" ;;
        op) echo "1Password CLI" ;;
        gum) echo "Interactive prompts" ;;
        fswatch) echo "File watching" ;;
        jq) echo "JSON processing" ;;
        git) echo "Version control" ;;
        bun) echo "TypeScript runtime" ;;
        cr) echo "CodeRabbit CLI" ;;
        *) echo "$1" ;;
    esac
}

MISSING=""
INSTALLED=""
OPTIONAL_MISSING=""

# Check required dependencies
for cmd in gh op gum fswatch jq git bun; do
    if command -v "$cmd" &>/dev/null; then
        VERSION=$("$cmd" --version 2>&1 | head -1)
        if [ -n "$INSTALLED" ]; then
            INSTALLED="$INSTALLED $cmd"
        else
            INSTALLED="$cmd"
        fi

        if [ "$VERBOSE" = true ]; then
            echo -e "${GREEN}[OK]${NC} $cmd ($(get_desc "$cmd"))"
            echo "     Version: $VERSION"
        else
            echo -e "${GREEN}[OK]${NC} $cmd"
        fi
    else
        if [ -n "$MISSING" ]; then
            MISSING="$MISSING $cmd"
        else
            MISSING="$cmd"
        fi
        echo -e "${RED}[MISSING]${NC} $cmd ($(get_desc "$cmd"))"
    fi
done

# Check optional dependency: CodeRabbit CLI
if command -v cr &>/dev/null; then
    VERSION=$(cr --version 2>&1 | head -1)
    if [ -n "$INSTALLED" ]; then
        INSTALLED="$INSTALLED cr"
    else
        INSTALLED="cr"
    fi
    if [ "$VERBOSE" = true ]; then
        echo -e "${GREEN}[OK]${NC} cr ($(get_desc "cr"))"
        echo "     Version: $VERSION"
    else
        echo -e "${GREEN}[OK]${NC} cr"
    fi
else
    OPTIONAL_MISSING="cr"
    echo -e "${YELLOW}[OPTIONAL]${NC} cr ($(get_desc "cr")) - not installed"
fi

echo ""

# Count items
count_items() {
    if [ -z "$1" ]; then
        echo 0
    else
        echo "$1" | wc -w | tr -d ' '
    fi
}

INSTALLED_COUNT=$(count_items "$INSTALLED")
MISSING_COUNT=$(count_items "$MISSING")

# Summary
if [ "$JSON_OUTPUT" = true ]; then
    # Build JSON arrays
    installed_json=""
    for cmd in $INSTALLED; do
        if [ -n "$installed_json" ]; then
            installed_json="$installed_json,\"$cmd\""
        else
            installed_json="\"$cmd\""
        fi
    done

    missing_json=""
    for cmd in $MISSING; do
        if [ -n "$missing_json" ]; then
            missing_json="$missing_json,\"$cmd\""
        else
            missing_json="\"$cmd\""
        fi
    done

    optional_json=""
    for cmd in $OPTIONAL_MISSING; do
        if [ -n "$optional_json" ]; then
            optional_json="$optional_json,\"$cmd\""
        else
            optional_json="\"$cmd\""
        fi
    done

    echo "{"
    echo "  \"installed\": [$installed_json],"
    echo "  \"missing\": [$missing_json],"
    echo "  \"optional_missing\": [$optional_json],"
    if [ "$MISSING_COUNT" -eq 0 ]; then
        echo "  \"complete\": true"
    else
        echo "  \"complete\": false"
    fi
    echo "}"

    if [ "$MISSING_COUNT" -eq 0 ]; then
        exit 0
    else
        exit 1
    fi
fi

if [ "$MISSING_COUNT" -eq 0 ]; then
    echo -e "${GREEN}SUCCESS: All $INSTALLED_COUNT required dependencies installed${NC}"
    if [ -n "$OPTIONAL_MISSING" ]; then
        echo -e "${YELLOW}Optional: $OPTIONAL_MISSING not installed${NC}"
    fi
    exit 0
else
    echo -e "${YELLOW}Missing $MISSING_COUNT dependencies: $MISSING${NC}"
    echo ""
    echo "Install with:"
    echo "  bash ~/.claude/skills/golem-install/scripts/install-deps.sh"
    echo ""
    echo "Or manually:"
    for cmd in $MISSING; do
        case $cmd in
            gh) echo "  brew install gh" ;;
            op) echo "  brew install --cask 1password-cli" ;;
            gum) echo "  brew install gum" ;;
            fswatch) echo "  brew install fswatch" ;;
            jq) echo "  brew install jq" ;;
            git) echo "  brew install git" ;;
            bun) echo "  brew install oven-sh/bun/bun" ;;
        esac
    done
    if [ -n "$OPTIONAL_MISSING" ]; then
        echo ""
        echo "Optional:"
        for cmd in $OPTIONAL_MISSING; do
            case $cmd in
                cr) echo "  curl -fsSL https://coderabbit.ai/install.sh | bash" ;;
            esac
        done
    fi
    exit 1
fi
