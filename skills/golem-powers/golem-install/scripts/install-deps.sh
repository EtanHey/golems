#!/bin/bash
# scripts/install-deps.sh
# Purpose: Install missing dependencies via Homebrew
# Usage: bash install-deps.sh [--all | dep1 dep2 ...]

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Help text
show_help() {
    echo "Usage: install-deps.sh [options] [deps...]"
    echo ""
    echo "Options:"
    echo "  --all       Install all missing dependencies"
    echo "  --dry-run   Show what would be installed"
    echo "  -h, --help  Show this help"
    echo ""
    echo "Available dependencies:"
    echo "  gh        GitHub CLI"
    echo "  op        1Password CLI"
    echo "  gum       Interactive prompts"
    echo "  fswatch   File watching"
    echo "  jq        JSON processing"
    echo "  git       Version control"
    echo "  bun       TypeScript runtime"
    echo "  cr        CodeRabbit CLI (optional)"
    echo ""
    echo "Examples:"
    echo "  bash install-deps.sh --all          # Install all missing"
    echo "  bash install-deps.sh gh op bun      # Install specific deps"
    echo "  bash install-deps.sh --dry-run --all  # Preview installation"
}

# Get brew package name for a command
get_brew_pkg() {
    case $1 in
        gh) echo "gh" ;;
        op) echo "--cask 1password-cli" ;;
        gum) echo "gum" ;;
        fswatch) echo "fswatch" ;;
        jq) echo "jq" ;;
        git) echo "git" ;;
        bun) echo "oven-sh/bun/bun" ;;
        cr) echo "CURL" ;;  # Special: installed via curl
        *) echo "" ;;
    esac
}

# Check if dependency is known
is_known_dep() {
    case $1 in
        gh|op|gum|fswatch|jq|git|bun|cr) return 0 ;;
        *) return 1 ;;
    esac
}

ALL=false
DRY_RUN=false
SPECIFIC_DEPS=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --all) ALL=true; shift ;;
        --dry-run) DRY_RUN=true; shift ;;
        -h|--help) show_help; exit 0 ;;
        -*) echo -e "${RED}ERROR: Unknown option: $1${NC}"; exit 1 ;;
        *)
            if [ -n "$SPECIFIC_DEPS" ]; then
                SPECIFIC_DEPS="$SPECIFIC_DEPS $1"
            else
                SPECIFIC_DEPS="$1"
            fi
            shift
            ;;
    esac
done

# Check for Homebrew
if ! command -v brew &>/dev/null; then
    echo -e "${RED}ERROR: Homebrew is not installed${NC}"
    echo ""
    echo "Install Homebrew first:"
    echo '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
    exit 1
fi

echo -e "${BLUE}Checking for missing dependencies...${NC}"
echo ""

# Find missing deps
MISSING=""
for cmd in gh op gum fswatch jq git bun; do
    if ! command -v "$cmd" &>/dev/null; then
        if [ -n "$MISSING" ]; then
            MISSING="$MISSING $cmd"
        else
            MISSING="$cmd"
        fi
    fi
done

# Determine what to install
TO_INSTALL=""
if [ "$ALL" = true ]; then
    TO_INSTALL="$MISSING"
elif [ -n "$SPECIFIC_DEPS" ]; then
    for dep in $SPECIFIC_DEPS; do
        if is_known_dep "$dep"; then
            if ! command -v "$dep" &>/dev/null; then
                if [ -n "$TO_INSTALL" ]; then
                    TO_INSTALL="$TO_INSTALL $dep"
                else
                    TO_INSTALL="$dep"
                fi
            else
                echo -e "${YELLOW}$dep is already installed${NC}"
            fi
        else
            echo -e "${RED}ERROR: Unknown dependency: $dep${NC}"
            exit 1
        fi
    done
else
    if [ -z "$MISSING" ]; then
        echo "Missing dependencies: none"
    else
        echo "Missing dependencies: $MISSING"
    fi
    echo ""
    echo "Usage:"
    echo "  bash install-deps.sh --all           # Install all missing"
    echo "  bash install-deps.sh gh op gum       # Install specific"
    exit 0
fi

if [ -z "$TO_INSTALL" ]; then
    echo -e "${GREEN}All requested dependencies are already installed${NC}"
    exit 0
fi

echo "Will install: $TO_INSTALL"
echo ""

if [ "$DRY_RUN" = true ]; then
    echo -e "${YELLOW}[DRY RUN] Would run:${NC}"
    for dep in $TO_INSTALL; do
        pkg=$(get_brew_pkg "$dep")
        if [ "$pkg" = "CURL" ]; then
            echo "  curl -fsSL https://coderabbit.ai/install.sh | bash"
        else
            echo "  brew install $pkg"
        fi
    done
    exit 0
fi

# Install each dependency
for dep in $TO_INSTALL; do
    echo -e "${BLUE}Installing $dep...${NC}"
    pkg=$(get_brew_pkg "$dep")
    if [ "$pkg" = "CURL" ]; then
        # Special handling for CodeRabbit CLI
        curl -fsSL https://coderabbit.ai/install.sh | bash
    else
        # shellcheck disable=SC2086 # Intentional word splitting for --cask flag
        brew install $pkg
    fi
    if command -v "$dep" &>/dev/null; then
        echo -e "${GREEN}[OK]${NC} $dep installed"
    else
        echo -e "${RED}[FAIL]${NC} $dep installation failed"
    fi
    echo ""
done

# Verify installation
echo -e "${BLUE}Verifying installation...${NC}"
echo ""

INSTALLED=0
FAILED=0
for dep in $TO_INSTALL; do
    if command -v "$dep" &>/dev/null; then
        echo -e "${GREEN}[OK]${NC} $dep"
        INSTALLED=$((INSTALLED + 1))
    else
        echo -e "${RED}[FAIL]${NC} $dep"
        FAILED=$((FAILED + 1))
    fi
done

echo ""
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}SUCCESS: Installed $INSTALLED dependencies${NC}"
    exit 0
else
    echo -e "${YELLOW}Installed $INSTALLED, failed $FAILED${NC}"
    exit 1
fi
