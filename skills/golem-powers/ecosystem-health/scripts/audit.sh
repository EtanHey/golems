#!/bin/bash
# Context Check — Audit Script
# Reads ~/.golems/config.yaml contextProfiles, compares against loaded context
# Usage: bash audit.sh [--fix]

set -eo pipefail

FIX_MODE=false
[[ "${1:-}" == "--fix" ]] && FIX_MODE=true

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

CONFIG="$HOME/.golems/config.yaml"
REGISTRY="$HOME/.config/ralphtools/registry.json"
SKILLS_DIR="$HOME/.claude/skills"
CWD="$(pwd)"

# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────

# Parse YAML context profiles with Python (no external deps)
get_profile() {
  python3 -c "
import yaml, sys, json

with open('$CONFIG') as f:
    cfg = yaml.safe_load(f)

profiles = cfg.get('contextProfiles', {})
repos_path = cfg.get('reposPath', '$HOME/Gits')

# Try to match cwd to a profile
cwd = '$CWD'
matched = None
for name, profile in profiles.items():
    # Check registry for path
    try:
        with open('$REGISTRY') as rf:
            reg = json.load(rf)
            proj = reg.get('contextProfiles', {}).get(name, {})
            path = proj.get('path', '')
            if path and cwd.startswith(path):
                matched = {'name': name, 'profile': profile}
                break
    except Exception:
        pass

    # Fallback: match by name in cwd
    if f'/{name}' in cwd.lower() or cwd.endswith(f'/{name}'):
        matched = {'name': name, 'profile': profile}
        break

if matched:
    print(json.dumps(matched))
else:
    print(json.dumps({'name': None, 'profile': None}))
" 2>/dev/null
}

# ─────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}=== CONTEXT CHECK ===${NC}"
echo -e "Directory: ${CYAN}$CWD${NC}"
echo ""

# Check config exists
if [ ! -f "$CONFIG" ]; then
  echo -e "${RED}ERROR: $CONFIG not found${NC}"
  echo "Run 'golems update' or create config manually."
  exit 1
fi

# Get profile
PROFILE_JSON=$(get_profile)
PROJECT_NAME=$(echo "$PROFILE_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['name'] or '')")

if [ -z "$PROJECT_NAME" ]; then
  echo -e "${YELLOW}No context profile found for this directory.${NC}"
  echo "Add a profile to $CONFIG under 'contextProfiles:'"
  echo ""
  echo "Detected project info:"
  [ -f "package.json" ] && echo "  package.json: $(python3 -c "import json; d=json.load(open('package.json')); print(d.get('name','?'))" 2>/dev/null)"
  [ -f "requirements.txt" ] && echo "  Python project (requirements.txt found)"
  [ -f "Cargo.toml" ] && echo "  Rust project (Cargo.toml found)"
  [ -f "CLAUDE.md" ] && echo "  CLAUDE.md exists"
  exit 0
fi

echo -e "Project: ${BOLD}$PROJECT_NAME${NC}"

# Parse profile fields
IDENTITY=$(echo "$PROFILE_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['profile'].get('identity','unknown'))")
ALLOWED_SKILLS=$(echo "$PROFILE_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(' '.join(d['profile'].get('skills',{}).get('allow',[])))")
BLOCKED_MCPS=$(echo "$PROFILE_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(' '.join(d['profile'].get('mcps',{}).get('block',[])))")
ALLOWED_MCPS=$(echo "$PROFILE_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(' '.join(d['profile'].get('mcps',{}).get('allow',[])))")
HOOKS_ENABLED=$(echo "$PROFILE_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(str(d['profile'].get('hooks',True)).lower())")
ALLOWED_AGENTS=$(echo "$PROFILE_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(' '.join(d['profile'].get('agents',{}).get('allow',[])))")
RULES=$(echo "$PROFILE_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); rules=d['profile'].get('rules',[]); [print(f'  - {r}') for r in rules]")

echo -e "Identity: ${CYAN}$IDENTITY${NC}"
echo ""

