#!/usr/bin/env zsh
# setup-golem-profiles.sh — Set up personal golem profiles with symlinks
#
# Creates:
#   ~/Gits/golem-profiles/     (private git repo for personal data)
#   ~/Gits/{name}Golem/        (standalone session dirs with symlinks)
#   ~/Gits/golems/.claude/rules/owner-profile.md (symlink)
#
# Usage: scripts/setup-golem-profiles.sh [--init|--verify|--fix]
#   --init    Create golem-profiles repo from template (first time)
#   --verify  Check all symlinks are correct
#   --fix     Fix broken symlinks (re-create them)
#   (default) Set up symlinks (most common)

set -e

# --- Config ---
GITS_DIR="$HOME/Gits"
PROFILES_DIR="$GITS_DIR/golem-profiles"
GOLEMS_DIR="$GITS_DIR/golems"
TEMPLATE_PROFILE="$GOLEMS_DIR/rules-library/owner-profile.md"

# Golem definitions: parallel arrays (name -> dir name)
GOLEM_NAMES=(recruiter content monitor teller)
GOLEM_DIRS=(recruiterGolem contentGolem monitorGolem tellerGolem)

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}[OK]${NC} $1"; }
warn() { echo -e "  ${YELLOW}[!!]${NC} $1"; }
fail() { echo -e "  ${RED}[FAIL]${NC} $1"; }
info() { echo -e "  ${BLUE}[..]${NC} $1"; }

# --- Functions ---

create_symlink() {
  local target="$1"  # what the symlink points TO
  local link="$2"    # where the symlink IS

  if [ -L "$link" ]; then
    local current_target
    current_target=$(readlink "$link")
    if [ "$current_target" = "$target" ]; then
      ok "$(basename "$link") -> $(basename "$target") (already correct)"
      return 0
    else
      warn "$(basename "$link") points to wrong target, fixing..."
      rm "$link"
    fi
  elif [ -f "$link" ]; then
    warn "$(basename "$link") is a regular file, replacing with symlink..."
    rm "$link"
  fi

  ln -sf "$target" "$link"
  ok "$(basename "$link") -> $(basename "$target")"
}

setup_golem_dir() {
  local name="$1"
  local dir_name="$2"
  local golem_dir="$GITS_DIR/$dir_name"
  local profile_dir="$PROFILES_DIR/$name"

  echo ""
  echo -e "${BLUE}--- $dir_name ---${NC}"

  # Create directory structure
  mkdir -p "$golem_dir/.claude/rules"

  # Symlink CLAUDE.md
  if [ -f "$profile_dir/CLAUDE.md" ]; then
    create_symlink "$profile_dir/CLAUDE.md" "$golem_dir/CLAUDE.md"
  else
    warn "No CLAUDE.md in $profile_dir — create one for $name"
  fi

  # Symlink .mcp.json
  if [ -f "$profile_dir/.mcp.json" ]; then
    create_symlink "$profile_dir/.mcp.json" "$golem_dir/.mcp.json"
  else
    warn "No .mcp.json in $profile_dir — create one for $name"
  fi

  # Symlink owner-profile.md into .claude/rules/
  create_symlink "$PROFILES_DIR/owner-profile.md" "$golem_dir/.claude/rules/owner-profile.md"
}

init_profiles() {
  echo -e "${BLUE}=== Initialize golem-profiles ===${NC}"
  echo ""

  if [ -d "$PROFILES_DIR/.git" ]; then
    ok "golem-profiles already exists at $PROFILES_DIR"
    return 0
  fi

  info "Creating $PROFILES_DIR..."
  mkdir -p "$PROFILES_DIR"

  # Copy template
  if [ -f "$TEMPLATE_PROFILE" ]; then
    cp "$TEMPLATE_PROFILE" "$PROFILES_DIR/owner-profile.md"
    info "Copied template owner-profile.md — edit with your real data"
  fi

  # Create per-golem dirs
  for name in "${GOLEM_NAMES[@]}"; do
    mkdir -p "$PROFILES_DIR/$name"
    info "Created $PROFILES_DIR/$name/"
  done

  # Git init
  cd "$PROFILES_DIR"
  git init
  git branch -M main

  cat > .gitignore << 'GITEOF'
claude.scratchpad*.md
nohup.out
.claude/settings.local.json
GITEOF

  cat > README.md << 'READMEEOF'
# Golem Profiles (Private)

Personal configuration for the Golems ecosystem.
Run `~/Gits/golems/scripts/setup-golem-profiles.sh` to set up symlinks.
READMEEOF

  git add -A
  git commit -m "Initial golem-profiles setup"

  echo ""
  ok "golem-profiles initialized at $PROFILES_DIR"
  warn "Edit owner-profile.md with your real personal data"
  warn "Create CLAUDE.md and .mcp.json for each golem in their subdirectory"
  echo ""
  info "Then run this script again (without --init) to set up symlinks"
}

