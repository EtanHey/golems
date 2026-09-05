#!/bin/bash
# ralph-commit: Atomic commit + check criterion
# Uses pre-commit hook for tests - just handles commit + criterion marking atomically
# Usage: ./run.sh --story=US-106 --message="feat: US-106 description"

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Parse arguments
STORY_ID=""
COMMIT_MSG=""
FILES=""
DRY_RUN=false

for arg in "$@"; do
  case $arg in
    --story=*)
      STORY_ID="${arg#*=}"
      ;;
    --message=*)
      COMMIT_MSG="${arg#*=}"
      ;;
    --files=*)
      FILES="${arg#*=}"
      ;;
    --dry-run)
      DRY_RUN=true
      ;;
  esac
done

# Validate required args
if [[ -z "$STORY_ID" ]]; then
  echo -e "${RED}Error: --story=ID required${NC}"
  exit 1
fi

if [[ -z "$COMMIT_MSG" ]]; then
  echo -e "${RED}Error: --message=MSG required${NC}"
  exit 1
fi

# Find repo root (where prd-json/ lives)
REPO_ROOT=$(pwd)
while [[ ! -d "$REPO_ROOT/prd-json" && "$REPO_ROOT" != "/" ]]; do
  REPO_ROOT=$(dirname "$REPO_ROOT")
done

if [[ ! -d "$REPO_ROOT/prd-json" ]]; then
  echo -e "${RED}Error: Cannot find prd-json/ directory${NC}"
  exit 1
fi

STORY_FILE="$REPO_ROOT/prd-json/stories/${STORY_ID}.json"

if [[ ! -f "$STORY_FILE" ]]; then
  echo -e "${RED}Error: Story file not found: $STORY_FILE${NC}"
  exit 1
fi

echo "═══════════════════════════════════════════════════════════════"
echo "  Ralph Atomic Commit: $STORY_ID"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Step 1: Commit (pre-commit hook runs tests)
echo -e "${YELLOW}[1/2] Committing (pre-commit hook will run tests)...${NC}"

if [[ "$DRY_RUN" == "true" ]]; then
  echo "  [DRY RUN] Would commit with message: $COMMIT_MSG"
else
  # Stage files
  if [[ -n "$FILES" ]]; then
    git add $FILES
  else
    # Auto-detect: stage prd-json and any modified files
    git add "$REPO_ROOT/prd-json/" 2>/dev/null || true
    git add -u 2>/dev/null || true
  fi

  # Commit - pre-commit hook handles all testing
  if ! git commit -m "$COMMIT_MSG"; then
    echo ""
    echo -e "${RED}✗ Commit failed (tests failed in pre-commit hook)${NC}"
    echo -e "${YELLOW}→ Fix tests, then retry${NC}"
    echo -e "${YELLOW}→ Commit criterion NOT checked${NC}"
    exit 1
  fi

  echo -e "${GREEN}✓ Committed (all tests passed)${NC}"
fi

echo ""

# Step 2: Mark criterion as checked
echo -e "${YELLOW}[2/2] Marking commit criterion as checked...${NC}"

if [[ "$DRY_RUN" == "true" ]]; then
  echo "  [DRY RUN] Would mark commit criterion in $STORY_FILE"
else
  # Find the commit criterion and mark it checked using jq
  if command -v jq &> /dev/null; then
    TEMP_FILE=$(mktemp)
    jq '
      .acceptanceCriteria |= (
        to_entries |
        map(
          if (.value.text | ascii_downcase | contains("commit")) and .value.checked == false
          then .value.checked = true
          else .
          end
        ) |
        map(.value)
      )
    ' "$STORY_FILE" > "$TEMP_FILE" && mv "$TEMP_FILE" "$STORY_FILE"

    echo -e "${GREEN}✓ Marked commit criterion as checked in ${STORY_ID}.json${NC}"
  else
    echo -e "${YELLOW}⚠ jq not installed - please manually mark commit criterion${NC}"
  fi
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo -e "${GREEN}  ✓ Atomic commit complete: $STORY_ID${NC}"
echo "═══════════════════════════════════════════════════════════════"
