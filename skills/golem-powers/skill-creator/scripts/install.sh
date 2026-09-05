#!/usr/bin/env bash
# scripts/install.sh — install the skill-creator skill + session-miner sub-agent
# Usage: bash install.sh [--dry-run] [-h|--help]
#
# Idempotent. Safe to re-run. Detects existing symlinks and skips them.
#
# What it does:
#   1. Symlinks the skill into ~/.claude/skills/skill-creator (golem-powers convention)
#   2. Ensures the project-scope repo $PROJECT_REPO/ has .claude/agents/ + scripts/ dirs
#   3. Symlinks the session-miner agent definition into the project-scope agents dir
#   4. Symlinks the session-miner parser into the project-scope scripts dir
#
# The project-scope symlinks gate the session-miner sub-agent so only skillCreatorClaude /
# Codex / RepoGolem (which run with cwd inside $PROJECT_REPO/) can spawn it.

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
DIM='\033[2m'
NC='\033[0m'

# Resolve skill source dir = parent of scripts/ = the skill root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Targets
SKILLS_LINK="$HOME/.claude/skills/skill-creator"
PROJECT_REPO="$HOME/Gits/skill-creator"
PROJECT_AGENT_LINK="$PROJECT_REPO/.claude/agents/session-miner.md"
PROJECT_CODEX_LINK="$PROJECT_REPO/.codex/agents/session-miner.toml"
PROJECT_PARSER_LINK="$PROJECT_REPO/scripts/session-miner.py"

# Sources (canonical, inside skill)
SOURCE_AGENT="$SKILL_DIR/agents/session-miner.md"
SOURCE_TOML="$SKILL_DIR/agents/session-miner.toml"
SOURCE_PARSER="$SKILL_DIR/scripts/session-miner.py"

DRY_RUN=false

show_help() {
    cat <<EOF
Usage: install.sh [options]

Install the skill-creator skill + session-miner sub-agent.

Options:
  --dry-run   Print what would change; make no modifications
  -h, --help  Show this help

What this does:
  1. Symlinks the skill into ~/.claude/skills/skill-creator
  2. Ensures project-scope dirs exist: $PROJECT_REPO/.claude/agents/,
     $PROJECT_REPO/.codex/agents/, $PROJECT_REPO/scripts/
  3. Symlinks the Claude agent definition (session-miner.md) into project-scope
  4. Symlinks the Codex agent definition (session-miner.toml) into project-scope
  5. Symlinks the parser into the project-scope scripts dir

The project-scope symlinks gate session-miner so only skillCreatorClaude /
Codex / RepoGolem (which run with cwd inside $PROJECT_REPO/) can
spawn it. orcClaude, coachClaude, etc. cannot — agent not found in their
discovery paths.

Resolves:
  Skill source: $SKILL_DIR
EOF
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run) DRY_RUN=true; shift ;;
        -h|--help) show_help; exit 0 ;;
        *) echo -e "${RED}ERROR: Unknown option: $1${NC}"; show_help; exit 1 ;;
    esac
done

# Sanity: confirm sources exist
echo -e "${BLUE}Verifying skill source files...${NC}"
for f in "$SOURCE_AGENT" "$SOURCE_TOML" "$SOURCE_PARSER" "$SKILL_DIR/SKILL.md"; do
    if [ ! -f "$f" ]; then
        echo -e "${RED}  [FAIL]${NC} missing: $f"
        echo -e "${RED}ERROR: skill source is incomplete. Aborting.${NC}"
        exit 1
    fi
    echo -e "${GREEN}  [OK]${NC} $f"
done
echo ""

# Helper: ensure a directory exists
ensure_dir() {
    local d="$1"
    if [ -d "$d" ]; then
        echo -e "${DIM}  [keep]${NC} dir exists: $d"
    else
        if [ "$DRY_RUN" = true ]; then
            echo -e "${YELLOW}  [dry-run]${NC} would mkdir -p $d"
        else
            mkdir -p "$d"
            echo -e "${GREEN}  [create]${NC} mkdir -p $d"
        fi
    fi
}

# Helper: ensure a symlink points at the right target
# Args: $1=link path, $2=target path
ensure_symlink() {
    local link="$1"
    local target="$2"

    if [ -L "$link" ]; then
        local existing
        existing="$(readlink "$link")"
        if [ "$existing" = "$target" ]; then
            echo -e "${DIM}  [keep]${NC} symlink already correct: $link"
            return 0
        else
            if [ "$DRY_RUN" = true ]; then
                echo -e "${YELLOW}  [dry-run]${NC} would relink: $link (was: $existing) → $target"
            else
                ln -sfn "$target" "$link"
                echo -e "${GREEN}  [relink]${NC} $link → $target (was: $existing)"
            fi
            return 0
        fi
    fi

    if [ -e "$link" ]; then
        echo -e "${RED}  [conflict]${NC} $link exists and is not a symlink — refusing to overwrite"
        echo -e "${RED}  Move it out of the way and re-run.${NC}"
        return 1
    fi

    if [ "$DRY_RUN" = true ]; then
        echo -e "${YELLOW}  [dry-run]${NC} would link: $link → $target"
    else
        ln -sfn "$target" "$link"
        echo -e "${GREEN}  [link]${NC} $link → $target"
    fi
}

