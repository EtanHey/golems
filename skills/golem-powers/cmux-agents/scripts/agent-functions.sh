#!/usr/bin/env bash
# agent-functions.sh — Source this to get cmux agent lifecycle functions.
#
# Usage (from Claude or shell):
#   source ~/.claude/skills/cmux-agents/scripts/agent-functions.sh
#
# Functions:
#   spawn-agent <repo> <surface> <tab-name> <prompt> [--model sonnet|opus] [--launcher <name>]
#   agent-status <surface>        → prints WORKING|IDLE|EXITED|BLOCKED
#   agent-nudge <surface> <msg>   → sends follow-up message to agent
#   agent-kill <surface>          → clears sidebar + graceful /exit
#   agent-kill-all-except <surface> → kills all agents except the given surface

# ---------------------------------------------------------------------------
# Config: read reposPath from golems config, fallback to ~/Gits
# ---------------------------------------------------------------------------
_AGENT_REPOS_PATH=""
_agent_repos_path() {
  if [[ -z "$_AGENT_REPOS_PATH" ]]; then
    if [[ -f ~/.golems/config.yaml ]]; then
      _AGENT_REPOS_PATH=$(grep '^reposPath:' ~/.golems/config.yaml | sed 's/^reposPath: *"\{0,1\}\([^"]*\)"\{0,1\}/\1/')
    fi
    _AGENT_REPOS_PATH="${_AGENT_REPOS_PATH:-$HOME/Gits}"
  fi
  echo "$_AGENT_REPOS_PATH"
}

