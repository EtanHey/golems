_golem_launch_gemini() {
  local project_name="$1" project_path="$2"; shift 2
  local -x MCP_CONNECTION_NONBLOCKING=1
  local -x CLAUDE_CODE_NO_FLICKER=1

  _golem_parse_unified_flags "$@" || return $?
  local agy_args=("${_extra_args[@]}")
  local worker_mode=false
  $_flag_worker && worker_mode=true
  [[ "${GOLEM_ROLE:-}" == "worker" ]] && worker_mode=true
  # cmuxlayer can select a task worker using only its role export.
  [[ -n "${GOLEM_AGENT_ROLE:-}" ]] && worker_mode=true
  # --worker exports GOLEM_ROLE=worker for this call only (see _golem_launch_codex).
  [[ "$worker_mode" == true ]] && local -x GOLEM_ROLE=worker
  local agy_agent="${GOLEM_AGY_AGENT:-}"
  if [[ "$worker_mode" == true || -n "$agy_agent" ]]; then
    if [[ -z "$agy_agent" ]]; then
      case "${GOLEM_AGENT_ROLE:-}" in
        gatherer) agy_agent=gatherer ;;
        *) agy_agent=shell-worker ;;
      esac
    fi
    if [[ "$agy_agent" == *[^a-zA-Z0-9_-]* || ! -f "$HOME/.gemini/antigravity-cli/agents/$agy_agent.md" ]]; then
      print -u2 -r -- "repoGolem: Gemini profile '$agy_agent' is invalid or not installed; agent not launched."
      return 1
    fi
  fi
  local agent_context_file=""
  local agent_prompt=""
  local has_raw_option=false
  local arg
  for arg in "${agy_args[@]}"; do
    [[ "$arg" == -* ]] && has_raw_option=true
  done
  local positional_prompt=""
  if [[ "$has_raw_option" == false && ${#agy_args[@]} -gt 0 ]]; then
    positional_prompt="${(j: :)agy_args}"
    agy_args=()
  fi

  [[ -n "$_flag_worktree" ]] && _golem_bootstrap_worktree "$_flag_worktree"
  local launch_dir="${_flag_worktree:-$project_path}"
  cd "$launch_dir" || return 1
  _golem_setup_title "$project_name" "${project_name}Gemini"
  _golem_setup_env "$project_name" || return $?
  _golem_sync_agy_workspace "$project_name" "$launch_dir" || {
    print -u2 -r -- "repoGolem: AGY MCP sync failed; check registry/config JSON and retry after other writers finish. Agent not launched."
    return 1
  }
  if [[ "$worker_mode" == true ]]; then
    agent_prompt=$(_golem_build_worker_prompt "$project_name" "$project_path" "$positional_prompt")
  else
    agent_context_file=$(_golem_inject_agent_context "$project_name" "gemini")
    [[ -n "$agent_context_file" ]] && agent_prompt=$(_golem_build_agent_prompt "$agent_context_file")
  fi

  local agy_bin="agy"
  command -v agy >/dev/null 2>&1 || agy_bin="$HOME/.local/bin/agy"

  local agy_model
  agy_model=$(_golem_agy_resolve_model "${_flag_model:-}")
  agy_args=("--model" "$agy_model" "${agy_args[@]}")
  [[ -n "$agy_agent" ]] && agy_args=("--agent" "$agy_agent" "${agy_args[@]}")

  $_flag_skip && agy_args=("--dangerously-skip-permissions" "${agy_args[@]}")
  $_flag_continue && agy_args=("--continue" "${agy_args[@]}")

  local agy_exit=0
  if $_flag_headless && [[ -n "$_flag_headless_prompt" ]]; then
    local exec_prompt="$_flag_headless_prompt"
    [[ -n "$agent_prompt" ]] && exec_prompt=$(_golem_build_agent_prompt "$agent_context_file" "$_flag_headless_prompt")
    "${_golem_agent_prefix[@]}" "$agy_bin" "${agy_args[@]}" --print "$exec_prompt"
    agy_exit=$?
  elif $_flag_continue; then
    if [[ -n "$positional_prompt" ]]; then
      local continue_prompt="$positional_prompt"
      [[ "$worker_mode" != true && -n "$agent_prompt" ]] && continue_prompt=$(_golem_build_agent_prompt "$agent_context_file" "$positional_prompt")
      "${_golem_agent_prefix[@]}" "$agy_bin" "${agy_args[@]}" --prompt-interactive "$continue_prompt"
    elif [[ -n "$agent_prompt" ]]; then
      "${_golem_agent_prefix[@]}" "$agy_bin" "${agy_args[@]}" --prompt-interactive "$agent_prompt"
    else
      "${_golem_agent_prefix[@]}" "$agy_bin" "${agy_args[@]}"
    fi
    agy_exit=$?
  else
    if [[ -n "$agent_prompt" && "$has_raw_option" == false ]]; then
      local launch_prompt="$agent_prompt"
      if [[ "$worker_mode" != true && -n "$positional_prompt" ]]; then
        launch_prompt=$(_golem_build_agent_prompt "$agent_context_file" "$positional_prompt")
      fi
      "${_golem_agent_prefix[@]}" "$agy_bin" "${agy_args[@]}" --prompt-interactive "$launch_prompt"
    elif [[ -n "$positional_prompt" ]]; then
      "${_golem_agent_prefix[@]}" "$agy_bin" "${agy_args[@]}" --prompt-interactive "$positional_prompt"
    else
      "${_golem_agent_prefix[@]}" "$agy_bin" "${agy_args[@]}"
    fi
    agy_exit=$?
  fi

  _golem_cleanup_agent_context "$agent_context_file"
  _golem_reset_title
  return "$agy_exit"
}

# ── Run launcher (dev server) ─────────────────────────────────────
