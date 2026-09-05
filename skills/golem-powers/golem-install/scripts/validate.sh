#!/bin/bash
# scripts/validate.sh
# Purpose: Validate full golems installation
# Usage: bash validate.sh

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Help text
show_help() {
    echo "Usage: validate.sh [options]"
    echo ""
    echo "Options:"
    echo "  --quick     Quick check (dependencies only)"
    echo "  --skills-only  Skill-symlink + directory checks only (no 1Password, no network)"
    echo "  --json      Output as JSON"
    echo "  -h, --help  Show this help"
    echo ""
    echo "Validates:"
    echo "  - All CLI dependencies installed"
    echo "  - 1Password signed in with vault access"
    echo "  - API tokens accessible"
    echo "  - Config directories exist"
    echo "  - Skill symlinks valid"
}

QUICK=false
SKILLS_ONLY=false
JSON_OUTPUT=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --quick) QUICK=true; shift ;;
        --skills-only) SKILLS_ONLY=true; shift ;;
        --json) JSON_OUTPUT=true; shift ;;
        -h|--help) show_help; exit 0 ;;
        *) echo -e "${RED}ERROR: Unknown option: $1${NC}"; exit 1 ;;
    esac
done

echo -e "${BLUE}Validating golems installation...${NC}"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# scripts/ -> golem-install/ -> golem-powers/ -> skills/ -> repo root
GOLEMS_DIR="${GOLEMS_DIR:-$(cd "$SCRIPT_DIR/../../../.." && pwd)}"
CLEANUP_SCRIPT="$SCRIPT_DIR/cleanup-legacy-commands.sh"

PASS=0
FAIL=0

check() {
    local name="$1"
    local cmd="$2"

    if eval "$cmd" &>/dev/null; then
        echo -e "${GREEN}[PASS]${NC} $name"
        ((++PASS))
    else
        echo -e "${RED}[FAIL]${NC} $name"
        ((++FAIL))
    fi
}

check_warn() {
    local name="$1"
    local cmd="$2"

    if eval "$cmd" &>/dev/null; then
        echo -e "${GREEN}[PASS]${NC} $name"
        ((++PASS))
    else
        echo -e "${YELLOW}[WARN]${NC} $name"
        # Warnings don't count as failures
    fi
}

# Assert a spot-check skill is symlinked — but only if the checkout still ships it.
check_skill_linked() {
    local name="$1"
    if [ -d "$GOLEMS_DIR/skills/golem-powers/$name" ]; then
        check "$name skill (Claude Code)" "test -L ~/.claude/skills/$name"
    else
        echo -e "${YELLOW}[SKIP]${NC} $name skill — not in $GOLEMS_DIR/skills/golem-powers/"
    fi
}

