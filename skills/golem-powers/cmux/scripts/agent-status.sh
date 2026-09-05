#!/bin/bash
# cmux agent-status: reads all pane surfaces, detects Claude Code state
# Usage: agent-status.sh [workspace_ref]

WORKSPACE="${1:-}"
WS_FLAG=""
[[ -n "$WORKSPACE" ]] && WS_FLAG="--workspace $WORKSPACE"

echo "SURFACE | LABEL | STATE | MODEL | COST | TOKENS"
echo "--------|-------|-------|-------|------|-------"

# Get all surfaces across all panes
for pane in $(cmux list-panes $WS_FLAG 2>/dev/null | grep -oE 'pane:[0-9]+'); do
  cmux list-pane-surfaces --pane "$pane" 2>/dev/null | while IFS= read -r line; do
    [[ -z "$line" ]] && continue

    # Extract surface ref (handle leading * for focused)
    surface=$(echo "$line" | grep -oE 'surface:[0-9]+')
    [[ -z "$surface" ]] && continue

    # Extract label (everything between surface ref and [selected])
    label=$(echo "$line" | sed "s/^[* ]*//" | sed "s/$surface *//" | sed 's/ *\[.*$//' | xargs)

    # Read screen
    screen=$(cmux read-screen --surface "$surface" --lines 8 2>/dev/null)

    # Detect state (cooking metaphors = DONE, highest priority)
    state="unknown"
    if echo "$screen" | grep -qE "Cooked for|Sautéed for|Crunched for|Cogitated for|Baked for|Simmered for"; then
      state="DONE"
    elif echo "$screen" | grep -q "∴ Thinking\|Thinking"; then
      state="THINKING"
    elif echo "$screen" | grep -qE "⏵⏵ bypass|permissions on"; then
      # bypass stays in statusbar even when idle — check for idle indicators
      if echo "$screen" | grep -qE "tokens" && echo "$screen" | grep -qE '⏱️  0m|current:.*latest:'; then
        state="IDLE_CLAUDE"
      else
        state="RUNNING"
      fi
    elif echo "$screen" | grep -q "tokens" && echo "$screen" | grep -q "❯"; then
      state="IDLE_CLAUDE"
    elif echo "$screen" | grep -q '\$[[:space:]]*$'; then
      state="IDLE_SHELL"
    fi

    # Extract metrics
    tokens=$(echo "$screen" | grep -oE '[0-9]+ tokens' | head -1 | grep -oE '[0-9]+')
    model=$(echo "$screen" | grep -oE 'Opus [0-9.]+|Sonnet [0-9.]+|Haiku [0-9.]+' | head -1)
    cost=$(echo "$screen" | grep -oE '\$[0-9.]+' | head -1)

    echo "$surface | ${label:-unnamed} | $state | ${model:-n/a} | ${cost:-\$0} | ${tokens:-0}t"
  done
done
