#!/bin/bash
# scripts/migrate-env.sh
# Purpose: Migrate .env file to 1Password with project/service nesting
# Usage: migrate-env.sh <.env path> [--dry-run] [--vault <name>] [--project <name>]

set -e

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Service prefix mapping
declare -A SERVICE_MAP=(
    ["ANTHROPIC"]="anthropic"
    ["OPENAI"]="openai"
    ["SUPABASE"]="supabase"
    ["DATABASE"]="db"
    ["DB"]="db"
    ["POSTGRES"]="db"
    ["MYSQL"]="db"
    ["MONGO"]="db"
    ["MONGODB"]="db"
    ["REDIS"]="redis"
    ["STRIPE"]="stripe"
    ["AWS"]="aws"
    ["VERCEL"]="vercel"
    ["GITHUB"]="github"
    ["LINEAR"]="linear"
    ["FIGMA"]="figma"
    ["TWILIO"]="twilio"
    ["SENDGRID"]="sendgrid"
    ["SLACK"]="slack"
    ["FIREBASE"]="firebase"
    ["GOOGLE"]="google"
    ["AZURE"]="azure"
    ["CLOUDFLARE"]="cloudflare"
)

# Global variables (not project-specific)
GLOBAL_VARS=(
    "EDITOR" "VISUAL" "PATH" "HOME" "USER" "SHELL" "TERM" "LANG" "LC_ALL"
    "GIT_AUTHOR_NAME" "GIT_AUTHOR_EMAIL" "GIT_COMMITTER_NAME" "GIT_COMMITTER_EMAIL"
)

# Parse arguments
ENV_FILE=""
DRY_RUN=false
VAULT="Private"
PROJECT=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --vault)
            VAULT="$2"
            shift 2
            ;;
        --project)
            PROJECT="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: migrate-env.sh <.env path> [options]"
            echo ""
            echo "Options:"
            echo "  --dry-run         Preview without making changes"
            echo "  --vault <name>    Target vault (default: Private)"
            echo "  --project <name>  Project name (default: current directory)"
            echo ""
            echo "Example:"
            echo "  migrate-env.sh .env --dry-run"
            echo "  migrate-env.sh ~/myapp/.env --vault Work --project myapp"
            exit 0
            ;;
        *)
            if [[ -z "$ENV_FILE" ]]; then
                ENV_FILE="$1"
            fi
            shift
            ;;
    esac
done

# Validate .env file
if [[ -z "$ENV_FILE" ]]; then
    echo -e "${RED}ERROR: .env file path required${NC}"
    echo "Usage: migrate-env.sh <.env path> [--dry-run]"
    exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
    echo -e "${RED}ERROR: File not found: $ENV_FILE${NC}"
    exit 1
fi

# Set project name if not provided
if [[ -z "$PROJECT" ]]; then
    PROJECT=$(basename "$(pwd)")
fi

# Check op CLI
if ! command -v op &> /dev/null; then
    echo -e "${RED}ERROR: 1Password CLI (op) not installed${NC}"
    echo "Install: brew install --cask 1password-cli"
    exit 1
fi

# Check authentication
if ! op account list &>/dev/null; then
    echo -e "${RED}ERROR: Not signed in to 1Password${NC}"
    echo "Run: op signin"
    exit 1
fi

# Check vault exists
if ! op vault get "$VAULT" &>/dev/null; then
    echo -e "${RED}ERROR: Vault not found: $VAULT${NC}"
    echo "Available vaults:"
    op vault list
    exit 1
fi

# Detect service from key
detect_service() {
    local key="$1"
    local prefix

    # Extract prefix (everything before first underscore)
    prefix="${key%%_*}"

    # Check service map
    if [[ -n "${SERVICE_MAP[$prefix]}" ]]; then
        echo "${SERVICE_MAP[$prefix]}"
        return
    fi

    # Check for multi-word prefixes
    for svc_prefix in "${!SERVICE_MAP[@]}"; do
        if [[ "$key" == "${svc_prefix}_"* ]]; then
            echo "${SERVICE_MAP[$svc_prefix]}"
            return
        fi
    done

    echo "misc"
}

# Normalize key (strip service prefix)
normalize_key() {
    local key="$1"
    local service="$2"

    # Find the matching prefix
    for prefix in "${!SERVICE_MAP[@]}"; do
        if [[ "${SERVICE_MAP[$prefix]}" == "$service" && "$key" == "${prefix}_"* ]]; then
            echo "${key#${prefix}_}"
            return
        fi
    done

    # No prefix found, return original key
    echo "$key"
}

