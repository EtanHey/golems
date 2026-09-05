#!/usr/bin/env bash
set -euo pipefail

# Figma Loop - Track check results
# Usage:
#   check.sh init <component> [node-id]   — Start a new session
#   check.sh pass                          — Record a passing check
#   check.sh fail "<what was wrong>"       — Record a failing check (resets counter)
#   check.sh status                        — Show current progress

STATE_DIR="${FIGMA_LOOP_DIR:-/tmp/figma-loop}"
STATE_FILE="${STATE_DIR}/state.json"

mkdir -p "$STATE_DIR"

ACTION="${1:-status}"
shift || true

case "$ACTION" in
  init)
    COMPONENT="${1:-unnamed}"
    NODE_ID="${2:-}"
    cat > "$STATE_FILE" <<EOF
{"component":"${COMPONENT}","nodeId":"${NODE_ID}","passes":0,"totalChecks":0,"checks":[]}
EOF
    echo "Figma loop initialized for: ${COMPONENT}"
    echo "Consecutive passes: 0/3"
    ;;

  pass)
    if [ ! -f "$STATE_FILE" ]; then
      echo "No active session. Run: check.sh init <component>"
      exit 1
    fi
    PASSES=$(jq ".passes + 1" "$STATE_FILE")
    TOTAL=$(jq ".totalChecks + 1" "$STATE_FILE")
    jq ".passes = ${PASSES} | .totalChecks = ${TOTAL} | .checks += [{\"result\":\"pass\",\"time\":\"$(date -Iseconds)\"}]" "$STATE_FILE" > "${STATE_FILE}.tmp" && mv "${STATE_FILE}.tmp" "$STATE_FILE"
    echo "PASS (${PASSES}/3)"
    if [ "$PASSES" -ge 3 ]; then
      echo "DONE — 3 consecutive passes. Component verified."
    fi
    ;;

  fail)
    REASON="${1:-unspecified}"
    if [ ! -f "$STATE_FILE" ]; then
      echo "No active session. Run: check.sh init <component>"
      exit 1
    fi
    TOTAL=$(jq ".totalChecks + 1" "$STATE_FILE")
    jq ".passes = 0 | .totalChecks = ${TOTAL} | .checks += [{\"result\":\"fail\",\"reason\":\"${REASON}\",\"time\":\"$(date -Iseconds)\"}]" "$STATE_FILE" > "${STATE_FILE}.tmp" && mv "${STATE_FILE}.tmp" "$STATE_FILE"
    echo "FAIL — counter reset to 0/3"
    echo "Reason: ${REASON}"
    ;;

  status)
    if [ ! -f "$STATE_FILE" ]; then
      echo "No active session. Run: check.sh init <component>"
      exit 0
    fi
    COMPONENT=$(jq -r ".component" "$STATE_FILE")
    PASSES=$(jq ".passes" "$STATE_FILE")
    TOTAL=$(jq ".totalChecks" "$STATE_FILE")
    echo "Component: ${COMPONENT}"
    echo "Consecutive passes: ${PASSES}/3"
    echo "Total checks: ${TOTAL}"
    if [ "$PASSES" -ge 3 ]; then
      echo "Status: COMPLETE"
    else
      echo "Status: IN PROGRESS"
    fi
    ;;

  *)
    echo "Usage: check.sh <init|pass|fail|status> [args]"
    exit 1
    ;;
esac
