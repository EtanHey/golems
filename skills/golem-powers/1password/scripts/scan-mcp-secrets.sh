#!/bin/bash
# scripts/scan-mcp-secrets.sh
# Purpose: Scan MCP configs for hardcoded API keys and secrets
# Usage: scan-mcp-secrets.sh [--verbose]

set -e

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

VERBOSE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --verbose|-v)
            VERBOSE=true
            shift
            ;;
        -h|--help)
            echo "Usage: scan-mcp-secrets.sh [--verbose]"
            echo ""
            echo "Scans MCP configuration files for hardcoded secrets."
            echo ""
            echo "Options:"
            echo "  --verbose, -v   Show all scanned files (not just those with secrets)"
            echo ""
            echo "Checked locations:"
            echo "  - ~/.config/*/mcp.json"
            echo "  - ~/.claude/mcp_settings.json"
            echo "  - */.mcp.json"
            echo "  - ~/Library/Application Support/*/mcp.json"
            exit 0
            ;;
        *)
            shift
            ;;
    esac
done

echo -e "${BLUE}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  MCP Secret Scanner                               ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════╝${NC}"
echo ""

# Secret patterns to search for
SECRET_PATTERNS=(
    "api[_-]?key"
    "access[_-]?token"
    "secret[_-]?key"
    "auth[_-]?token"
    "bearer"
    "password"
    "credential"
    "private[_-]?key"
)

# Combine patterns for grep
PATTERN=$(IFS="|"; echo "${SECRET_PATTERNS[*]}")

# Common MCP config locations
MCP_LOCATIONS=(
    "$HOME/.config"
    "$HOME/.claude"
    "$HOME/Library/Application Support"
)

# Find MCP config files
find_mcp_configs() {
    local configs=()

    # Search in common locations
    for loc in "${MCP_LOCATIONS[@]}"; do
        if [[ -d "$loc" ]]; then
            while IFS= read -r -d '' file; do
                configs+=("$file")
            done < <(find "$loc" -name "*.json" -type f -print0 2>/dev/null)
        fi
    done

    # Search for .mcp.json in home and subdirectories (limited depth)
    while IFS= read -r -d '' file; do
        configs+=("$file")
    done < <(find "$HOME" -maxdepth 3 -name ".mcp.json" -type f -print0 2>/dev/null)
    while IFS= read -r -d '' file; do
        configs+=("$file")
    done < <(find "$HOME" -maxdepth 3 -name "mcp*.json" -type f -print0 2>/dev/null)

    # Return unique list
    printf '%s\n' "${configs[@]}" | sort -u
}

echo "Scanning for MCP configuration files..."
echo ""

found_secrets=0
files_scanned=0
files_with_secrets=0

# Scan each config file
while IFS= read -r config_file; do
    [[ -z "$config_file" ]] && continue
    [[ ! -f "$config_file" ]] && continue

    ((files_scanned++))

    # Check if file contains potential secrets
    if grep -iEq "$PATTERN" "$config_file" 2>/dev/null; then
        ((files_with_secrets++))
        echo -e "${YELLOW}══════════════════════════════════════════════════════${NC}"
        echo -e "${YELLOW}FILE:${NC} $config_file"
        echo ""

        # Extract lines with potential secrets (case insensitive)
        while IFS= read -r line; do
            # Skip op:// references (already secured)
            if [[ "$line" == *"op://"* ]]; then
                if $VERBOSE; then
                    echo -e "  ${GREEN}✓${NC} $line ${GREEN}(secured)${NC}"
                fi
                continue
            fi

            # Check for actual values (not just keys)
            if [[ "$line" =~ :[[:space:]]*\"[^\"]+\" ]]; then
                # Extract key and check if value looks like a secret
                key=$(echo "$line" | grep -oE '"[^"]+":' | head -1 | tr -d '":')
                value=$(echo "$line" | grep -oE ':[[:space:]]*"[^"]+"' | head -1 | sed 's/^:[[:space:]]*"//' | sed 's/"$//')

                # Skip empty values or placeholders
                if [[ -z "$value" || "$value" == "YOUR_"* || "$value" == "<"* || "$value" == "{"* ]]; then
                    if $VERBOSE; then
                        echo -e "  ${BLUE}?${NC} $key: (placeholder)"
                    fi
                    continue
                fi

                # Check if value looks like an actual secret (long string, or matches patterns)
                if [[ ${#value} -gt 20 || "$value" =~ ^(sk-|figd_|xoxb-|ghp_|gho_|ghu_|lin_) ]]; then
                    ((found_secrets++))
                    # Mask the value
                    masked_value="${value:0:4}...${value: -4}"
                    echo -e "  ${RED}✗${NC} ${CYAN}$key${NC}: ${RED}$masked_value${NC}"
                    echo -e "    ${YELLOW}→ Migrate to: _global/${key,,}/VALUE${NC}"
                fi
            fi
        done < <(grep -iE "$PATTERN" "$config_file" 2>/dev/null)
        echo ""
    elif $VERBOSE; then
        echo -e "${GREEN}✓${NC} $config_file (clean)"
    fi
done < <(find_mcp_configs)

echo "───────────────────────────────────────────────────────"
echo ""
echo -e "${BLUE}SCAN COMPLETE${NC}"
echo -e "  Files scanned:       ${BLUE}$files_scanned${NC}"
echo -e "  Files with secrets:  ${YELLOW}$files_with_secrets${NC}"
echo -e "  Hardcoded secrets:   ${RED}$found_secrets${NC}"
echo ""

if [[ $found_secrets -gt 0 ]]; then
    echo -e "${YELLOW}RECOMMENDED ACTIONS:${NC}"
    echo ""
    echo "1. For each secret found, create a 1Password item:"
    echo -e "   ${CYAN}op item create --category \"Password\" --title \"_global/service/KEY\" --vault \"Private\" \"password=VALUE\"${NC}"
    echo ""
    echo "2. Update MCP config to use op:// reference:"
    echo -e "   ${CYAN}\"key\": \"op://Private/_global/service/KEY/password\"${NC}"
    echo ""
    echo "3. Run Claude with op inject:"
    echo -e "   ${CYAN}op run -- claude${NC}"
    echo ""
    echo "See: ~/.claude/skills/1password/workflows/migrate-mcp.md"
else
    echo -e "${GREEN}No hardcoded secrets found!${NC}"
fi