# ---------------------------------------------------------------------------
# spawn-agent <repo> <surface> <tab-name> <prompt> [--model sonnet|opus] [--launcher <name>]
#
# Does everything: rename tab, set sidebar, cd + launch claude, wait, send prompt, verify.
#
# Examples:
#   spawn-agent golems surface:114 'T9 npm publish' 'Publish golems-cli to npm'
#   spawn-agent brainlayer surface:92 'T1 kg-fix' 'Fix KG search' --model sonnet
#   spawn-agent golems surface:115 'T2 coach' 'Fix scheduling' --launcher coachClaude
#   spawn-agent orchestrator surface:116 'T3 gemini' 'List files here' --cli gemini
#   spawn-agent golems surface:117 'T4 cursor-audit' 'Audit security' --cli cursor-audit
# ---------------------------------------------------------------------------
spawn-agent() {
  local repo="${1:?Usage: spawn-agent <repo> <surface> <tab-name> <prompt> [--model M] [--launcher L] [--cli gemini|cursor-audit|cursor-work|codex|kiro]}"
  local surface="${2:?Missing surface (e.g. surface:114)}"
  local tab_name="${3:?Missing tab name}"
  local prompt="${4:?Missing prompt}"
  shift 4

  local model=""
  local launcher=""
  local cli=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --model) model="$2"; shift 2 ;;
      --launcher) launcher="$2"; shift 2 ;;
      --cli) cli="$2"; shift 2 ;;
      *) echo "spawn-agent: unknown flag $1" >&2; return 1 ;;
    esac
  done

  local repos_path
  repos_path=$(_agent_repos_path)
  local repo_path="$repos_path/$repo"

  if [[ ! -d "$repo_path" ]]; then
    echo "spawn-agent: repo not found: $repo_path" >&2
    return 1
  fi

  # 1. Rename tab
  cmux tab-action --action rename --surface "$surface" --title "$tab_name"

  # 2. Set sidebar metadata (workspace-aware)
  # AIDEV-NOTE: Colors must be dark enough for light mode. Avoid #22c55e (too light) and #3b82f6 (invisible on blue selection).
  # Safe palette: #15803d (green), #7c3aed (purple), #b45309 (amber), #0369a1 (dark blue), #be123c (red)
  local _ws_flag=""
  [[ -n "${CMUX_WORKSPACE_ID:-}" ]] && _ws_flag="--workspace $CMUX_WORKSPACE_ID"
  cmux set-status "agent-$surface" "$tab_name: booting" --icon terminal --color "#7c3aed" $_ws_flag 2>/dev/null || true
  cmux set-progress 0.0 --label 'starting' $_ws_flag 2>/dev/null || true

  # 3. Build and send launch command based on agent type
  if [[ -n "$cli" ]]; then
    # Non-Claude CLI agent — prompt goes inline, no two-step boot
    # Use absolute paths from ~/.golems/config.yaml to avoid sourcing zshrc (which triggers 1Password biometric)
    local gemini_bin cursor_bin codex_bin kiro_bin
    if [[ -f ~/.golems/config.yaml ]]; then
      gemini_bin=$(grep '^\s*gemini:' ~/.golems/config.yaml | sed 's/.*: *"\{0,1\}\([^"]*\)"\{0,1\}/\1/' | head -1)
      cursor_bin=$(grep '^\s*cursor:' ~/.golems/config.yaml | sed 's/.*: *"\{0,1\}\([^"]*\)"\{0,1\}/\1/' | head -1)
      codex_bin=$(grep '^\s*codex:' ~/.golems/config.yaml | sed 's/.*: *"\{0,1\}\([^"]*\)"\{0,1\}/\1/' | head -1)
      kiro_bin=$(grep '^\s*kiro:' ~/.golems/config.yaml | sed 's/.*: *"\{0,1\}\([^"]*\)"\{0,1\}/\1/' | head -1)
    fi
    gemini_bin="${gemini_bin:-gemini}"
    cursor_bin="${cursor_bin:-cursor}"
    codex_bin="${codex_bin:-codex}"
    kiro_bin="${kiro_bin:-kiro-cli}"

    local cli_cmd="cd $repo_path"
    case "$cli" in
      gemini)
        cli_cmd="$cli_cmd && $gemini_bin \"$prompt\""
        ;;
      cursor-audit)
        cli_cmd="$cli_cmd && $cursor_bin agent --output-format text --model \"gpt-5.3-codex-xhigh\" \"$prompt\""
        ;;
      cursor-work)
        cli_cmd="$cli_cmd && $cursor_bin agent --model \"gpt-5.3-codex-xhigh\" \"$prompt\""
        ;;
      codex)
        cli_cmd="$cli_cmd && $codex_bin --full-auto --model gpt-5.4 \"$prompt\""
        ;;
      kiro)
        cli_cmd="$cli_cmd && $kiro_bin chat --no-interactive \"$prompt\""
        ;;
      *)
        echo "spawn-agent: unknown CLI agent: $cli (use: gemini, cursor-audit, cursor-work, codex, kiro)" >&2
        return 1
        ;;
    esac
    cmux send --surface "$surface" "$cli_cmd"
    cmux send-key --surface "$surface" Return

    # CLI agents don't need two-step boot — wait and verify
    echo "spawn-agent: waiting for $cli to start on $surface..."
    sleep 5
    cmux set-status task "$tab_name" 2>/dev/null || true
    cmux set-progress 0.2 --label 'working' 2>/dev/null || true
    echo "spawn-agent: $tab_name ($cli) launched on $surface"
    return
  fi

  # Claude agent (default or custom launcher)
  local launch_cmd
  if [[ -n "$launcher" ]]; then
    # Custom launcher (e.g. coachClaude, brainClaude) — needs zshrc for shell functions
    launch_cmd="source ~/.zshrc && cd $repo_path && $launcher -s"
  else
    # Use absolute path from config to avoid sourcing zshrc (1Password biometric)
    local claude_bin
    if [[ -f ~/.golems/config.yaml ]]; then
      claude_bin=$(grep '^\s*claude:' ~/.golems/config.yaml | sed 's/.*: *"\{0,1\}\([^"]*\)"\{0,1\}/\1/' | head -1)
    fi
    claude_bin="${claude_bin:-claude}"
    launch_cmd="cd $repo_path && $claude_bin --dangerously-skip-permissions"
    if [[ -n "$model" ]]; then
      launch_cmd="$launch_cmd --model $model"
    fi
  fi

  # 4. Send launch command
  cmux send --surface "$surface" "$launch_cmd"
  cmux send-key --surface "$surface" Return

  # 5. Wait for boot
  echo "spawn-agent: waiting for Claude to boot on $surface..."
  sleep 8

  # 6. Update sidebar
  cmux set-status task "$tab_name" 2>/dev/null || true
  cmux set-progress 0.1 --label 'sending prompt' 2>/dev/null || true

  # 7. Send the task prompt
  if [[ ${#prompt} -gt 200 ]]; then
    # Long prompt — write to temp file
    local prompt_file="/tmp/agent-prompt-$(date +%s)-$$.md"
    echo "$prompt" > "$prompt_file"
    cmux send --surface "$surface" "Read $prompt_file and execute the task described in it."
    cmux send-key --surface "$surface" Return
  else
    cmux send --surface "$surface" "$prompt"
    cmux send-key --surface "$surface" Return
  fi

  # 8. Verify startup
  sleep 8
  cmux set-progress 0.2 --label 'working' 2>/dev/null || true
  local screen
  screen=$(cmux read-screen --surface "$surface" --lines 5 2>/dev/null) || true

  if echo "$screen" | grep -qE '(error|not found|command not found)'; then
    echo "spawn-agent: WARNING — possible error on $surface:" >&2
    echo "$screen" >&2
    cmux set-status task "ERROR: check screen" 2>/dev/null || true
    return 1
  fi

  echo "spawn-agent: $tab_name launched on $surface"
}

# ---------------------------------------------------------------------------
# agent-status <surface> [--workspace <ws>] [--update-sidebar]
#
# Parses screen output → prints one of: WORKING, IDLE, EXITED, BLOCKED
# With --update-sidebar: also updates cmux sidebar metadata for the workspace.
# ---------------------------------------------------------------------------
agent-status() {
  local surface=""
  local workspace=""
  local update_sidebar=false

  # Parse args
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --workspace) workspace="$2"; shift 2 ;;
      --update-sidebar) update_sidebar=true; shift ;;
      surface:*) surface="$1"; shift ;;
      *) surface="$1"; shift ;;
    esac
  done

  if [[ -z "$surface" ]]; then
    echo "Usage: agent-status <surface> [--workspace <ws>] [--update-sidebar]" >&2
    return 1
  fi

  local screen
  if [[ -n "$workspace" ]]; then
    screen=$(cmux read-screen --surface "$surface" --workspace "$workspace" 2>/dev/null)
  else
    screen=$(cmux read-screen --surface "$surface" 2>/dev/null)
  fi
  if [[ $? -ne 0 || -z "$screen" ]]; then
    if $update_sidebar && [[ -n "$workspace" ]]; then
      cmux set-status "agent-$surface" "EXITED" --icon circle --color "#ef4444" --workspace "$workspace" >/dev/null 2>&1 || true
    fi
    echo "EXITED"
    return
  fi

  # Output area: everything above the first ─── separator
  local output_area
  output_area=$(echo "$screen" | sed '/^───/,$d')

  # Status bar: everything below last ─── separator (has tokens, cost, context %)
  local status_bar
  status_bar=$(echo "$screen" | tac | sed '/^───/q' | tac)

  # Extract rich metadata from Claude's status bar and spinner
  local cost="" context_pct="" elapsed="" tokens="" spinner_name="" branch="" changes=""
  cost=$(echo "$status_bar" | grep -oE '\$[0-9]+\.[0-9]+' | head -1)
  context_pct=$(echo "$status_bar" | grep -oE '🧠 [0-9]+\.[0-9]+%' | head -1 | sed 's/🧠 //')
  elapsed=$(echo "$status_bar" | grep -oE '⏱️  [0-9]+m' | head -1 | sed 's/⏱️  //')
  tokens=$(echo "$status_bar" | grep -oE '[0-9]+ tokens' | head -1 | sed 's/ tokens//')
  branch=$(echo "$status_bar" | grep -oE '⎇ [^ ]+' | head -1 | sed 's/⎇ //')
  changes=$(echo "$status_bar" | grep -oE '\+[0-9]+,-[0-9]+' | head -1)
  # Extract spinner text (e.g., "Philosophising" from "● Philosophising… (3m 21s · ...)")
  spinner_name=$(echo "$screen" | grep -oE '● ([A-Z][a-z]+)' | head -1 | sed 's/● //')
  # Extract thinking duration from spinner line
  local think_time=""
  think_time=$(echo "$screen" | grep '●' | grep -oE '[0-9]+m [0-9]+s|[0-9]+s' | head -1)

  local result=""

  # BLOCKED — BLOCKED: anywhere on screen
  if echo "$screen" | grep -qiE 'BLOCKED:'; then
    result="BLOCKED"
  # WORKING — active thinking spinner ANYWHERE on screen (● Philosophising, etc.)
  # AIDEV-NOTE: Claude Code spinner is "● SpinnerText…" between the two ─── separators.
  # Must check FULL screen, not just output_area, because spinner is in the prompt zone.
  elif echo "$screen" | grep -qE '● .*(Thinking|thinking|Quantumizing|Cogitating|Sock-hopping|Brewing|Baking|Simmering|Crunching|Sautéing|Boogieing|Philosophising|Pondering|Musing|Reflecting|Ruminating|Deliberating|Contemplating)'; then
    result="WORKING"
  # WORKING — thinking with timing but maybe no spinner name visible
  elif echo "$screen" | grep -qE '●.*[0-9]+s'; then
    result="WORKING"
  # WORKING — token streaming indicator (↓ = receiving tokens)
  elif echo "$screen" | grep -qE '↓ [0-9]'; then
    result="WORKING"
  # WORKING — tool use in progress (⏺ = tool call marker)
  elif echo "$screen" | grep -qE '⏺ .+\('; then
    result="WORKING"
  # EXITED — shell prompt visible as last non-empty line (no Claude UI active)
  elif echo "$screen" | grep -v '^$' | tail -1 | grep -qE '(~|/Users/).+(\$|❯)\s*$'; then
    result="EXITED"
  # IDLE — ❯ prompt visible between separators AND no spinners anywhere
  elif echo "$screen" | sed -n '/^───/,/^───/p' | grep -qE '^❯'; then
    result="IDLE"
  # Has Claude UI but can't determine state — assume working
  elif echo "$screen" | grep -qE '^───'; then
    result="WORKING"
  else
    result="WORKING"
  fi

  # Update sidebar if requested (suppress cmux output)
  if $update_sidebar && [[ -n "$workspace" ]]; then
    local color icon
    case "$result" in
      # AIDEV-NOTE: Colors must work in light mode, dark mode, AND on blue selection highlight.
      # Tested: teal works everywhere. Pure green/blue/orange fail on selection.
      WORKING) color="#0d9488"; icon="terminal" ;;
      IDLE)    color="#d97706"; icon="circle" ;;
      EXITED)  color="#9ca3af"; icon="circle" ;;
      BLOCKED) color="#dc2626"; icon="alert" ;;
    esac

    # Build rich status: "Philosophising 3m21s $1.67 58%"
    local status_text=""
    if [[ "$result" == "WORKING" && -n "$spinner_name" ]]; then
      status_text="$spinner_name"
      [[ -n "$think_time" ]] && status_text="$status_text $think_time"
    else
      status_text="$result"
    fi
    [[ -n "$cost" ]] && status_text="$status_text $cost"
    [[ -n "$context_pct" ]] && status_text="$status_text ctx:$context_pct"
    [[ -n "$changes" ]] && status_text="$status_text $changes"

    # Also log to workspace log for history
    if [[ -n "$workspace" ]]; then
      cmux set-status "agent-$surface" "$status_text" --icon "$icon" --color "$color" --workspace "$workspace" >/dev/null 2>&1 || true
    else
      cmux set-status "agent-$surface" "$status_text" --icon "$icon" --color "$color" >/dev/null 2>&1 || true
    fi
  fi

  echo "$result"
}

