#!/bin/bash
# check-cli-helpers.sh — Verify all CLI helpers are available and responding
# Run: bash scripts/check-cli-helpers.sh
# Used by: golems wizard, golems doctor, Phase 0 pre-flight

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PASS=0
FAIL=0

check() {
  local name="$1"
  local cmd="$2"
  local timeout="${3:-10}"

  printf "  %-12s " "$name"

  if output=$(timeout "$timeout" bash -c "$cmd" 2>&1); then
    version=$(echo "$output" | head -1 | tr -d '\n' | cut -c1-60)
    echo -e "${GREEN}✓${NC} $version"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}✗${NC} not responding"
    FAIL=$((FAIL + 1))
  fi
}

echo -e "\n${BLUE}=== CLI Helper Health Check ===${NC}\n"

# Core tools
echo -e "${YELLOW}Core:${NC}"
check "bun" "bun --version"
check "git" "git --version"
check "node" "node --version"
check "claude" "claude --version 2>/dev/null || echo 'not found'"

# CLI AI helpers
echo ""
echo -e "${YELLOW}AI Helpers:${NC}"
check "gemini" "echo 'ping' | gemini 2>&1 | head -1" 15
check "cursor" "cursor agent 'respond with: OK' --output-format text 2>&1 | head -1" 30
check "codex" "npx codex exec --full-auto 'respond with just OK' 2>&1 | head -1" 30
check "kiro" "kiro-cli chat --no-interactive 'respond with: OK' 2>&1 | head -1" 15

# Optional tools
echo ""
echo -e "${YELLOW}Optional:${NC}"
check "op" "op --version 2>/dev/null || echo 'not installed'"
check "gh" "gh --version 2>/dev/null | head -1"
check "railway" "railway --version 2>/dev/null || echo 'not installed'"

# Summary
echo ""
echo -e "${BLUE}─────────────────────────────${NC}"
echo -e "  ${GREEN}$PASS pass${NC}, ${RED}$FAIL fail${NC}"
echo ""

exit $FAIL
