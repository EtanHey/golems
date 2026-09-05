#!/usr/bin/env bash
set -euo pipefail

# watch-agent.sh — Poll an agent surface until it finishes, then notify orcClaude
# Usage: watch-agent.sh <surface_ref> [--type terminal|browser] [--interval 15] [--repo /path]
#
# Terminal agents: polls read-screen for DONE/IDLE state
# Browser agents (T3): polls browser page text for "handoff summary" or "Changes are left unstaged"
# File agents: watches repo dir with fswatch for file changes
#
# When agent finishes:
#   1. cmux notify (tab flashes)
#   2. Writes state to /tmp/golem-agents/<surface>.json
#   3. Prints "AGENT_DONE" to stdout (for background task notification)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SURFACE=""
TYPE="terminal"
INTERVAL=15
REPO=""
MAX_POLLS=120  # 30 min at 15s intervals

while [[ $# -gt 0 ]]; do
  case "$1" in
    --type) TYPE="$2"; shift 2;;
    --interval) INTERVAL="$2"; shift 2;;
    --repo) REPO="$2"; shift 2;;
    surface:*) SURFACE="$1"; shift;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

if [[ -z "$SURFACE" ]]; then
  echo "Usage: watch-agent.sh <surface:N> [--type terminal|browser] [--interval 15] [--repo /path]"
  exit 1
fi

STATE_DIR="/tmp/golem-agents"
mkdir -p "$STATE_DIR"
STATE_FILE="$STATE_DIR/${SURFACE//:/-}.json"

echo "[watch] Monitoring $SURFACE (type=$TYPE, interval=${INTERVAL}s)"

# Write initial state
cat > "$STATE_FILE" <<EOF
{"surface":"$SURFACE","status":"running","type":"$TYPE","started_at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
EOF

poll_count=0

check_terminal_done() {
  local screen
  screen=$(cmux read-screen --surface "$SURFACE" --lines 10 2>/dev/null) || return 1

  # Claude Code done patterns
  if echo "$screen" | grep -qE "Cooked for|Sautéed for|Crunched for|Cogitated for|Baked for|Simmered for"; then
    return 0
  fi
  # Cursor/Codex done
  if echo "$screen" | grep -qE "completed|finished|done"; then
    return 0
  fi
  # Back to shell prompt
  if echo "$screen" | grep -qE '(❯|\$)\s*$' && ! echo "$screen" | grep -q "Thinking"; then
    # Could be idle — check if agent was running before
    if [[ $poll_count -gt 2 ]]; then
      return 0
    fi
  fi
  return 1
}

check_browser_done() {
  local text
  text=$(cmux browser --surface "$SURFACE" get text body 2>/dev/null) || return 1

  # T3 Code handoff patterns
  if echo "$text" | grep -qiE "handoff summary|changes are left unstaged|files modified:"; then
    # Check it's not still actively working
    local btn
    btn=$(cmux browser --surface "$SURFACE" eval "
      var btn = document.querySelector('button[aria-label=\"Send message\"]');
      btn ? 'ready' : 'busy';
    " 2>/dev/null)
    if [[ "$btn" == "ready" ]]; then
      return 0
    fi
  fi
  return 1
}

while [[ $poll_count -lt $MAX_POLLS ]]; do
  sleep "$INTERVAL"
  poll_count=$((poll_count + 1))

  case "$TYPE" in
    terminal)
      if check_terminal_done; then
        echo "[watch] Agent $SURFACE finished (poll #$poll_count)"
        break
      fi
      ;;
    browser)
      if check_browser_done; then
        echo "[watch] Agent $SURFACE finished (poll #$poll_count)"
        break
      fi
      ;;
  esac

  # Progress log every 4 polls
  if (( poll_count % 4 == 0 )); then
    echo "[watch] Still running... (poll #$poll_count, ${SURFACE})"
  fi
done

# Agent finished or timed out
FINISHED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if [[ $poll_count -ge $MAX_POLLS ]]; then
  STATUS="timeout"
  echo "[watch] TIMEOUT after $MAX_POLLS polls"
else
  STATUS="done"
fi

# Write final state
cat > "$STATE_FILE" <<EOF
{"surface":"$SURFACE","status":"$STATUS","type":"$TYPE","finished_at":"$FINISHED_AT","polls":$poll_count}
EOF

# Notify via cmux
cmux notify --title "Agent Done" --body "$SURFACE ($TYPE) — $STATUS" 2>/dev/null || true

# Update sidebar
cmux set-status "agent-$SURFACE" "$STATUS" 2>/dev/null || true

echo "AGENT_DONE: $SURFACE status=$STATUS polls=$poll_count"
