_golem_launch_claude() {
  local project_name="$1" project_path="$2"; shift 2
  local -x MCP_CONNECTION_NONBLOCKING=1
  local -x CLAUDE_CODE_NO_FLICKER=1
  local capitalized_name="${(C)project_name[1]}${project_name[2,-1]}"
  local ntfy_topic="etans-${project_name}Claude"

  _golem_parse_unified_flags "$@" || return $?
  # AIDEV-NOTE: --worker deliberately does NOT set GOLEM_ROLE here, unlike the
  # Codex/Cursor/Gemini launchers. cmuxlayer passes --worker to every worker,
  # Claude included, and GOLEM_ROLE=worker drops Claude to medium effort below;
  # Opus workers must keep their effort. A caller-set GOLEM_ROLE=worker still
  # means medium.
  _golem_refuse_claude_sonnet_full_pane || return $?
  local claude_args=("${_extra_args[@]}")

  if [[ -n "$_flag_worktree" ]]; then
    _golem_copy_mcp_to_worktree "$project_path" "$_flag_worktree" || return $?
    _golem_bootstrap_worktree "$_flag_worktree"
  fi
  cd "${_flag_worktree:-$project_path}" || return 1
  _golem_setup_title "$project_name" "${project_name}Claude"

  # Notifications. Same filename as before, staged 0600 under the launch
  # staging dir instead of a shared /tmp (see _golem_staging_dir).
  local _notify_staging_dir _notify_config=""
  if _notify_staging_dir=$(_golem_staging_dir "$project_name"); then
    _notify_config="${_notify_staging_dir}/.claude_notify_config_${project_name}.json"
  fi
  [[ -n "$_notify_config" ]] && rm -f "$_notify_config" 2>/dev/null
  # Clean up a launch the user interrupts. localtraps keeps the trap scoped to
  # this function: the file is sourced into the user's interactive shell, and a
  # leaked trap would fire on the shell itself.
  #
  # INT/TERM only, deliberately. zsh tears function locals down BEFORE a
  # localtraps EXIT trap runs, so an EXIT trap reads an unset `$_notify_config`:
  # it cannot clean anything, and under `setopt nounset` it prints
  # `parameter not set` on every launch. The normal exit path is already covered
  # by the explicit `rm` after `_golem_reset_title` below. An INT/TERM trap fires
  # while this function is still on the stack, so it does see the local.
  # `${_notify_config:-}` keeps the guard nounset-safe either way.
  setopt localoptions localtraps
  trap '[[ -n "${_notify_config:-}" ]] && rm -f "${_notify_config}" 2>/dev/null' INT TERM
  if [[ -n "$_flag_notify_mode" && -n "$_notify_config" ]]; then
    local quiet_val="false" verbose_val="false"
    [[ "$_flag_notify_mode" == "quiet" ]] && quiet_val="true"
    [[ "$_flag_notify_mode" == "verbose" ]] && verbose_val="true"
    ( umask 077
      jq -n \
        --arg name "${capitalized_name} Claude" \
        --arg topic "$ntfy_topic" \
        --arg cwd "$project_path" \
        --argjson quiet "$quiet_val" \
        --argjson verbose "$verbose_val" \
        '{name: $name, topic: $topic, quiet: $quiet, verbose: $verbose, cwd: $cwd}' \
        > "$_notify_config" )
    chmod 600 "$_notify_config" 2>/dev/null
  fi

  if $_flag_update; then
    echo "Updating Claude Code..."
    claude update
    [[ -f "$HOME/.claude/plugins/hide-hooks/patch-claude.js" ]] && node "$HOME/.claude/plugins/hide-hooks/patch-claude.js" 2>/dev/null
  fi

  _golem_setup_env "$project_name" || return $?

  # Pin the CURRENT top Opus at 1M-context by default so {name}Claude launchers (orchestrator/
  # lead role) boot on the 1M model without a manual /model flip. Precedence:
  #   -m <model>  (explicit override, e.g. -m sonnet, -m claude-opus-4-8, -m fable)
  #   -S/--sonnet (Sonnet request; refused above for full panes)
  #   default     claude-opus-5-5[1m]
   #
   # The pin exists to stop a PRIOR session's model (notably Fable) persisting into a
   # fresh boot — not to freeze one version. It must therefore track the current top
   # Opus. Bump this on each Opus release; do NOT drop the --model flag, which would
   # reopen the inheritance hole the pin was added to close.
  local _claude_model
  if [[ -n "$_flag_model" ]]; then
    _claude_model="$(_golem_claude_resolve_model "$_flag_model")"
  elif $_flag_sonnet; then
    _claude_model="sonnet"
  else
    _claude_model="claude-opus-5-5[1m]"
  fi
  claude_args=("--model" "$_claude_model" "${claude_args[@]}")
  # Effort per seat (weave 5A, 2026-09-05). Precedence: -E flag > GOLEM_EFFORT env >
  # GOLEM_ROLE=worker -> medium > lead default high. Effort follows the cost of being
  # wrong on the seat's typical turn, not the seat's rank; retrieval-heavy workers do
  # not earn high. xhigh is deliberately not a default anywhere: its cost is unrecorded.
  local _claude_effort
  if [[ -n "$_flag_effort" ]]; then
    _claude_effort="$_flag_effort"
  elif [[ -n "${GOLEM_EFFORT:-}" ]]; then
    _claude_effort="$GOLEM_EFFORT"
  elif [[ "${GOLEM_ROLE:-}" == "worker" ]]; then
    _claude_effort="medium"
  else
    _claude_effort="high"
  fi
  claude_args=("--effort" "$_claude_effort" "${claude_args[@]}")
  $_flag_skip && claude_args=("--dangerously-skip-permissions" "${claude_args[@]}")
  $_flag_continue && claude_args=("--continue" "${claude_args[@]}")
  if $_flag_headless; then
    claude_args=("--print" "${claude_args[@]}")
    [[ -n "$_flag_headless_prompt" ]] && claude_args+=("$_flag_headless_prompt")
  fi

  # Load contexts from registry
  local registry="$RALPH_REGISTRY_FILE"
  if [[ -f "$registry" ]]; then
    local ctx_list
    ctx_list=$(jq -r --arg proj "$project_name" '.projects[$proj].contexts // [] | .[]' "$registry" 2>/dev/null)
    local contexts_dir="$HOME/.claude/contexts"
    for ctx in ${(f)ctx_list}; do
      local ctx_file="${contexts_dir}/${ctx}.md"
      [[ -f "$ctx_file" ]] && claude_args+=("--append-system-prompt-file" "$ctx_file")
    done

    local disable_chrome
    disable_chrome=$(jq -r --arg proj "$project_name" '.projects[$proj].disableChrome // false' "$registry" 2>/dev/null)
    [[ "$disable_chrome" == "true" ]] && claude_args+=("--no-chrome")

    local agent_name
    agent_name=$(jq -r --arg proj "$project_name" '.projects[$proj].agent // ""' "$registry" 2>/dev/null)
    [[ -n "$agent_name" ]] && claude_args+=("--agent" "$agent_name")

    local inherit_from
    inherit_from=$(jq -r --arg proj "$project_name" '.projects[$proj].mcpInheritFrom // ""' "$registry" 2>/dev/null)
    if [[ -n "$inherit_from" ]]; then
      local inherit_path
      inherit_path=$(jq -r --arg proj "$inherit_from" '.projects[$proj].path // ""' "$registry" 2>/dev/null)
      inherit_path="${inherit_path/#\~/$HOME}"
      [[ -n "$inherit_path" && -f "${inherit_path}/.mcp.json" ]] && claude_args+=("--mcp-config" "${inherit_path}/.mcp.json")
    fi
  fi

  local claude_exit=0
  if $_flag_web; then
    local _ttyd_port
    _ttyd_port=$(jq -r --arg proj "$project_name" '.projects[$proj].ttydPort // 0' "$registry" 2>/dev/null)
    if [[ "$_ttyd_port" -gt 0 ]] && typeset -f _repoclaude_web_mode >/dev/null 2>&1; then
      "${_golem_agent_prefix[@]}" _repoclaude_web_mode "$project_name" "${project_name}Claude" "$_ttyd_port" "${claude_args[@]}"
      claude_exit=$?
    else
      echo "Web mode not configured for $project_name"
      claude_exit=1
    fi
  else
    "${_golem_agent_prefix[@]}" claude "${claude_args[@]}"
    claude_exit=$?
  fi

  _golem_reset_title
  [[ -n "$_notify_config" ]] && rm -f "$_notify_config" 2>/dev/null
  return "$claude_exit"
}

# ── Codex launcher ────────────────────────────────────────────────