# ---------------------------------------------------------------------------
# agent-monitor --workspace <ws> [--surfaces <s1,s2,...>]
#
# Checks all agent surfaces in a workspace and updates sidebar metadata.
# Call from a cron every 3-5 min for live dashboard.
#
# Example:
#   agent-monitor --workspace workspace:19 --surfaces surface:133,surface:134
#   agent-monitor --workspace workspace:19  # auto-discovers all surfaces
# ---------------------------------------------------------------------------
agent-monitor() {
  local workspace=""
  local surfaces_csv=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --workspace) workspace="$2"; shift 2 ;;
      --surfaces) surfaces_csv="$2"; shift 2 ;;
      *) echo "agent-monitor: unknown flag $1" >&2; return 1 ;;
    esac
  done

  if [[ -z "$workspace" ]]; then
    echo "Usage: agent-monitor --workspace <ws> [--surfaces <s1,s2,...>]" >&2
    return 1
  fi

  # Auto-discover surfaces if not specified
  local -a surfaces
  if [[ -n "$surfaces_csv" ]]; then
    surfaces=(${(s:,:)surfaces_csv})
  else
    for pane in $(cmux list-panes --workspace "$workspace" 2>/dev/null | grep -oE 'pane:[0-9]+'); do
      for surf in $(cmux list-pane-surfaces --pane "$pane" --workspace "$workspace" 2>/dev/null | grep -oE 'surface:[0-9]+'); do
        surfaces+=("$surf")
      done
    done
  fi

  local working=0 idle=0 exited=0 blocked=0 total=${#surfaces[@]}

  for surf in "${surfaces[@]}"; do
    local agent_st
    agent_st=$(agent-status "$surf" --workspace "$workspace" --update-sidebar)
    case "$agent_st" in
      WORKING*) working=$((working + 1)) ;;
      IDLE*)    idle=$((idle + 1)) ;;
      EXITED*)  exited=$((exited + 1)) ;;
      BLOCKED*) blocked=$((blocked + 1)) ;;
    esac
  done

  # Update workspace progress bar
  local label=""
  local progress=0
  if [[ $total -eq 0 ]]; then
    label="no agents"
    progress=0
  elif [[ $exited -eq $total ]]; then
    label="all done"
    progress=1.0
    # Clear progress after all done
    cmux clear-progress --workspace "$workspace" >/dev/null 2>&1 || true
  elif [[ $blocked -gt 0 ]]; then
    label="$blocked BLOCKED, $working working"
    progress=0.5
  else
    label="$working working, $idle idle, $exited done"
    # Progress: rough estimate based on how many are done
    if [[ $total -gt 0 ]]; then
      progress=$(echo "scale=2; $exited / $total" | bc 2>/dev/null || echo "0.5")
      # Clamp between 0.1 and 0.9 while agents are still running
      [[ "$progress" == "0" || "$progress" == ".00" || "$progress" == "0.00" ]] && progress=0.1
    fi
  fi

  if [[ "$progress" != "1.0" ]]; then
    cmux set-progress "$progress" --label "$label" --workspace "$workspace" >/dev/null 2>&1 || true
  fi

  echo "agent-monitor: $workspace — $working working, $idle idle, $exited done, $blocked blocked"
}

