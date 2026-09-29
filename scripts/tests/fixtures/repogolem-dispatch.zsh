# ═══════════════════════════════════════════════════════════════════
# GOLEM DISPATCH — R78 shell optimization
# Replaces 189 eval'd functions with thin wrappers + one dispatch.
# Startup cost: ~1ms (registering names) vs ~2min (eval'ing bodies)
# ═══════════════════════════════════════════════════════════════════

# Registry file path
: ${RALPH_REGISTRY_FILE:="$HOME/.config/ralphtools/registry.json"}

# Directory this file was sourced from. install-golem-dispatch.sh ships
# worktree-bootstrap.sh next to it, so -w launches can find it installed or not.
typeset -g _GOLEM_DISPATCH_DIR="${${(%):-%x}:A:h}"

# Thin bootstrap so `repoGolem` exists in shells that source golem-dispatch.zsh
# but not the full registry library. First call loads the real implementation.
if ! typeset -f repoGolem >/dev/null 2>&1; then
  function repoGolem() {
    local registry_lib="$HOME/.config/ralphtools/lib/ralph-registry.zsh"
    if [[ ! -f "$registry_lib" ]]; then
      echo "Error: repoGolem requires $registry_lib" >&2
      return 1
    fi

    unfunction repoGolem 2>/dev/null
    source "$registry_lib"

    if ! typeset -f repoGolem >/dev/null 2>&1; then
      echo "Error: repoGolem failed to load from $registry_lib" >&2
      return 1
    fi

    repoGolem "$@"
  }
fi

# ── Core dispatch: called by all thin wrappers ────────────────────


# Load every definition from the real location of this sourced facade.
# A missing module must stop sourcing before any wrappers are registered.
for _golem_module in core environment context agy flags claude codex-resume codex cursor; do
  if [[ ! -f "${_GOLEM_DISPATCH_DIR}/dispatch/${_golem_module}.zsh" ]]; then
    print -u2 -- "Missing dispatcher module: ${_GOLEM_DISPATCH_DIR}/dispatch/${_golem_module}.zsh"
    return 1
  fi
  source "${_GOLEM_DISPATCH_DIR}/dispatch/${_golem_module}.zsh" || return 1
done
unset _golem_module
_golem_launch_gemini() {
  local project_name="$1" project_path="$2"; shift 2
  local -x MCP_CONNECTION_NONBLOCKING=1
  local -x CLAUDE_CODE_NO_FLICKER=1

  _golem_parse_unified_flags "$@" || return $?
  local agy_args=("${_extra_args[@]}")
  local worker_mode=false
  $_flag_worker && worker_mode=true
  [[ "${GOLEM_ROLE:-}" == "worker" ]] && worker_mode=true
  # --worker exports GOLEM_ROLE=worker for this call only (see _golem_launch_codex).
  [[ "$worker_mode" == true ]] && local -x GOLEM_ROLE=worker
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
  _golem_setup_env "$project_name"
  _golem_sync_agy_workspace "$project_name" "$launch_dir"
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

# Register all wrappers on source
_golem_register_wrappers
