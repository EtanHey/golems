#!/bin/bash
# Initialize verification folder with templates for critique-waves
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Help message
if [[ "$1" == "-h" || "$1" == "--help" ]]; then
    echo -e "${BLUE}Usage:${NC} init-tracker.sh <branch-name> [goal]"
    echo ""
    echo "Arguments:"
    echo "  branch-name  Name of the branch/ticket (used for folder name)"
    echo "  goal         Optional: Number of consecutive passes needed (default: 20)"
    echo ""
    echo "Examples:"
    echo "  init-tracker.sh feature-auth"
    echo "  init-tracker.sh ENG-123-fix-bug 12"
    echo ""
    echo "Creates:"
    echo "  docs.local/<branch-name>/instructions.md"
    echo "  docs.local/<branch-name>/tracker.md"
    exit 0
fi

# Validate arguments
if [[ -z "$1" ]]; then
    echo -e "${RED}ERROR:${NC} Branch name required"
    echo "Usage: init-tracker.sh <branch-name> [goal]"
    exit 1
fi

BRANCH_NAME="$1"
GOAL="${2:-20}"  # Default goal is 20 consecutive passes
FOLDER="docs.local/${BRANCH_NAME}"

# Check if folder already exists
if [[ -d "$FOLDER" ]]; then
    echo -e "${YELLOW}WARNING:${NC} Folder already exists: $FOLDER"
    read -p "Overwrite existing files? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 1
    fi
fi

# Create folder
mkdir -p "$FOLDER"
echo -e "${GREEN}Created:${NC} $FOLDER"

# Create instructions.md template
cat > "${FOLDER}/instructions.md" << 'INSTRUCTIONS_EOF'
# Verification Instructions

## Context
[Describe what this PR/change does. What problem does it solve?]

## Files to Verify
| # | File | Purpose |
|---|------|---------|
| 1 | `path/to/file1.ts` | [What this file does] |
| 2 | `path/to/file2.sql` | [What this file does] |

## FORBIDDEN Patterns (FAIL if found)
These patterns must NOT exist in the code:

- `console.log` - Remove debug statements
- `// TODO` - Incomplete work
- `any` type - Avoid untyped code
- `SELECT *` - Be explicit with columns

## REQUIRED Patterns (FAIL if missing)
These patterns MUST exist:

- Error handling - Try/catch blocks
- Type annotations - All functions typed
- Unit tests - Test file exists
- Documentation - JSDoc comments

## Output Format for Agents
```
# Round N - Agent X
**VERDICT:** PASS or FAIL
**Checked:** [list what was verified]
**Issues:** [any problems found, or "None"]
```
INSTRUCTIONS_EOF

echo -e "${GREEN}Created:${NC} ${FOLDER}/instructions.md"

# Create tracker.md template
cat > "${FOLDER}/tracker.md" << TRACKER_EOF
# ${BRANCH_NAME} Verification Tracker

## Goal: ${GOAL} Consecutive Passes

## Current Status
- **Consecutive Passes:** 0
- **Total Rounds:** 0
- **Last Updated:** $(date '+%Y-%m-%d %H:%M:%S')

## Files Under Verification
| # | File | Purpose |
|---|------|---------|
| 1 | \`path/to/file1.ts\` | Description |
| 2 | \`path/to/file2.sql\` | Description |

## Verification Rules

### FORBIDDEN Patterns (FAIL if found):
- console.log
- // TODO
- any type usage
- SELECT *

### REQUIRED Patterns (FAIL if missing):
- Error handling
- Type annotations
- Unit tests
- Documentation

## Wave Log
| Round | Agent 1 | Agent 2 | Agent 3 | Result | Notes |
|-------|---------|---------|---------|--------|-------|
| 1     | -       | -       | -       | -      | -     |
TRACKER_EOF

echo -e "${GREEN}Created:${NC} ${FOLDER}/tracker.md"

# Summary
echo ""
echo -e "${GREEN}SUCCESS:${NC} Verification folder initialized"
echo ""
echo "Files created:"
echo "  - ${FOLDER}/instructions.md (edit with your verification rules)"
echo "  - ${FOLDER}/tracker.md (tracks wave progress)"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Edit instructions.md with your files and patterns"
echo "  2. Update tracker.md with matching files/rules"
echo "  3. Run your first wave using the critique-waves skill"