# ---------------------------------------------------------------------------
# agent-nudge <surface> <message>
#
# Sends a follow-up message to a running agent.
# ---------------------------------------------------------------------------
agent-nudge() {
  local surface="${1:?Usage: agent-nudge <surface> <message>}"
  local message="${2:?Missing message}"

  cmux send --surface "$surface" "$message"
  cmux send-key --surface "$surface" Return
  echo "agent-nudge: sent to $surface"
}

# ---------------------------------------------------------------------------
# agent-kill <surface>
#
# Clears sidebar metadata, sends /exit for graceful shutdown.
# ---------------------------------------------------------------------------
agent-kill() {
  local surface="${1:?Usage: agent-kill <surface> [--workspace <ws>]}"
  shift
  local workspace=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --workspace) workspace="$2"; shift 2 ;;
      *) shift ;;
    esac
  done

  local ws_flag=""
  [[ -n "$workspace" ]] && ws_flag="--workspace $workspace"

  # Clear this agent's sidebar status
  cmux clear-status "agent-$surface" $ws_flag 2>/dev/null || true

  # Graceful exit
  cmux send --surface "$surface" $ws_flag "/exit"
  cmux send-key --surface "$surface" $ws_flag Return
  echo "agent-kill: sent /exit to $surface"
}

# ---------------------------------------------------------------------------
# agent-kill-all-except <my-surface>
#
# Kills all Claude agents in the current workspace except the given surface.
# Clears sidebar for each before killing.
# ---------------------------------------------------------------------------
agent-kill-all-except() {
  local my_surface="${1:?Usage: agent-kill-all-except <my-surface>}"
  local killed=0

  # Get all surfaces from all panes
  for pane in $(cmux list-panes 2>/dev/null | grep -oE 'pane:[0-9]+'); do
    for surf in $(cmux list-pane-surfaces --pane "$pane" 2>/dev/null | grep -oE 'surface:[0-9]+'); do
      if [[ "$surf" == "$my_surface" ]]; then
        continue
      fi
      # Check if it looks like a Claude session (not a browser, not exited)
      local status
      status=$(agent-status "$surf" 2>/dev/null)
      if [[ "$status" == "EXITED" ]]; then
        continue
      fi
      cmux send --surface "$surf" "/exit"
      cmux send-key --surface "$surf" Return
      killed=$((killed + 1))
    done
  done

  # Clear sidebar once (it's workspace-scoped)
  cmux clear-status agent 2>/dev/null || true
  cmux clear-status task 2>/dev/null || true
  cmux clear-progress 2>/dev/null || true

  echo "agent-kill-all-except: killed $killed agents (kept $my_surface)"
}
