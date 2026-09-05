#!/bin/bash
# scripts/import-data.sh
# Purpose: Import data into Convex with safety prompts and backup warnings
# Usage: import-data.sh --path <file.zip> [--prod] [--replace] [--force]

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
INPUT_PATH=""
USE_PROD=false
REPLACE_MODE=false
FORCE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --path)
            INPUT_PATH="$2"
            shift 2
            ;;
        --prod)
            USE_PROD=true
            shift
            ;;
        --replace)
            REPLACE_MODE=true
            shift
            ;;
        --force)
            FORCE=true
            shift
            ;;
        -h|--help)
            echo "Usage: import-data.sh --path <file.zip> [options]"
            echo ""
            echo "Options:"
            echo "  --path <file>   Input file path (required)"
            echo "  --prod          Import to production deployment"
            echo "  --replace       Replace existing data (otherwise appends)"
            echo "  --force         Skip confirmation prompts"
            echo "  -h, --help      Show this help"
            echo ""
            echo "WARNING: Import can overwrite existing data!"
            echo "Always run 'export-data.sh' first to create a backup."
            echo ""
            echo "Examples:"
            echo "  import-data.sh --path ./backup.zip"
            echo "  import-data.sh --path ./backup.zip --replace"
            echo "  import-data.sh --path ./backup.zip --prod --force"
            exit 0
            ;;
        *)
            echo -e "${RED}ERROR: Unknown option: $1${NC}"
            echo "Use -h for help"
            exit 1
            ;;
    esac
done

# Validate input path
if [[ -z "$INPUT_PATH" ]]; then
    echo -e "${RED}ERROR: Input path required${NC}"
    echo "Usage: import-data.sh --path <file.zip>"
    exit 1
fi

if [[ ! -f "$INPUT_PATH" ]]; then
    echo -e "${RED}ERROR: File not found: $INPUT_PATH${NC}"
    exit 1
fi

# Verify Convex project
if [[ ! -d "convex" ]]; then
    echo -e "${RED}ERROR: No convex/ directory found${NC}"
    echo "Run 'npx convex init' to initialize a Convex project"
    exit 1
fi

echo -e "${BLUE}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Convex Data Import                               ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "Input:  ${GREEN}$INPUT_PATH${NC}"
if $USE_PROD; then
    echo -e "Target: ${RED}PRODUCTION${NC}"
else
    echo -e "Target: ${GREEN}Development${NC}"
fi
if $REPLACE_MODE; then
    echo -e "Mode:   ${RED}REPLACE (overwrites existing data)${NC}"
else
    echo -e "Mode:   ${YELLOW}APPEND (adds to existing data)${NC}"
fi
echo ""

# Safety warnings
echo -e "${YELLOW}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${YELLOW}║  ⚠️  WARNING: Data import can be destructive      ║${NC}"
echo -e "${YELLOW}╚═══════════════════════════════════════════════════╝${NC}"
echo ""

if $USE_PROD && $REPLACE_MODE; then
    echo -e "${RED}DANGER: You are about to REPLACE PRODUCTION data!${NC}"
    echo ""
fi

if ! $FORCE; then
    echo "Before proceeding, ensure you have:"
    echo "  1. Created a backup with: export-data.sh"
    echo "  2. Verified the import file is correct"
    echo ""
    read -r -p "Have you created a backup? (y/N): " backup_confirm
    if [[ ! "$backup_confirm" =~ ^[Yy]$ ]]; then
        echo ""
        echo -e "${YELLOW}Please create a backup first:${NC}"
        echo "  bash ~/.claude/commands/convex/scripts/export-data.sh"
        echo ""
        echo -e "${YELLOW}Import cancelled${NC}"
        exit 0
    fi

    echo ""
    read -r -p "Proceed with import? (y/N): " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}Import cancelled${NC}"
        exit 0
    fi
fi

echo ""

# Build command
cmd="npx convex import --path $INPUT_PATH"
if $USE_PROD; then
    cmd="$cmd --prod"
fi
if $REPLACE_MODE; then
    cmd="$cmd --replace"
fi

echo -e "Running: ${GREEN}$cmd${NC}"
echo ""

# Execute
if $USE_PROD; then
    if $REPLACE_MODE; then
        npx convex import --path "$INPUT_PATH" --prod --replace
    else
        npx convex import --path "$INPUT_PATH" --prod
    fi
else
    if $REPLACE_MODE; then
        npx convex import --path "$INPUT_PATH" --replace
    else
        npx convex import --path "$INPUT_PATH"
    fi
fi

exit_code=$?

echo ""
if [[ $exit_code -eq 0 ]]; then
    echo -e "${GREEN}SUCCESS: Import complete${NC}"
else
    echo -e "${RED}ERROR: Import failed (exit code: $exit_code)${NC}"
    exit $exit_code
fi
