#!/bin/bash
# scripts/archive-snapshot.sh
# Purpose: Create a timestamped archive of the current PRD state
# Usage: bash archive-snapshot.sh [app-name]

set -e

# REQUIRED: Self-detect script location (works from any cwd)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Help text
show_help() {
    echo "Usage: archive-snapshot.sh [app-name]"
    echo ""
    echo "Arguments:"
    echo "  app-name    Optional app name for multi-app repos"
    echo ""
    echo "Options:"
    echo "  -h, --help  Show this help"
    echo ""
    echo "Examples:"
    echo "  bash archive-snapshot.sh           # Archive current PRD"
    echo "  bash archive-snapshot.sh frontend  # Archive frontend app PRD"
    echo ""
    echo "Archives to: docs.local/prd-archive/<timestamp>/"
}

# Parse arguments
APP_NAME=""
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help) show_help; exit 0 ;;
        -*) echo -e "${RED}ERROR: Unknown option: $1${NC}"; show_help; exit 1 ;;
        *) APP_NAME="$1"; shift ;;
    esac
done

# Determine PRD path
if [ -n "$APP_NAME" ]; then
    PRD_DIR="prd-json-$APP_NAME"
else
    PRD_DIR="prd-json"
fi

# Check PRD exists
if [ ! -d "$PRD_DIR" ]; then
    echo -e "${RED}ERROR: PRD directory not found: $PRD_DIR${NC}"
    echo ""
    echo "Expected structure:"
    echo "  $PRD_DIR/"
    echo "    index.json"
    echo "    stories/*.json"
    exit 1
fi

if [ ! -f "$PRD_DIR/index.json" ]; then
    echo -e "${RED}ERROR: index.json not found in $PRD_DIR${NC}"
    exit 1
fi

# Create archive directory
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
if [ -n "$APP_NAME" ]; then
    ARCHIVE_DIR="docs.local/prd-archive/${APP_NAME}-${TIMESTAMP}"
else
    ARCHIVE_DIR="docs.local/prd-archive/${TIMESTAMP}"
fi

echo -e "${BLUE}Creating archive snapshot...${NC}"
echo "  Source: $PRD_DIR"
echo "  Archive: $ARCHIVE_DIR"
echo ""

mkdir -p "$ARCHIVE_DIR"

# Copy index.json
cp "$PRD_DIR/index.json" "$ARCHIVE_DIR/index.json"
echo -e "${GREEN}[OK]${NC} Copied index.json"

# Copy stories
if [ -d "$PRD_DIR/stories" ]; then
    mkdir -p "$ARCHIVE_DIR/stories"
    cp "$PRD_DIR/stories"/*.json "$ARCHIVE_DIR/stories/" 2>/dev/null || true
    STORY_COUNT=$(find "$ARCHIVE_DIR/stories" -name "*.json" 2>/dev/null | wc -l | tr -d ' ')
    echo -e "${GREEN}[OK]${NC} Copied $STORY_COUNT stories"
else
    echo -e "${YELLOW}[WARN]${NC} No stories directory found"
fi

# Copy progress.txt if exists
if [ -f "progress.txt" ]; then
    cp "progress.txt" "$ARCHIVE_DIR/progress.txt"
    echo -e "${GREEN}[OK]${NC} Copied progress.txt"
fi

# Show archive stats
echo ""
echo -e "${GREEN}SUCCESS: Archive created${NC}"
echo ""

# Parse index.json stats
if command -v jq &>/dev/null; then
    STATS=$(cat "$ARCHIVE_DIR/index.json" | jq -r '.stats | "Total: \(.total), Completed: \(.completed), Pending: \(.pending)"')
    echo "  $STATS"
fi

echo "  Path: $ARCHIVE_DIR"
echo ""
echo "To restore:"
echo "  cp $ARCHIVE_DIR/stories/*.json $PRD_DIR/stories/"
echo "  cp $ARCHIVE_DIR/index.json $PRD_DIR/"
