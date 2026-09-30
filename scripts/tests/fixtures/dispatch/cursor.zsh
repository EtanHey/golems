_golem_launch_cursor() {
  local project_name="$1" project_path="$2"; shift 2
  local -x MCP_CONNECTION_NONBLOCKING=1
  local -x CLAUDE_CODE_NO_FLICKER=1

  _golem_parse_unified_flags "$@" || return $?
  _golem_refuse_agent_model_override "${project_name}Cursor" || return $?
  local cursor_args=("${_extra_args[@]}")
  local worker_mode=false
  $_flag_worker && worker_mode=true
  [[ "${GOLEM_ROLE:-}" == "worker" ]] && worker_mode=true
  # --worker exports GOLEM_ROLE=worker for this call only (see _golem_launch_codex).
  [[ "$worker_mode" == true ]] && local -x GOLEM_ROLE=worker
  local agent_context_file=""
  local agent_prompt=""
  local has_raw_option=false
  local arg
  for arg in "${cursor_args[@]}"; do
    [[ "$arg" == -* ]] && has_raw_option=true
  done
  local positional_prompt=""
  if [[ "$has_raw_option" == false && ${#cursor_args[@]} -gt 0 ]]; then
    positional_prompt="${(j: :)cursor_args}"
    cursor_args=()
  fi

  [[ -n "$_flag_worktree" ]] && _golem_bootstrap_worktree "$_flag_worktree"
  cd "${_flag_worktree:-$project_path}" || return 1
  _golem_setup_title "$project_name" "${project_name}Cursor"
  _golem_setup_env "$project_name" || return $?
  if [[ "$worker_mode" == true ]]; then
    agent_prompt=$(_golem_build_worker_prompt "$project_name" "$project_path" "$positional_prompt")
  else
    agent_context_file=$(_golem_inject_agent_context "$project_name" "cursor")
    [[ -n "$agent_context_file" ]] && agent_prompt=$(_golem_build_agent_prompt "$agent_context_file")
  fi

  $_flag_skip && cursor_args=("--yolo" "--approve-mcps" "${cursor_args[@]}")
  [[ -n "$_flag_model" ]] && cursor_args=("--model" "$_flag_model" "${cursor_args[@]}")

  local cursor_exit=0
  if $_flag_headless && [[ -n "$_flag_headless_prompt" ]]; then
    local exec_prompt="$_flag_headless_prompt"
    [[ -n "$agent_prompt" ]] && exec_prompt=$(_golem_build_agent_prompt "$agent_context_file" "$_flag_headless_prompt")
    "${_golem_agent_prefix[@]}" cursor agent "${cursor_args[@]}" --print --output-format text "$exec_prompt"
    cursor_exit=$?
  elif $_flag_continue; then
    local continue_prompt="${_flag_headless_prompt:-$positional_prompt}"
    if [[ -n "$continue_prompt" ]]; then
      [[ "$worker_mode" != true && -n "$agent_prompt" ]] && continue_prompt=$(_golem_build_agent_prompt "$agent_context_file" "$continue_prompt")
      "${_golem_agent_prefix[@]}" cursor agent --continue "${cursor_args[@]}" "$continue_prompt"
    else
      "${_golem_agent_prefix[@]}" cursor agent --continue "${cursor_args[@]}"
    fi
    cursor_exit=$?
  else
    if [[ -n "$agent_prompt" && "$has_raw_option" == false ]]; then
      local launch_prompt="$agent_prompt"
      if [[ "$worker_mode" != true && -n "$positional_prompt" ]]; then
        launch_prompt=$(_golem_build_agent_prompt "$agent_context_file" "$positional_prompt")
      fi
      "${_golem_agent_prefix[@]}" cursor agent "${cursor_args[@]}" "$launch_prompt"
    else
      "${_golem_agent_prefix[@]}" cursor agent "${cursor_args[@]}"
    fi
    cursor_exit=$?
  fi

  _golem_cleanup_agent_context "$agent_context_file"
  _golem_reset_title
  return "$cursor_exit"
}

# ── Gemini launcher ───────────────────────────────────────────────