verify_links() {
  echo -e "${BLUE}=== Verify golem-profiles symlinks ===${NC}"
  echo ""

  local issues=0

  # Check profiles dir exists
  if [ ! -d "$PROFILES_DIR" ]; then
    fail "golem-profiles not found at $PROFILES_DIR — run with --init first"
    return 1
  fi
  ok "golem-profiles exists"

  # Check owner profile
  if [ ! -f "$PROFILES_DIR/owner-profile.md" ]; then
    fail "owner-profile.md missing in golem-profiles"
    issues=$((issues + 1))
  else
    ok "owner-profile.md exists"
  fi

  # Check golems repo symlink
  local golems_link="$GOLEMS_DIR/.claude/rules/owner-profile.md"
  if [ -L "$golems_link" ]; then
    local target
    target=$(readlink "$golems_link")
    if [ "$target" = "$PROFILES_DIR/owner-profile.md" ]; then
      ok "golems/.claude/rules/owner-profile.md -> correct target"
    else
      warn "golems/.claude/rules/owner-profile.md -> wrong target: $target"
      issues=$((issues + 1))
    fi
  elif [ -f "$golems_link" ]; then
    warn "golems/.claude/rules/owner-profile.md is a regular file (should be symlink)"
    issues=$((issues + 1))
  else
    fail "golems/.claude/rules/owner-profile.md missing"
    issues=$((issues + 1))
  fi

  # Check each golem
  for i in {1..${#GOLEM_NAMES[@]}}; do
    local name="${GOLEM_NAMES[$i]}"
    local dir_name="${GOLEM_DIRS[$i]}"
    local golem_dir="$GITS_DIR/$dir_name"
    echo ""
    echo -e "${BLUE}--- $dir_name ---${NC}"

    # CLAUDE.md
    if [ -L "$golem_dir/CLAUDE.md" ]; then
      ok "CLAUDE.md is a symlink"
    elif [ -f "$golem_dir/CLAUDE.md" ]; then
      warn "CLAUDE.md is a regular file (should be symlink)"
      issues=$((issues + 1))
    else
      fail "CLAUDE.md missing"
      issues=$((issues + 1))
    fi

    # .mcp.json
    if [ -L "$golem_dir/.mcp.json" ]; then
      ok ".mcp.json is a symlink"
    elif [ -f "$golem_dir/.mcp.json" ]; then
      warn ".mcp.json is a regular file (should be symlink)"
      issues=$((issues + 1))
    else
      warn ".mcp.json missing"
    fi

    # owner-profile.md
    if [ -L "$golem_dir/.claude/rules/owner-profile.md" ]; then
      ok ".claude/rules/owner-profile.md is a symlink"
    else
      fail ".claude/rules/owner-profile.md missing or not a symlink"
      issues=$((issues + 1))
    fi
  done

  echo ""
  if [ "$issues" -eq 0 ]; then
    ok "All symlinks verified!"
    return 0
  else
    warn "$issues issue(s) found. Run with --fix to repair."
    return 1
  fi
}

setup_links() {
  echo -e "${BLUE}=== Set up golem-profiles symlinks ===${NC}"

  # Verify profiles dir exists
  if [ ! -d "$PROFILES_DIR" ]; then
    fail "golem-profiles not found at $PROFILES_DIR"
    info "Run with --init to create it first"
    exit 1
  fi

  # Verify owner profile exists
  if [ ! -f "$PROFILES_DIR/owner-profile.md" ]; then
    fail "owner-profile.md not found in $PROFILES_DIR"
    exit 1
  fi

  # Symlink into golems repo .claude/rules/
  echo ""
  echo -e "${BLUE}--- golems repo ---${NC}"
  mkdir -p "$GOLEMS_DIR/.claude/rules"
  create_symlink "$PROFILES_DIR/owner-profile.md" "$GOLEMS_DIR/.claude/rules/owner-profile.md"

  # Set up each golem
  for i in {1..${#GOLEM_NAMES[@]}}; do
    setup_golem_dir "${GOLEM_NAMES[$i]}" "${GOLEM_DIRS[$i]}"
  done

  echo ""
  ok "All symlinks set up!"
  echo ""
  info "Verify with: $0 --verify"
}

# --- Main ---

echo ""
echo "  GOLEM PROFILES SETUP"
echo "  Personal data in private repo, symlinked everywhere"
echo ""

case "${1:-setup}" in
  --init)
    init_profiles
    ;;
  --verify)
    verify_links
    ;;
  --fix|setup|"")
    setup_links
    ;;
  *)
    echo "Usage: $0 [--init|--verify|--fix]"
    echo "  --init    Create golem-profiles repo from template"
    echo "  --verify  Check all symlinks"
    echo "  --fix     Fix broken symlinks (same as default)"
    echo "  (default) Set up symlinks"
    exit 1
    ;;
esac
