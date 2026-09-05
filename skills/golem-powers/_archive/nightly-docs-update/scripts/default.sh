#!/usr/bin/env bash
set -euo pipefail

# Self-detect script location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Repo paths
GOLEMS_DIR="$HOME/Gits/golems"
PORTFOLIO_DIR="$HOME/Gits/etanheyman.com"
BRAINLAYER_DB="$HOME/.local/share/zikaron/zikaron.db"

# Flags
SKIP_TESTS=false
STATS_ONLY=false
DEAD_REFS_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --skip-tests) SKIP_TESTS=true ;;
    --stats-only) STATS_ONLY=true ;;
    --dead-refs-only) DEAD_REFS_ONLY=true ;;
  esac
done

# Output buffer
OUTPUT=""
WARNINGS=""

log() { OUTPUT+="$1"$'\n'; }
warn() { WARNINGS+="- $1"$'\n'; }

# ─── Phase 1: Collect Stats ─────────────────────────────────────────

log "## Phase 1: Stats Collection"
log ""

# Package count + list
if [[ -d "$GOLEMS_DIR/packages" ]]; then
  PACKAGE_LIST=$(ls "$GOLEMS_DIR/packages/" | sort | tr '\n' ', ' | sed 's/,$//')
  PACKAGE_COUNT=$(ls "$GOLEMS_DIR/packages/" | wc -l | tr -d ' ')
  log "- **Packages:** $PACKAGE_COUNT ($PACKAGE_LIST)"
else
  PACKAGE_COUNT=0
  warn "packages/ directory not found at $GOLEMS_DIR"
fi

