#!/bin/bash
# scripts/dev.sh
# Purpose: Start Convex dev server with auto-cleanup of orphan .js files
# Usage: dev.sh [--no-codegen] [--deployment <name>]

set -e

# REQUIRED: Self-detect script location (works from any cwd)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
NO_CODEGEN=""
DEPLOYMENT=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --no-codegen)
            NO_CODEGEN="--no-codegen"
            shift
            ;;
        --deployment)
            DEPLOYMENT="--deployment $2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: dev.sh [options]"
            echo ""
            echo "Options:"
            echo "  --no-codegen         Skip type generation"
            echo "  --deployment <name>  Connect to specific deployment"
            echo "  -h, --help           Show this help"
            echo ""
            echo "Example:"
            echo "  dev.sh"
            echo "  dev.sh --deployment my-project-dev"
            exit 0
            ;;
        *)
            echo -e "${RED}ERROR: Unknown option: $1${NC}"
            echo "Use -h for help"
            exit 1
            ;;
    esac
done

# Verify Convex project
if [[ ! -d "convex" ]]; then
    echo -e "${RED}ERROR: No convex/ directory found${NC}"
    echo "Run 'npx convex init' to initialize a Convex project"
    exit 1
fi

# Check for package.json
if [[ ! -f "package.json" ]]; then
    echo -e "${RED}ERROR: No package.json found${NC}"
    echo "Run 'npm init' or ensure you're in the project root"
    exit 1
fi

echo -e "${BLUE}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Convex Dev Server                                ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════╝${NC}"
echo ""

# Clean orphan .js files
js_count=$(find convex -maxdepth 1 -name "*.js" -type f 2>/dev/null | wc -l | tr -d ' ')
if [[ "$js_count" -gt 0 ]]; then
    echo -e "${YELLOW}Cleaning $js_count orphan .js file(s) in convex/...${NC}"
    rm -f convex/*.js
    echo -e "${GREEN}Cleaned${NC}"
fi

# Build command
cmd="npx convex dev"
[[ -n "$NO_CODEGEN" ]] && cmd="$cmd $NO_CODEGEN"
[[ -n "$DEPLOYMENT" ]] && cmd="$cmd $DEPLOYMENT"

echo -e "Running: ${GREEN}$cmd${NC}"
echo ""

# Execute
exec $cmd
