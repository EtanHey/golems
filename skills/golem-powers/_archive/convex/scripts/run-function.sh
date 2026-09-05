#!/bin/bash
# scripts/run-function.sh
# Purpose: Execute Convex queries, mutations, or actions
# Usage: run-function.sh <function-path> [--args '{"key":"value"}'] [--prod]

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
FUNCTION_PATH=""
ARGS=""
USE_PROD=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --args)
            ARGS="$2"
            shift 2
            ;;
        --prod)
            USE_PROD=true
            shift
            ;;
        -h|--help)
            echo "Usage: run-function.sh <function-path> [options]"
            echo ""
            echo "Arguments:"
            echo "  function-path    Path to function (e.g., api:getUsers, tasks:create)"
            echo ""
            echo "Options:"
            echo "  --args <json>    JSON arguments for the function"
            echo "  --prod           Run against production deployment"
            echo "  -h, --help       Show this help"
            echo ""
            echo "Examples:"
            echo "  run-function.sh api:getUsers"
            echo "  run-function.sh tasks:create --args '{\"title\":\"Test\"}'"
            echo "  run-function.sh api:listItems --prod"
            exit 0
            ;;
        -*)
            echo -e "${RED}ERROR: Unknown option: $1${NC}"
            echo "Use -h for help"
            exit 1
            ;;
        *)
            if [[ -z "$FUNCTION_PATH" ]]; then
                FUNCTION_PATH="$1"
            else
                echo -e "${RED}ERROR: Unexpected argument: $1${NC}"
                exit 1
            fi
            shift
            ;;
    esac
done

# Validate function path
if [[ -z "$FUNCTION_PATH" ]]; then
    echo -e "${RED}ERROR: Function path required${NC}"
    echo "Usage: run-function.sh <function-path>"
    echo "Example: run-function.sh api:getUsers"
    exit 1
fi

# Validate function path format
if [[ ! "$FUNCTION_PATH" =~ ^[a-zA-Z0-9_]+:[a-zA-Z0-9_]+$ ]]; then
    echo -e "${RED}ERROR: Invalid function path format${NC}"
    echo "Expected format: filename:functionName (e.g., api:getUsers)"
    echo "Received: $FUNCTION_PATH"
    exit 1
fi

# Verify Convex project
if [[ ! -d "convex" ]]; then
    echo -e "${RED}ERROR: No convex/ directory found${NC}"
    echo "Run 'npx convex init' to initialize a Convex project"
    exit 1
fi

echo -e "${BLUE}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Convex Function Runner                           ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "Function: ${GREEN}$FUNCTION_PATH${NC}"
if [[ -n "$ARGS" ]]; then
    echo -e "Args:     ${GREEN}$ARGS${NC}"
fi
if $USE_PROD; then
    echo -e "Target:   ${YELLOW}PRODUCTION${NC}"
else
    echo -e "Target:   ${GREEN}Development${NC}"
fi
echo ""

# Build command
cmd="npx convex run $FUNCTION_PATH"
if [[ -n "$ARGS" ]]; then
    cmd="$cmd --args '$ARGS'"
fi
if $USE_PROD; then
    cmd="$cmd --prod"
fi

echo -e "Running: ${GREEN}$cmd${NC}"
echo "───────────────────────────────────────────────────────"
echo ""

# Execute and capture output
if [[ -n "$ARGS" ]]; then
    if $USE_PROD; then
        output=$(npx convex run "$FUNCTION_PATH" --args "$ARGS" --prod 2>&1)
    else
        output=$(npx convex run "$FUNCTION_PATH" --args "$ARGS" 2>&1)
    fi
else
    if $USE_PROD; then
        output=$(npx convex run "$FUNCTION_PATH" --prod 2>&1)
    else
        output=$(npx convex run "$FUNCTION_PATH" 2>&1)
    fi
fi

exit_code=$?

echo "$output"
echo ""
echo "───────────────────────────────────────────────────────"

if [[ $exit_code -eq 0 ]]; then
    echo -e "${GREEN}SUCCESS: Function executed${NC}"
else
    echo -e "${RED}ERROR: Function failed (exit code: $exit_code)${NC}"
    exit $exit_code
fi