# 1. Skill → ~/.claude/skills/skill-creator
echo -e "${BLUE}Step 1: skill symlink (~/.claude/skills/skill-creator)${NC}"
ensure_dir "$HOME/.claude/skills"
ensure_symlink "$SKILLS_LINK" "$SKILL_DIR"
# Drop the legacy ~/.claude/commands/skill-creator link this script used to create.
# Claude Code walks commands/**/*.md recursively, so it re-listed every workflow.
LEGACY_COMMANDS_LINK="$HOME/.claude/commands/skill-creator"
if [ -L "$LEGACY_COMMANDS_LINK" ]; then
    if [ "$DRY_RUN" = true ]; then
        echo -e "${YELLOW}  [dry-run]${NC} would remove legacy link: $LEGACY_COMMANDS_LINK"
    else
        rm -f "$LEGACY_COMMANDS_LINK"
        echo -e "${GREEN}  [unlink]${NC} removed legacy $LEGACY_COMMANDS_LINK"
    fi
elif [ -d "$LEGACY_COMMANDS_LINK" ]; then
    echo -e "${YELLOW}  [warn]${NC} $LEGACY_COMMANDS_LINK is a real directory — run golem-install/scripts/cleanup-legacy-commands.sh"
fi
echo ""

# 2. Project repo dirs
echo -e "${BLUE}Step 2: project-scope dirs ($PROJECT_REPO/{.claude,.codex}/agents, scripts)${NC}"
ensure_dir "$PROJECT_REPO/.claude/agents"
ensure_dir "$PROJECT_REPO/.codex/agents"
ensure_dir "$PROJECT_REPO/scripts"
echo ""

# 3. Claude agent file symlink
echo -e "${BLUE}Step 3: Claude agent symlink (.claude/agents/session-miner.md)${NC}"
ensure_symlink "$PROJECT_AGENT_LINK" "$SOURCE_AGENT"
echo ""

# 4. Codex agent file symlink
echo -e "${BLUE}Step 4: Codex agent symlink (.codex/agents/session-miner.toml)${NC}"
ensure_symlink "$PROJECT_CODEX_LINK" "$SOURCE_TOML"
echo ""

# 5. Parser symlink
echo -e "${BLUE}Step 5: parser symlink (convenience)${NC}"
ensure_symlink "$PROJECT_PARSER_LINK" "$SOURCE_PARSER"
echo ""

# 5. Verification
if [ "$DRY_RUN" = false ]; then
    echo -e "${BLUE}Verifying install...${NC}"
    all_ok=true
    for pair in \
        "$SKILLS_LINK:$SKILL_DIR" \
        "$PROJECT_AGENT_LINK:$SOURCE_AGENT" \
        "$PROJECT_CODEX_LINK:$SOURCE_TOML" \
        "$PROJECT_PARSER_LINK:$SOURCE_PARSER"; do
        link="${pair%%:*}"
        expected="${pair##*:}"
        if [ -L "$link" ] && [ "$(readlink "$link")" = "$expected" ]; then
            echo -e "${GREEN}  [OK]${NC} $link"
        else
            echo -e "${RED}  [FAIL]${NC} $link"
            all_ok=false
        fi
    done
    echo ""
    if $all_ok; then
        echo -e "${GREEN}SUCCESS: skill-creator + session-miner installed${NC}"
        echo ""
        echo -e "${DIM}Next steps:${NC}"
        echo -e "${DIM}  - Use /skill-creator slash command from any Claude Code session${NC}"
        echo -e "${DIM}  - From skillCreatorClaude (cwd=$PROJECT_REPO/), invoke:${NC}"
        echo -e "${DIM}      Agent(subagent_type=\"session-miner\", ...)${NC}"
        echo -e "${DIM}  - From skillCreatorCodex (cwd=$PROJECT_REPO/), invoke by name:${NC}"
        echo -e "${DIM}      'session_miner, mine <jsonl> to <out> with label <name>.'${NC}"
        echo -e "${DIM}  - Or run the parser standalone:${NC}"
        echo -e "${DIM}      python3 $SOURCE_PARSER --src <jsonl> --out <md> --label <name>${NC}"
    else
        echo -e "${RED}FAILED: one or more symlinks did not verify${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}DRY RUN COMPLETE — no changes made${NC}"
    echo -e "${DIM}Re-run without --dry-run to apply.${NC}"
fi