codex_config_has_top_level_value() {
    local key="$1"
    local expected="$2"
    local config_path="${CODEX_CONFIG_PATH:-$HOME/.codex/config.toml}"

    [ -f "$config_path" ] || return 1
    awk -v key="$key" -v expected="$expected" '
      /^[[:space:]]*\[/ { exit }
      /^[[:space:]]*#/ { next }
      {
        line = $0
        sub(/[[:space:]]*#.*/, "", line)
        pattern = "^[[:space:]]*" key "[[:space:]]*=[[:space:]]*\\\"" expected "\\\"[[:space:]]*$"
        if (line ~ pattern) found = 1
      }
      END { exit found ? 0 : 1 }
    ' "$config_path"
}

if [ "$SKILLS_ONLY" != true ]; then
# Section: Core Dependencies
echo "=== Core Dependencies ==="
check "gh (GitHub CLI)" "command -v gh"
check "op (1Password CLI)" "command -v op"
check "gum (Interactive prompts)" "command -v gum"
check "fswatch (File watching)" "command -v fswatch"
check "jq (JSON processing)" "command -v jq"
check "git (Version control)" "command -v git"
echo ""

# Section: TypeScript Skills Dependencies
echo "=== TypeScript Skills Dependencies ==="
check "bun (TypeScript runtime)" "command -v bun"
check_warn "cr (CodeRabbit CLI)" "command -v cr"
echo ""

# Codex -s is a compatibility no-op. These host defaults keep worker launches
# non-interactive and unrestricted without injecting bypass flags.
echo "=== Codex Safety Defaults ==="
check "Codex approval_policy is never" "codex_config_has_top_level_value approval_policy never"
check "Codex sandbox_mode is danger-full-access" "codex_config_has_top_level_value sandbox_mode danger-full-access"
echo ""

if [ "$QUICK" = true ]; then
    echo "=== Summary ==="
    echo "Passed: $PASS"
    echo "Failed: $FAIL"

    if [ $FAIL -eq 0 ]; then
        echo -e "\n${GREEN}All dependency checks passed${NC}"
        exit 0
    else
        echo -e "\n${RED}$FAIL checks failed${NC}"
        exit 1
    fi
fi

# Section: 1Password
echo "=== 1Password ==="
check "op signed in" "op account list 2>/dev/null | grep -q ."
check_warn "GitHub token accessible" "op read 'op://Private/github-token/credential' 2>/dev/null"
echo ""

# Section: Skills API Keys
echo "=== Skills API Keys (golems) ==="
check_warn "Context7 API key" "op read 'op://Private/golems/context7/API_KEY' 2>/dev/null | grep -q '^ctx7sk'"
check_warn "Linear API key" "op read 'op://Private/golems/linear/API_KEY' 2>/dev/null | grep -vq 'PLACEHOLDER'"
echo ""
fi

# Section: Directories
echo "=== Directories ==="
check "~/.config/golems exists" "test -d ~/.config/golems"
check_warn "~/.claude/skills exists (Claude Code)" "test -d ~/.claude/skills"
check_warn "~/.agents/skills exists (Codex/Cursor/Gemini)" "test -d ~/.agents/skills"
check_warn "~/.claude/CLAUDE.md exists" "test -f ~/.claude/CLAUDE.md"
check_warn "~/.claude/contexts exists" "test -d ~/.claude/contexts"
check_warn "~/.claude/contexts/base.md exists" "test -f ~/.claude/contexts/base.md"
echo ""

# Section: Skill Symlinks — Claude Code
# AIDEV-NOTE: skills/ only. CC walks commands/**/*.md recursively, so a skill dir
# symlinked there lists every sub-file as its own "skill".
echo "=== Skill Symlinks (Claude Code — ~/.claude/skills/) ==="
if [ -d ~/.claude/skills ]; then
  # AIDEV-NOTE: spot-check names drift — github/ and context7/ were removed from
  # golem-powers while these lines still demanded their symlinks, so validate.sh
  # reported a broken install on a healthy machine. Only assert on skills the
  # checkout actually ships.
  check_skill_linked github
  check_skill_linked context7
  check_skill_linked coderabbit
  # AIDEV-NOTE: three legacy shapes exist (symlink into golems, golems-cli backfill
  # symlink into ~/.claude/skills/<name>, and a REAL mkdir'd directory). Grepping
  # `ls -l` for 'skills/golem-powers' misses the last two. Delegate to the script
  # that knows all three — tested in scripts/tests/test-cleanup-legacy-commands.bats.
  check "no legacy golem-powers entries in ~/.claude/commands/" \
    "bash '$CLEANUP_SCRIPT' --check --only commands --golems-dir '$GOLEMS_DIR'"
  check "no dead symlinks in ~/.claude/skills/" \
    "bash '$CLEANUP_SCRIPT' --check --only skills --golems-dir '$GOLEMS_DIR'"
else
  echo "[SKIP] ~/.claude/skills/ not found (not using Claude Code, or not yet set up)"
fi
echo ""

# Section: Skill Symlinks — Codex / Cursor / Gemini
echo "=== Skill Symlinks (Codex/Cursor/Gemini — ~/.agents/skills/) ==="
if [ -d ~/.agents/skills ]; then
  skill_count=$(ls ~/.agents/skills/ 2>/dev/null | wc -l | tr -d ' ')
  [ "$skill_count" -gt "5" ] && echo "[PASS] $skill_count skills in ~/.agents/skills/" || echo "[WARN] Only $skill_count skills in ~/.agents/skills/ (expected more)"
else
  echo "[SKIP] ~/.agents/skills/ not found (only needed for Codex/Cursor/Gemini)"
fi
echo ""

# Section: Ralph (optional)
echo "=== Ralph (Optional) ==="
if [ -f ~/.config/golems/ralph.zsh ]; then
    check "ralph.zsh exists" "test -f ~/.config/golems/ralph.zsh"
    # Can't source in subshell effectively, just check file exists
else
    echo -e "${YELLOW}[SKIP]${NC} ralph.zsh not installed"
fi
echo ""

# Summary
echo "=== Summary ==="
echo "Passed: $PASS"
echo "Failed: $FAIL"

if [ "$JSON_OUTPUT" = true ]; then
    echo ""
    echo "{"
    echo "  \"passed\": $PASS,"
    echo "  \"failed\": $FAIL,"
    echo "  \"complete\": $([ $FAIL -eq 0 ] && echo true || echo false)"
    echo "}"
fi

if [ $FAIL -eq 0 ]; then
    echo ""
    echo -e "${GREEN}SUCCESS: Installation validated${NC}"
    echo ""
    echo "Next steps:"
    echo "  Claude Code: restart the session, then test with /github or /commit"
    echo "  Codex:       restart session, then invoke \$commit or reference skills by name"
    echo "  Cursor/Gemini: reference skills by name in your prompts"
    exit 0
else
    echo ""
    echo -e "${RED}$FAIL checks failed - see above for details${NC}"
    exit 1
fi
