#!/bin/bash
# scripts/cleanup-completed.sh
# Purpose: Remove completed stories and reset PRD for fresh start (archives first)
# Usage: bash cleanup-completed.sh [--skip-archive] [app-name]

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
    echo "Usage: cleanup-completed.sh [options] [app-name]"
    echo ""
    echo "Options:"
    echo "  --skip-archive  Skip archiving (dangerous - no recovery)"
    echo "  --dry-run       Show what would be deleted without doing it"
    echo "  -h, --help      Show this help"
    echo ""
    echo "Arguments:"
    echo "  app-name        Optional app name for multi-app repos"
    echo ""
    echo "Examples:"
    echo "  bash cleanup-completed.sh                # Archive then cleanup"
    echo "  bash cleanup-completed.sh --dry-run      # Preview cleanup"
    echo "  bash cleanup-completed.sh frontend       # Cleanup frontend app PRD"
    echo ""
    echo "What gets removed:"
    echo "  - Stories with passes=true"
    echo "  - Completed counts reset to 0"
    echo "  - progress.txt reset with fresh header"
    echo ""
    echo "What's preserved:"
    echo "  - Pending stories"
    echo "  - Blocked stories"
    echo "  - Full archive in docs.local/prd-archive/"
}

# Parse arguments
SKIP_ARCHIVE=false
DRY_RUN=false
APP_NAME=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-archive) SKIP_ARCHIVE=true; shift ;;
        --dry-run) DRY_RUN=true; shift ;;
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
    exit 1
fi

if [ ! -f "$PRD_DIR/index.json" ]; then
    echo -e "${RED}ERROR: index.json not found in $PRD_DIR${NC}"
    exit 1
fi

# Check for jq
if ! command -v jq &>/dev/null; then
    echo -e "${RED}ERROR: jq is required but not installed${NC}"
    echo "Install with: brew install jq"
    exit 1
fi

echo -e "${BLUE}Scanning for completed stories...${NC}"
echo ""

# Find completed stories
COMPLETED=()
PENDING=()
BLOCKED=()

for story_file in "$PRD_DIR/stories"/*.json; do
    [ -f "$story_file" ] || continue
    STORY_ID=$(basename "$story_file" .json)
    PASSES=$(jq -r '.passes // false' "$story_file")

    if [ "$PASSES" = "true" ]; then
        COMPLETED+=("$STORY_ID")
    else
        # Check if blocked
        BLOCKED_BY=$(jq -r '.blockedBy // empty' "$story_file")
        if [ -n "$BLOCKED_BY" ]; then
            BLOCKED+=("$STORY_ID")
        else
            PENDING+=("$STORY_ID")
        fi
    fi
done

echo "  Completed (to remove): ${#COMPLETED[@]}"
echo "  Pending (keeping): ${#PENDING[@]}"
echo "  Blocked (keeping): ${#BLOCKED[@]}"
echo ""

if [ ${#COMPLETED[@]} -eq 0 ]; then
    echo -e "${YELLOW}No completed stories to clean up${NC}"
    exit 0
fi

if [ "$DRY_RUN" = true ]; then
    echo -e "${YELLOW}[DRY RUN] Would remove these stories:${NC}"
    for id in "${COMPLETED[@]}"; do
        echo "  - $id"
    done
    echo ""
    echo "Run without --dry-run to perform cleanup"
    exit 0
fi

# Archive first (unless skipped)
if [ "$SKIP_ARCHIVE" = false ]; then
    echo -e "${BLUE}Archiving before cleanup...${NC}"
    SCRIPT_DIR="$(dirname "$0")"
    if [ -n "$APP_NAME" ]; then
        bash "$SCRIPT_DIR/archive-snapshot.sh" "$APP_NAME"
    else
        bash "$SCRIPT_DIR/archive-snapshot.sh"
    fi
    echo ""
else
    echo -e "${YELLOW}WARNING: Skipping archive - no recovery available${NC}"
    echo ""
fi

# Remove completed stories
echo -e "${BLUE}Removing completed stories...${NC}"
for id in "${COMPLETED[@]}"; do
    rm "$PRD_DIR/stories/$id.json"
    echo -e "  ${RED}[DELETED]${NC} $id"
done
echo ""

# Update index.json
echo -e "${BLUE}Updating index.json...${NC}"

# Build new pending array
NEW_PENDING_JSON=$(printf '%s\n' "${PENDING[@]}" | jq -R . | jq -s .)

# Build new blocked array
NEW_BLOCKED_JSON=$(printf '%s\n' "${BLOCKED[@]}" | jq -R . | jq -s . 2>/dev/null || echo "[]")

# Calculate new stats
NEW_TOTAL=$((${#PENDING[@]} + ${#BLOCKED[@]}))
NEW_PENDING=${#PENDING[@]}
NEW_BLOCKED=${#BLOCKED[@]}

# Build new storyOrder from remaining stories
REMAINING=("${PENDING[@]}" "${BLOCKED[@]}")
NEW_ORDER_JSON=$(printf '%s\n' "${REMAINING[@]}" | jq -R . | jq -s .)

# Determine next story
if [ ${#PENDING[@]} -gt 0 ]; then
    NEXT_STORY="${PENDING[0]}"
else
    NEXT_STORY=""
fi

# Update index.json
# Reset completed array to empty, update pending/blocked/storyOrder/nextStory
jq --argjson pending "$NEW_PENDING_JSON" \
   --argjson blocked "$NEW_BLOCKED_JSON" \
   --argjson order "$NEW_ORDER_JSON" \
   --arg next "$NEXT_STORY" \
   '.pending = $pending | .blocked = $blocked | .completed = [] | .storyOrder = $order | .nextStory = $next' \
   "$PRD_DIR/index.json" > "$PRD_DIR/index.json.tmp" && mv "$PRD_DIR/index.json.tmp" "$PRD_DIR/index.json"

echo -e "${GREEN}[OK]${NC} Stats reset: $NEW_TOTAL total, $NEW_PENDING pending, $NEW_BLOCKED blocked"

# Reset progress.txt
echo -e "${BLUE}Resetting progress.txt...${NC}"
cat > progress.txt << EOF
# Ralph Progress - Fresh Start
Started: $(date)

(Previous progress archived to docs.local/prd-archive/)

EOF
echo -e "${GREEN}[OK]${NC} progress.txt reset"

echo ""
echo -e "${GREEN}SUCCESS: Cleanup complete${NC}"
echo ""
echo "Removed: ${#COMPLETED[@]} completed stories"
echo "Remaining: $NEW_TOTAL stories ($NEW_PENDING pending, $NEW_BLOCKED blocked)"
if [ -n "$NEXT_STORY" ]; then
    echo "Next story: $NEXT_STORY"
fi
