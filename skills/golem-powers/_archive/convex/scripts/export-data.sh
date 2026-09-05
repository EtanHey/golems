#!/bin/bash
# scripts/export-data.sh
# Purpose: Export Convex database with timestamped backup filename
# Usage: export-data.sh [--path <output>] [--prod]

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
OUTPUT_PATH=""
USE_PROD=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --path)
            OUTPUT_PATH="$2"
            shift 2
            ;;
        --prod)
            USE_PROD=true
            shift
            ;;
        -h|--help)
            echo "Usage: export-data.sh [options]"
            echo ""
            echo "Options:"
            echo "  --path <file>   Output path (default: convex-backup-TIMESTAMP.zip)"
            echo "  --prod          Export from production deployment"
            echo "  -h, --help      Show this help"
            echo ""
            echo "Examples:"
            echo "  export-data.sh                          # Auto-named backup"
            echo "  export-data.sh --path ./my-backup.zip   # Custom path"
            echo "  export-data.sh --prod                   # Export production"
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

# Generate default output path with timestamp
if [[ -z "$OUTPUT_PATH" ]]; then
    timestamp=$(date +%Y%m%d-%H%M%S)
    OUTPUT_PATH="convex-backup-${timestamp}.zip"
fi

echo -e "${BLUE}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Convex Data Export                               ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "Output: ${GREEN}$OUTPUT_PATH${NC}"
if $USE_PROD; then
    echo -e "Source: ${YELLOW}PRODUCTION${NC}"
else
    echo -e "Source: ${GREEN}Development${NC}"
fi
echo ""

# Check if output file exists
if [[ -f "$OUTPUT_PATH" ]]; then
    echo -e "${YELLOW}WARNING: File already exists: $OUTPUT_PATH${NC}"
    read -r -p "Overwrite? (y/N): " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}Export cancelled${NC}"
        exit 0
    fi
fi

# Build command
cmd="npx convex export --path $OUTPUT_PATH"
if $USE_PROD; then
    cmd="$cmd --prod"
fi

echo -e "Running: ${GREEN}$cmd${NC}"
echo ""

# Execute
if $USE_PROD; then
    npx convex export --path "$OUTPUT_PATH" --prod
else
    npx convex export --path "$OUTPUT_PATH"
fi

# Verify export
if [[ -f "$OUTPUT_PATH" ]]; then
    size=$(stat -f%z "$OUTPUT_PATH" 2>/dev/null | awk '{printf "%.1fK", $1/1024}')
    echo ""
    echo -e "${GREEN}SUCCESS: Export complete${NC}"
    echo -e "File: ${GREEN}$OUTPUT_PATH${NC} (${size})"
else
    echo ""
    echo -e "${RED}ERROR: Export file not created${NC}"
    exit 1
fi