# Skill count
SKILL_DIRS=0
SKILL_MDS=0
SKILL_EVALS=0
if [[ -d "$GOLEMS_DIR/skills/golem-powers" ]]; then
  SKILL_DIRS=$(ls -d "$GOLEMS_DIR/skills/golem-powers"/*/ 2>/dev/null | wc -l | tr -d ' ')
  SKILL_MDS=$(find "$GOLEMS_DIR/skills/golem-powers" -name "SKILL.md" -maxdepth 2 | wc -l | tr -d ' ')
  SKILL_EVALS=$(find "$GOLEMS_DIR/skills/golem-powers" -name "evals.json" -path "*/evals/*" -maxdepth 3 | wc -l | tr -d ' ')
  if [[ "$SKILL_DIRS" -gt 0 ]]; then
    EVAL_COVERAGE=$(( SKILL_EVALS * 100 / SKILL_DIRS ))
  else
    EVAL_COVERAGE=0
  fi
  log "- **Skills:** $SKILL_DIRS dirs, $SKILL_MDS SKILL.md, $SKILL_EVALS with evals ($EVAL_COVERAGE%)"
fi

# BrainLayer chunks
CHUNK_COUNT=0
CHUNK_COUNT_K=""
if [[ -f "$BRAINLAYER_DB" ]]; then
  CHUNK_COUNT=$(sqlite3 "$BRAINLAYER_DB" 'SELECT COUNT(*) FROM chunks' 2>/dev/null || echo "0")
  CHUNK_COUNT_K=$(( CHUNK_COUNT / 1000 ))
  log "- **BrainLayer chunks:** $CHUNK_COUNT (${CHUNK_COUNT_K}K+)"
else
  warn "BrainLayer DB not found at $BRAINLAYER_DB — skipping chunk count"
fi

# PR count
PR_COUNT=0
if command -v gh &>/dev/null; then
  PR_COUNT=$(gh pr list -R EtanHey/golems --state merged --limit 999 --json number --jq 'length' 2>/dev/null || echo "0")
  log "- **PRs merged:** $PR_COUNT"
else
  warn "gh CLI not found — skipping PR count"
fi

# Test count
TEST_PASS=0
TEST_FAIL=0
TEST_FILES=0
if [[ "$SKIP_TESTS" == "false" ]]; then
  TEST_OUTPUT=$(cd "$GOLEMS_DIR" && bun test --reporter=summary 2>&1 || true)
  TEST_PASS=$(echo "$TEST_OUTPUT" | grep -oE '[0-9]+ pass' | grep -oE '[0-9]+' | head -1 || echo "0")
  TEST_FAIL=$(echo "$TEST_OUTPUT" | grep -oE '[0-9]+ fail' | grep -oE '[0-9]+' | head -1 || echo "0")
  TEST_FILES=$(echo "$TEST_OUTPUT" | grep -oE '[0-9]+ files' | grep -oE '[0-9]+' | head -1 || echo "0")
  log "- **Tests:** $TEST_PASS pass, $TEST_FAIL fail, $TEST_FILES files"
else
  log "- **Tests:** skipped (--skip-tests)"
fi

# MCP server count
MCP_COUNT=0
if [[ -f "$HOME/Gits/.mcp.json" ]]; then
  MCP_COUNT=$(python3 -c "import json; d=json.load(open('$HOME/Gits/.mcp.json')); print(len(d.get('mcpServers',{})))" 2>/dev/null || echo "0")
  log "- **MCP servers:** $MCP_COUNT"
fi

log ""

# ─── Dead Refs Only Mode ────────────────────────────────────────────

if [[ "$DEAD_REFS_ONLY" == "true" ]]; then
  log "## Dead Reference Detection"
  log ""

  DEAD_PACKAGES=("autonomous" "orchestrator" "dashboard" "ralph" "zikaron")
  DEAD_FOUND=0

  for pkg in "${DEAD_PACKAGES[@]}"; do
    REFS=$(grep -rl "packages/$pkg" "$PORTFOLIO_DIR/content/" "$PORTFOLIO_DIR/app/" 2>/dev/null || true)
    if [[ -n "$REFS" ]]; then
      DEAD_FOUND=$((DEAD_FOUND + 1))
      log "### packages/$pkg/ (REMOVED)"
      while IFS= read -r file; do
        LINES=$(grep -n "packages/$pkg" "$file" | head -5)
        log "- \`${file#"$PORTFOLIO_DIR"/}\`"
        log '```'
        log "$LINES"
        log '```'
      done <<< "$REFS"
      log ""
    fi
  done

  if [[ "$DEAD_FOUND" -eq 0 ]]; then
    log "No dead package references found."
  else
    log "**$DEAD_FOUND dead package references found.** Review manually — some may be historically accurate."
  fi

  echo "$OUTPUT"
  exit 0
fi

# ─── Stats Only Mode ────────────────────────────────────────────────

if [[ "$STATS_ONLY" == "true" ]]; then
  if [[ -n "$WARNINGS" ]]; then
    log "## Warnings"
    log "$WARNINGS"
  fi
  echo "$OUTPUT"
  exit 0
fi

# ─── Phase 2: Update etanheyman.com ─────────────────────────────────

log "## Phase 2: Update etanheyman.com"
log ""

if [[ ! -d "$PORTFOLIO_DIR" ]]; then
  log "**ERROR:** Portfolio repo not found at $PORTFOLIO_DIR"
  echo "$OUTPUT"
  exit 1
fi

# Check for dirty state
DIRTY=$(cd "$PORTFOLIO_DIR" && git status --porcelain 2>/dev/null || echo "")
if [[ -n "$DIRTY" ]]; then
  log "**WARNING:** etanheyman.com has uncommitted changes. Proceeding anyway — changes will be mixed in."
  log '```'
  log "$DIRTY"
  log '```'
  log ""
fi

CHANGES_MADE=0

# Helper: sed replace and track changes
update_file() {
  local file="$1"
  local pattern="$2"
  local replacement="$3"
  local label="$4"

  if [[ ! -f "$file" ]]; then
    warn "File not found: $file"
    return
  fi

  if grep -q "$pattern" "$file" 2>/dev/null; then
    sed -i '' "s|$pattern|$replacement|g" "$file"
    log "- Updated \`${file#"$PORTFOLIO_DIR"/}\`: $label"
    CHANGES_MADE=$((CHANGES_MADE + 1))
  fi
}

# Update project-showcase-config.ts
SHOWCASE="$PORTFOLIO_DIR/app/(golems)/golems/config/project-showcase-config.ts"
if [[ -f "$SHOWCASE" ]]; then
  # Package count
  sed -i '' "s/value: [0-9]*, label: \"Packages\"/value: $PACKAGE_COUNT, label: \"Packages\"/" "$SHOWCASE" && CHANGES_MADE=$((CHANGES_MADE + 1))

  # Skill count
  sed -i '' "s/value: [0-9]*, label: \"Skills\"/value: $SKILL_DIRS, label: \"Skills\"/" "$SHOWCASE" && CHANGES_MADE=$((CHANGES_MADE + 1))

  # PR count
  if [[ "$PR_COUNT" -gt 0 ]]; then
    sed -i '' "s/value: [0-9]*, suffix: \"+\", label: \"PRs merged\"/value: $PR_COUNT, suffix: \"+\", label: \"PRs merged\"/" "$SHOWCASE" && CHANGES_MADE=$((CHANGES_MADE + 1))
  fi

  # Chunk count (in K)
  if [[ "$CHUNK_COUNT_K" -gt 0 ]]; then
    sed -i '' "s/value: [0-9]*, suffix: \"K+\", label: \"Indexed chunks\"/value: $CHUNK_COUNT_K, suffix: \"K+\", label: \"Indexed chunks\"/" "$SHOWCASE" && CHANGES_MADE=$((CHANGES_MADE + 1))
  fi

  log "- Updated \`project-showcase-config.ts\`: stats"
fi

# Update terminal-showcase-config.ts
TERMINAL_SHOWCASE="$PORTFOLIO_DIR/app/(golems)/golems/config/terminal-showcase-config.ts"
if [[ -f "$TERMINAL_SHOWCASE" ]] && [[ "$CHUNK_COUNT" -gt 0 ]]; then
  # Replace formatted chunk counts like "291,000+" or "328,000+"
  CHUNK_FORMATTED=$(printf "%'d" "$CHUNK_COUNT")
  sed -i '' "s/[0-9]\{3\},[0-9]\{3\}+/${CHUNK_FORMATTED}+/g" "$TERMINAL_SHOWCASE" && CHANGES_MADE=$((CHANGES_MADE + 1))
  log "- Updated \`terminal-showcase-config.ts\`: chunk count"
fi

# Update content markdown files — chunk count
CONTENT_FILES=(
  "content/golems/faq.md"
  "content/golems/zikaron.md"
  "content/golems/llm.md"
  "content/golems/mcp-tools.md"
  "content/golems/journey.md"
  "content/golems/getting-started.md"
)

if [[ "$CHUNK_COUNT_K" -gt 0 ]]; then
  for f in "${CONTENT_FILES[@]}"; do
    FULL="$PORTFOLIO_DIR/$f"
    if [[ -f "$FULL" ]]; then
      # Replace patterns like "260K+" or "291K+" with current value
      BEFORE=$(cat "$FULL")
      sed -i '' "s/[0-9]\{1,\}K+/${CHUNK_COUNT_K}K+/g" "$FULL"
      AFTER=$(cat "$FULL")
      if [[ "$BEFORE" != "$AFTER" ]]; then
        log "- Updated \`$f\`: chunk count → ${CHUNK_COUNT_K}K+"
        CHANGES_MADE=$((CHANGES_MADE + 1))
      fi
    fi
  done
fi

# Update architecture.md package count
ARCH="$PORTFOLIO_DIR/content/golems/architecture.md"
if [[ -f "$ARCH" ]]; then
  BEFORE=$(cat "$ARCH")
  sed -i '' "s/[0-9]* packages/$PACKAGE_COUNT packages/g" "$ARCH"
  AFTER=$(cat "$ARCH")
  if [[ "$BEFORE" != "$AFTER" ]]; then
    log "- Updated \`architecture.md\`: package count → $PACKAGE_COUNT"
    CHANGES_MADE=$((CHANGES_MADE + 1))
  fi
fi

# Update getting-started.md skill count
GS="$PORTFOLIO_DIR/content/golems/getting-started.md"
if [[ -f "$GS" ]]; then
  BEFORE=$(cat "$GS")
  sed -i '' "s/[0-9]* reusable Claude Code skills/$SKILL_DIRS reusable Claude Code skills/g" "$GS"
  sed -i '' "s/[0-9]* skills/$SKILL_DIRS skills/g" "$GS"
  AFTER=$(cat "$GS")
  if [[ "$BEFORE" != "$AFTER" ]]; then
    log "- Updated \`getting-started.md\`: skill count → $SKILL_DIRS"
    CHANGES_MADE=$((CHANGES_MADE + 1))
  fi
fi

log ""

# ─── Dead Reference Detection ───────────────────────────────────────

log "## Dead Reference Detection"
log ""

DEAD_PACKAGES=("autonomous" "orchestrator" "dashboard" "ralph" "zikaron")
DEAD_FOUND=0

for pkg in "${DEAD_PACKAGES[@]}"; do
  REFS=$(grep -rl "packages/${pkg}/" "$PORTFOLIO_DIR/content/" "$PORTFOLIO_DIR/app/" 2>/dev/null || true)
  if [[ -n "$REFS" ]]; then
    DEAD_FOUND=$((DEAD_FOUND + 1))
    log "- **packages/$pkg/** referenced in: $(echo "$REFS" | sed "s|$PORTFOLIO_DIR/||g" | tr '\n' ', ' | sed 's/,$//')"
  fi
done

if [[ "$DEAD_FOUND" -eq 0 ]]; then
  log "No dead package references found."
else
  log ""
  log "**$DEAD_FOUND dead package references found.** Review manually — some may be historically accurate."
fi

log ""

# ─── Phase 3: Summary ───────────────────────────────────────────────

log "## Summary"
log ""

if [[ -n "$WARNINGS" ]]; then
  log "### Warnings"
  log "$WARNINGS"
fi

# Check actual git diff in portfolio
ACTUAL_CHANGES=$(cd "$PORTFOLIO_DIR" && git diff --stat 2>/dev/null || echo "")
if [[ -n "$ACTUAL_CHANGES" ]]; then
  log "### Files Changed"
  log '```'
  log "$ACTUAL_CHANGES"
  log '```'
  log ""
  log "**Action needed:** Create a PR with these changes. Run with Claude's /pr-loop or:"
  log '```bash'
  log "cd ~/Gits/etanheyman.com"
  log "git checkout -b chore/nightly-docs-$(date +%Y-%m-%d)"
  log 'git add -A && git commit -m "chore: nightly docs update — sync stats from golems repo"'
  log "git push -u origin HEAD"
  log 'gh pr create --title "chore: nightly docs update" --body "Auto-generated stats sync"'
  log '```'
else
  log "**All stats current.** No changes needed."
fi

echo "$OUTPUT"