# Check if key is global
is_global_var() {
    local key="$1"
    for gv in "${GLOBAL_VARS[@]}"; do
        if [[ "$key" == "$gv" ]]; then
            return 0
        fi
    done
    return 1
}

echo -e "${BLUE}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  1Password .env Migration                         ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "File:    ${GREEN}$ENV_FILE${NC}"
echo -e "Project: ${GREEN}$PROJECT${NC}"
echo -e "Vault:   ${GREEN}$VAULT${NC}"
if $DRY_RUN; then
    echo -e "Mode:    ${YELLOW}DRY RUN (no changes)${NC}"
fi
echo ""
echo "───────────────────────────────────────────────────────"

# Counters
total=0
migrated=0
skipped=0
updated=0

# Template file
TEMPLATE_FILE="${ENV_FILE}.template"
if $DRY_RUN; then
    echo -e "${YELLOW}Template preview:${NC}"
else
    > "$TEMPLATE_FILE"  # Clear/create template file
fi

# Process .env file
while IFS= read -r line || [[ -n "$line" ]]; do
    # Skip empty lines and comments
    if [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]]; then
        if ! $DRY_RUN && [[ -n "$line" ]]; then
            echo "$line" >> "$TEMPLATE_FILE"
        fi
        continue
    fi

    # Parse KEY=VALUE
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
        key="${BASH_REMATCH[1]}"
        value="${BASH_REMATCH[2]}"

        # Remove quotes if present
        value="${value#\"}"
        value="${value%\"}"
        value="${value#\'}"
        value="${value%\'}"

        ((total++))

        # Determine scope and path
        if is_global_var "$key"; then
            scope="_global"
            service="misc"
            normalized_key="$key"
        else
            scope="$PROJECT"
            service=$(detect_service "$key")
            normalized_key=$(normalize_key "$key" "$service")
        fi

        item_title="${scope}/${service}/${normalized_key}"
        op_ref="op://${VAULT}/${item_title}/password"

        if $DRY_RUN; then
            echo -e "  ${GREEN}$key${NC}"
            echo -e "    → Service: ${BLUE}$service${NC}"
            echo -e "    → Item:    ${BLUE}$item_title${NC}"
            echo -e "    → Ref:     ${YELLOW}$op_ref${NC}"
            echo ""
        else
            # Check if item exists
            if op item get "$item_title" --vault "$VAULT" &>/dev/null 2>&1; then
                echo -e "${YELLOW}EXISTS:${NC} $item_title"
                read -p "  Overwrite? (y/N): " confirm
                if [[ "$confirm" =~ ^[Yy]$ ]]; then
                    if op item edit "$item_title" --vault "$VAULT" "password=$value" &>/dev/null; then
                        echo -e "  ${GREEN}Updated${NC}"
                        ((updated++))
                    else
                        echo -e "  ${RED}Failed to update${NC}"
                        ((skipped++))
                    fi
                else
                    echo -e "  ${YELLOW}Skipped${NC}"
                    ((skipped++))
                fi
            else
                # Create new item
                if op item create --category "Password" --title "$item_title" --vault "$VAULT" "password=$value" &>/dev/null; then
                    echo -e "${GREEN}CREATED:${NC} $item_title"
                    ((migrated++))
                else
                    echo -e "${RED}FAILED:${NC} $item_title"
                    ((skipped++))
                fi
            fi

            # Add to template
            echo "${key}=${op_ref}" >> "$TEMPLATE_FILE"
        fi
    fi
done < "$ENV_FILE"

echo ""
echo "───────────────────────────────────────────────────────"
echo ""

if $DRY_RUN; then
    echo -e "${YELLOW}DRY RUN COMPLETE${NC}"
    echo -e "Found: ${GREEN}$total${NC} secrets"
    echo ""
    echo "Run without --dry-run to migrate."
else
    echo -e "${GREEN}MIGRATION COMPLETE${NC}"
    echo -e "  Created:  ${GREEN}$migrated${NC}"
    echo -e "  Updated:  ${YELLOW}$updated${NC}"
    echo -e "  Skipped:  ${YELLOW}$skipped${NC}"
    echo -e "  Total:    ${BLUE}$total${NC}"
    echo ""
    echo -e "Template created: ${GREEN}$TEMPLATE_FILE${NC}"
    echo ""
    echo "Usage:"
    echo "  op inject -i $TEMPLATE_FILE -o .env"
    echo "  op run --env-file=$TEMPLATE_FILE -- npm run dev"
fi