# ─── Skills ───
LOADED_SKILLS=$(for d in "$SKILLS_DIR"/*/; do [[ -d "$d" ]] && basename "$d"; done 2>/dev/null | sort)
LOADED_COUNT=$(echo "$LOADED_SKILLS" | wc -l | tr -d ' ')
ALLOWED_COUNT=$(echo "$ALLOWED_SKILLS" | wc -w)
echo -e "${BOLD}SKILLS ($ALLOWED_COUNT allowed, $LOADED_COUNT loaded):${NC}"

EXTRA_SKILLS=""
EXTRA_COUNT=0
for skill in $LOADED_SKILLS; do
  if ! echo " $ALLOWED_SKILLS " | grep -q " $skill "; then
    EXTRA_SKILLS="$EXTRA_SKILLS $skill"
    EXTRA_COUNT=$((EXTRA_COUNT + 1))
  fi
done

echo -e "  ${GREEN}✅ Allowed ($ALLOWED_COUNT):${NC} $ALLOWED_SKILLS"
echo -e "  ${RED}❌ Extra ($EXTRA_COUNT):${NC}$(echo "$EXTRA_SKILLS" | tr ' ' ', ')"
SKILL_WASTE=$((EXTRA_COUNT * 150))
echo -e "  ${YELLOW}⚠️  Estimated waste: ~${SKILL_WASTE} tokens (~$(echo "scale=1; $SKILL_WASTE * 100 / 200000" | bc)% of 200k)${NC}"
echo ""

# ─── MCPs ───
echo -e "${BOLD}MCPs:${NC}"
echo -e "  ${GREEN}✅ Allowed:${NC} $ALLOWED_MCPS"
if [ -n "$BLOCKED_MCPS" ]; then
  # Check if settings.local.json already blocks them
  LOCAL_SETTINGS=".claude/settings.local.json"
  if [ -f "$LOCAL_SETTINGS" ]; then
    ALREADY_BLOCKED=$(python3 -c "import json; d=json.load(open('$LOCAL_SETTINGS')); print(' '.join(d.get('disabledMcpjsonServers',[])))" 2>/dev/null || echo "")
    STILL_ACTIVE=""
    for mcp in $BLOCKED_MCPS; do
      if ! echo " $ALREADY_BLOCKED " | grep -q " $mcp "; then
        STILL_ACTIVE="$STILL_ACTIVE $mcp"
      fi
    done
    if [ -n "$STILL_ACTIVE" ]; then
      echo -e "  ${RED}❌ Should block:${NC}$STILL_ACTIVE"
    else
      echo -e "  ${GREEN}✅ All blocked MCPs are disabled in settings.local.json${NC}"
    fi
  else
    echo -e "  ${RED}❌ Should block:${NC} $BLOCKED_MCPS"
    echo -e "  ${YELLOW}⚠️  No .claude/settings.local.json — nothing is blocked${NC}"
  fi
fi
echo ""

# ─── Hooks ───
echo -e "${BOLD}HOOKS:${NC}"
if [ "$HOOKS_ENABLED" = "false" ]; then
  LOCAL_SETTINGS=".claude/settings.local.json"
  if [ -f "$LOCAL_SETTINGS" ]; then
    HAS_HOOK_OVERRIDE=$(python3 -c "
import json
d=json.load(open('$LOCAL_SETTINGS'))
hooks = d.get('hooks', {})
ss = hooks.get('SessionStart', [{}])
ups = hooks.get('UserPromptSubmit', [{}])
# Check if hooks are empty arrays
ss_empty = any(h.get('hooks', None) == [] for h in ss)
ups_empty = any(h.get('hooks', None) == [] for h in ups)
print('yes' if ss_empty and ups_empty else 'no')
" 2>/dev/null || echo "no")
    if [ "$HAS_HOOK_OVERRIDE" = "yes" ]; then
      echo -e "  ${GREEN}✅ Hooks disabled via settings.local.json${NC}"
    else
      echo -e "  ${RED}❌ Profile says hooks=false but settings.local.json doesn't disable them${NC}"
    fi
  else
    echo -e "  ${RED}❌ Profile says hooks=false but no settings.local.json exists${NC}"
    echo -e "  ${YELLOW}⚠️  BrainLayer hooks are injecting ~500 tokens per prompt${NC}"
  fi
else
  echo -e "  ${GREEN}✅ Hooks enabled (as expected)${NC}"
fi
echo ""

# ─── Override File ───
echo -e "${BOLD}OVERRIDE FILE:${NC}"
if [ -f ".claude/settings.local.json" ]; then
  echo -e "  ${GREEN}✅ .claude/settings.local.json exists${NC}"
else
  echo -e "  ${YELLOW}⚠️  MISSING — no per-project overrides${NC}"
fi
echo ""

# ─── Rules ───
if [ -n "$RULES" ]; then
  echo -e "${BOLD}PROJECT RULES:${NC}"
  echo "$RULES"
  echo ""
fi

# ─── Total Waste ───
HOOK_WASTE=0
[ "$HOOKS_ENABLED" = "false" ] && HOOK_WASTE=500
TOTAL_WASTE=$((SKILL_WASTE + HOOK_WASTE))
PCT=$(echo "scale=1; $TOTAL_WASTE * 100 / 200000" | bc)
echo -e "${BOLD}TOTAL ESTIMATED WASTE: ~${TOTAL_WASTE} tokens (~${PCT}% of context)${NC}"
echo ""

# ─── Fix Mode ───
if [ "$FIX_MODE" = "true" ]; then
  echo -e "${BOLD}=== FIX MODE ===${NC}"
  echo ""

  mkdir -p .claude

  # Generate settings.local.json
  python3 -c "
import json

settings = {
    '\$schema': 'https://json.schemastore.org/claude-code-settings.json'
}

blocked = '$BLOCKED_MCPS'.split()
if blocked and blocked[0]:
    settings['disabledMcpjsonServers'] = blocked

if '$HOOKS_ENABLED' == 'false':
    settings['hooks'] = {
        'SessionStart': [{'hooks': []}],
        'UserPromptSubmit': [{'hooks': []}]
    }

with open('.claude/settings.local.json', 'w') as f:
    json.dump(settings, f, indent=2)
    f.write('\n')

print('Generated .claude/settings.local.json')
"

  # Generate CLAUDE.md containerization section
  echo ""
  echo -e "${CYAN}Containerization section for CLAUDE.md:${NC}"
  echo ""
  echo "## CONTAINERIZATION"
  echo ""
  echo "**You are $IDENTITY. You work ONLY on this project.**"
  echo ""
  echo "### ONLY Use These Skills"
  echo "$(echo "$ALLOWED_SKILLS" | tr ' ' '\n' | sed 's/^/- /')"
  echo "Do not invoke any skill not listed above."
  echo ""
  if [ -n "$ALLOWED_AGENTS" ]; then
    echo "### Subagent Types"
    echo "Only use: $(echo "$ALLOWED_AGENTS" | tr ' ' ', ')."
    echo ""
  fi
  if [ -n "$RULES" ]; then
    echo "### Rules"
    echo "$RULES"
  fi

  echo ""
  echo -e "${GREEN}Done. Copy the containerization section above into your CLAUDE.md.${NC}"
fi
