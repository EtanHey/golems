#!/bin/bash
# scripts/deploy.sh
# Purpose: Deploy Convex to production with optional 1Password key retrieval
# Usage: deploy.sh [--key <key>] [--1p] [--dry-run]

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
DEPLOY_KEY=""
USE_1P=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --key)
            DEPLOY_KEY="$2"
            shift 2
            ;;
        --1p)
            USE_1P=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        -h|--help)
            echo "Usage: deploy.sh [options]"
            echo ""
            echo "Options:"
            echo "  --key <key>   Use provided deploy key"
            echo "  --1p          Fetch deploy key from 1Password"
            echo "  --dry-run     Show what would happen without deploying"
            echo "  -h, --help    Show this help"
            echo ""
            echo "Environment:"
            echo "  CONVEX_DEPLOY_KEY   If set, used automatically"
            echo ""
            echo "Example:"
            echo "  deploy.sh                  # Uses CONVEX_DEPLOY_KEY from env"
            echo "  deploy.sh --1p             # Fetches key from 1Password"
            echo "  deploy.sh --key prod:xxx   # Uses provided key"
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

echo -e "${BLUE}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Convex Production Deploy                         ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════╝${NC}"
echo ""

# Clean orphan .js files first
js_count=$(find convex -maxdepth 1 -name "*.js" -type f 2>/dev/null | wc -l | tr -d ' ')
if [[ "$js_count" -gt 0 ]]; then
    echo -e "${YELLOW}Cleaning $js_count orphan .js file(s) in convex/...${NC}"
    rm -f convex/*.js
    echo -e "${GREEN}Cleaned${NC}"
    echo ""
fi

# Determine deploy key
if [[ -n "$DEPLOY_KEY" ]]; then
    echo -e "Using provided deploy key"
elif $USE_1P; then
    echo -e "Fetching deploy key from 1Password..."
    if ! command -v op &> /dev/null; then
        echo -e "${RED}ERROR: 1Password CLI (op) not installed${NC}"
        echo "Install: brew install --cask 1password-cli"
        exit 1
    fi

    # Try common locations
    project_name=$(basename "$(pwd)")
    DEPLOY_KEY=$(op read "op://Private/${project_name}/convex/CONVEX_DEPLOY_KEY" 2>/dev/null || \
                 op read "op://Private/convex/CONVEX_DEPLOY_KEY" 2>/dev/null || \
                 echo "")

    if [[ -z "$DEPLOY_KEY" ]]; then
        echo -e "${RED}ERROR: Could not find CONVEX_DEPLOY_KEY in 1Password${NC}"
        echo "Tried:"
        echo "  - op://Private/${project_name}/convex/CONVEX_DEPLOY_KEY"
        echo "  - op://Private/convex/CONVEX_DEPLOY_KEY"
        exit 1
    fi
    echo -e "${GREEN}Key retrieved${NC}"
elif [[ -n "$CONVEX_DEPLOY_KEY" ]]; then
    DEPLOY_KEY="$CONVEX_DEPLOY_KEY"
    echo -e "Using CONVEX_DEPLOY_KEY from environment"
else
    echo -e "${YELLOW}No deploy key provided - will use interactive auth${NC}"
fi

echo ""

# Build command
if [[ -n "$DEPLOY_KEY" ]]; then
    export CONVEX_DEPLOY_KEY="$DEPLOY_KEY"
fi

if $DRY_RUN; then
    echo -e "${YELLOW}DRY RUN - would execute:${NC}"
    echo "  npx convex deploy"
    if [[ -n "$DEPLOY_KEY" ]]; then
        echo "  (with CONVEX_DEPLOY_KEY set)"
    fi
    echo ""
    echo -e "${GREEN}SUCCESS: Dry run complete${NC}"
    exit 0
fi

echo -e "Running: ${GREEN}npx convex deploy${NC}"
echo ""

# Execute
if npx convex deploy; then
    echo ""
    echo -e "${GREEN}SUCCESS: Deployment complete${NC}"
else
    echo ""
    echo -e "${RED}ERROR: Deployment failed${NC}"
    exit 1
fi
