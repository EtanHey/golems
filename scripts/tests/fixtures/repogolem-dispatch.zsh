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
for _golem_module in core environment context agy flags; do
  if [[ ! -f "${_GOLEM_DISPATCH_DIR}/dispatch/${_golem_module}.zsh" ]]; then
    print -u2 -- "Missing dispatcher module: ${_GOLEM_DISPATCH_DIR}/dispatch/${_golem_module}.zsh"
    return 1
  fi
  source "${_GOLEM_DISPATCH_DIR}/dispatch/${_golem_module}.zsh" || return 1
done
unset _golem_module
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

  _golem_setup_env "$project_name"

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

# Worker mode uses generated {repo}CodexWorker launchers because -w/--worktree
# already selects a worktree path and must remain backward-compatible.
_golem_launch_codex_worker() {
  local _golem_codex_worker_mode=true
  _golem_launch_codex "$@"
}

_golem_codex_rollout_mtime() {
  local rollout_file="$1"
  local mtime

  mtime=$(stat -f '%m' "$rollout_file" 2>/dev/null) \
    || mtime=$(stat -c '%Y' "$rollout_file" 2>/dev/null) \
    || return 1
  print -r -- "$mtime"
}

_golem_find_codex_resume_rollouts() {
  local selector="$1" resume_cwd="$2"
  local sessions_root="${CODEX_HOME:-$HOME/.codex}/sessions"
  [[ -d "$sessions_root" && -n "$selector" ]] || return 1

  if [[ "$selector" != "--last" ]]; then
    [[ "$selector" =~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' ]] \
      || return 1
    local matching_rollout
    while IFS= read -r -d '' matching_rollout; do
      print -r -- "$matching_rollout"
      return 0
    done < <(find "$sessions_root" -type f -name "rollout-*-${selector}.jsonl" -print0 2>/dev/null)
    return 1
  fi

  local session_meta_stream
  session_meta_stream=$(find "$sessions_root" -type f -name 'rollout-*.jsonl' -print0 2>/dev/null \
    | xargs -0 awk 'FNR == 1 { print FILENAME "\t" $0; nextfile }' 2>/dev/null) || return 1

  local matching_rollouts
  matching_rollouts=$(print -rn -- "$session_meta_stream" | jq -Rr --arg cwd "$resume_cwd" '
    index("\t") as $tab
    | select($tab != null)
    | .[0:$tab] as $rollout_file
    | .[($tab + 1):] as $session_meta_json
    | ($session_meta_json | fromjson?) as $session_meta
    | select(
        $session_meta.type == "session_meta"
        and $session_meta.payload.cwd == $cwd
      )
    | $rollout_file
  ' 2>/dev/null) || return 1

  local rollout_file rollout_mtime
  local -a ranked_rollouts=()
  for rollout_file in ${(f)matching_rollouts}; do
    rollout_mtime=$(_golem_codex_rollout_mtime "$rollout_file") || continue
    ranked_rollouts+=("${rollout_mtime}"$'\t'"${rollout_file}")
  done

  (( ${#ranked_rollouts[@]} > 0 )) || return 1
  print -rl -- "${ranked_rollouts[@]}" \
    | LC_ALL=C sort -t $'\t' -k1,1nr -k2,2r \
    | cut -f2-
}

_golem_find_codex_resume_rollout() {
  local rollout_file
  while IFS= read -r rollout_file; do
    [[ -n "$rollout_file" ]] || continue
    print -r -- "$rollout_file"
    return 0
  done < <(_golem_find_codex_resume_rollouts "$@")
  return 1
}

_golem_read_codex_rollout_model_effort() {
  local rollout_file="$1"
  [[ -f "$rollout_file" ]] || return 1

  local recovered_state
  recovered_state=$(jq -rs '
    [
      .[]
      | select(
          .type == "turn_context"
          and (.payload.model | type == "string")
          and (.payload.model | length > 0)
          and (.payload.effort | type == "string")
          and (.payload.effort | length > 0)
        )
      | [.payload.model, .payload.effort]
      | @tsv
    ]
    | last // empty
  ' "$rollout_file" 2>/dev/null) || return 1
  [[ -n "$recovered_state" ]] || return 1
  print -r -- "$recovered_state"
}

_golem_codex_resume_index() {
  local -a args=("$@")
  local index=1 token

  while (( index <= ${#args[@]} )); do
    token="${args[$index]}"
    case "$token" in
      resume)
        print -r -- "$index"
        return 0 ;;
      --)
        return 1 ;;
      -c|--config|--enable|--disable|--remote|--remote-auth-token-env|-i|--image|\
      -m|--model|--local-provider|-p|--profile|-s|--sandbox|-C|--cd|--add-dir|\
      -a|--ask-for-approval)
        (( index += 2 )) ;;
      -* )
        (( index += 1 )) ;;
      *)
        return 1 ;;
    esac
  done

  return 1
}

_golem_launch_codex() {
  local project_name="$1" project_path="$2"; shift 2
  local -x MCP_CONNECTION_NONBLOCKING=1
  local -x CLAUDE_CODE_NO_FLICKER=1
  local _flag_codex_effort _flag_codex_effort_explicit _flag_codex_help _flag_codex_worker
  local -a _codex_extra_args _codex_passthrough_args _extra_args

  _golem_parse_codex_flags "$@" || return $?
  if $_flag_codex_help; then
    _golem_print_codex_help
    return 0
  fi
  _golem_parse_unified_flags "${_codex_extra_args[@]}" || return $?
  _extra_args+=("${_codex_passthrough_args[@]}")
  local codex_args=("${_extra_args[@]}")
  local explicit_resume=false
  local resume_selector=""
  local resume_prefix_flag=""
  local resume_index=""
  resume_index=$(_golem_codex_resume_index "${codex_args[@]}") || resume_index=""
  if [[ -n "$resume_index" ]]; then
    explicit_resume=true
    resume_selector="${codex_args[$(( resume_index + 1 ))]:-}"
    if (( resume_index == 2 )) \
       && [[ "${codex_args[1]}" == "--dangerously-bypass-approvals-and-sandbox" ]]; then
      resume_prefix_flag="${codex_args[1]}"
      codex_args=("${(@)codex_args[2,-1]}")
    fi
  fi
  if [[ ( "$explicit_resume" == true || "$_flag_continue" == true ) \
     && "$_flag_headless" == true ]]; then
    echo "Error: Cannot combine Codex resume with -p/--print; start an interactive resume instead." >&2
    return 2
  fi
  local codex_config_args=()
  if $_flag_codex_effort_explicit \
     || [[ "$explicit_resume" == false && "$_flag_continue" == false ]]; then
    codex_config_args=("-c" "model_reasoning_effort=\"${_flag_codex_effort}\"")
  fi
  # Pin the CURRENT top Sol on fresh boots so a prior session's model cannot leak into
  # the next one. This is a moving fleet default, not a frozen version: bump it on each
  # Sol release, and do not drop the --model flag. Resume paths recover their session model
  # from the selected rollout unless the caller deliberately supplies -m/--model.
  local model="${_flag_model:-}"
  if [[ "$explicit_resume" == false && "$_flag_continue" == false && -z "$model" ]]; then
    model="gpt-6-sol"
  fi
  local worker_mode="${_golem_codex_worker_mode:-false}"
  $_flag_codex_worker && worker_mode=true
  [[ "${GOLEM_ROLE:-}" == "worker" ]] && worker_mode=true
  # --worker (and the CodexWorker alias) is the one worker signal: export it to
  # this call and the agent it launches. `local -x` ends with the call, so the
  # user's interactive shell keeps whatever GOLEM_ROLE it had.
  [[ "$worker_mode" == true ]] && local -x GOLEM_ROLE=worker
  local agent_context_file=""
  local agent_prompt=""
  local has_raw_option=false
  local arg
  for arg in "${codex_args[@]}"; do
    [[ "$arg" == -* ]] && has_raw_option=true
  done
  local positional_prompt=""
  if [[ "$explicit_resume" == false && "$has_raw_option" == false && ${#codex_args[@]} -gt 0 ]]; then
    positional_prompt="${(j: :)codex_args}"
    codex_args=()
  fi

  if [[ -n "$_flag_worktree" ]]; then
    _golem_copy_mcp_to_worktree "$project_path" "$_flag_worktree" || return $?
    _golem_bootstrap_worktree "$_flag_worktree"
  fi
  cd "${_flag_worktree:-$project_path}" || return 1
  if [[ "$worker_mode" == true ]]; then
    _golem_setup_title "$project_name" "${project_name}CodexWorker"
  else
    _golem_setup_title "$project_name" "${project_name}Codex"
  fi
  _golem_setup_env "$project_name"

  if [[ "$explicit_resume" == true || "$_flag_continue" == true ]]; then
    [[ "$explicit_resume" == false ]] && resume_selector="--last"
    if [[ -z "$resume_selector" ]]; then
      echo "Error: Cannot honor Codex resume: no session id or --last selector was provided." >&2
      echo "Use -c/--continue or pass an explicit session UUID." >&2
      _golem_reset_title
      return 2
    fi

    if [[ -z "$_flag_model" ]] || ! $_flag_codex_effort_explicit; then
      local rollout_candidates
      rollout_candidates=$(_golem_find_codex_resume_rollouts "$resume_selector" "$PWD")
      local -a resume_rollouts=("${(@f)rollout_candidates}")
      if (( ${#resume_rollouts[@]} == 0 )); then
        echo "Error: Cannot honor Codex resume: no rollout found for selector ${resume_selector} in ${CODEX_HOME:-$HOME/.codex}/sessions." >&2
        _golem_reset_title
        return 2
      fi

      local resume_rollout recovered_state recovered_model recovered_effort
      for resume_rollout in "${resume_rollouts[@]}"; do
        recovered_state=$(_golem_read_codex_rollout_model_effort "$resume_rollout")
        [[ "$recovered_state" == *$'\t'* ]] || continue
        recovered_model="${recovered_state%%$'\t'*}"
        recovered_effort="${recovered_state#*$'\t'}"
        case "$recovered_effort" in
          low|medium|high|xhigh|max|ultra) break ;;
          *) recovered_state="" ;;
        esac
      done
      if [[ "$recovered_state" != *$'\t'* ]]; then
        echo "Error: Cannot honor Codex resume: no usable model/effort state found for selector ${resume_selector}." >&2
        _golem_reset_title
        return 2
      fi

      [[ -z "$model" ]] && model="$recovered_model"
      if ! $_flag_codex_effort_explicit; then
        codex_config_args=("-c" "model_reasoning_effort=\"${recovered_effort}\"")
      fi
    fi
  fi

  if [[ "$worker_mode" == true ]]; then
    agent_prompt=$(_golem_build_worker_prompt "$project_name" "$project_path" "$positional_prompt")
  else
    agent_context_file=$(_golem_inject_agent_context "$project_name" "codex")
    [[ -n "$agent_context_file" ]] && agent_prompt=$(_golem_build_agent_prompt "$agent_context_file")
  fi

  if [[ "$explicit_resume" == false && -n "$model" ]]; then
    codex_args=("--model" "$model" "${codex_args[@]}")
  fi

  # Build MCP config for codex.
  # This JSON can carry live API tokens, so it is staged 0600 inside CODEX_HOME
  # (never in a shared /tmp) and deleted as soon as the profile is rendered.
  local merged_mcp_json='{"mcpServers":{}}'
  if typeset -f _ralph_build_mcp_config >/dev/null 2>&1; then
    local built=$(  _ralph_build_mcp_config "$project_name" 2>/dev/null)
    [[ -n "$built" && "$built" != "null" ]] && merged_mcp_json="$built"
  fi

  local codex_home="${CODEX_HOME:-$HOME/.codex}"
  # Give every launch its own profile. A project- or directory-stable name lets
  # a concurrent launch overwrite this launch's config and remove it on exit.
  local codex_launch_digest
  if ! codex_launch_digest=$(setopt pipefail; head -c 16 /dev/urandom 2>/dev/null | shasum -a 256 2>/dev/null | cut -c1-8); then
    codex_launch_digest=""
  fi
  # (no (#cN) here: that needs EXTENDED_GLOB, which this file does not set)
  if [[ ${#codex_launch_digest} -ne 8 ]]; then
    print -u2 -- "repoGolem: could not generate a unique Codex profile id; refusing to publish a shared profile."
    _golem_cleanup_agent_context "$agent_context_file"
    _golem_reset_title
    return 1
  fi
  local codex_profile="repogolem-${project_name//[^A-Za-z0-9_-]/-}-${codex_launch_digest}"
  local codex_profile_file="${codex_home}/${codex_profile}.config.toml"
  mkdir -p "$codex_home" 2>/dev/null
  # Reap staging files orphaned by an interrupted earlier launch. The 24h guard
  # keeps this from touching a concurrent launch's in-flight temp file.
  rm -f "${codex_home}"/.repogolem-codex-*(N.mh+24) 2>/dev/null

  local merged_mcp_file
  merged_mcp_file=$(umask 077; mktemp "${codex_home}/.repogolem-codex-${codex_profile}.json.XXXXXX") || { _golem_cleanup_agent_context "$agent_context_file"; return 1; }
  chmod 600 "$merged_mcp_file" 2>/dev/null
  print -r -- "$merged_mcp_json" > "$merged_mcp_file"

  if [[ -f ".mcp.json" ]]; then
    local _tmp_merge
    _tmp_merge=$(umask 077; mktemp "${codex_home}/.repogolem-codex-${codex_profile}.merge.json.XXXXXX") || { rm -f "$merged_mcp_file"; _golem_cleanup_agent_context "$agent_context_file"; return 1; }
    chmod 600 "$_tmp_merge" 2>/dev/null
    if jq -s 'reduce .[] as $item ({"mcpServers":{}}; .mcpServers += ($item.mcpServers // {}))' "$merged_mcp_file" ".mcp.json" > "$_tmp_merge" 2>/dev/null; then
      mv "$_tmp_merge" "$merged_mcp_file"
      chmod 600 "$merged_mcp_file" 2>/dev/null
    else
      rm -f "$_tmp_merge"
    fi
  fi

  # Render this launch's MCP servers into a per-launch Codex profile file
  # instead of injecting them as `-c mcp_servers.*` overrides on the command line.
  #
  # WHY: every `-c` override is argv, and argv is world-readable via `ps` to
  # every local process for the whole life of the session. That published
  # LINEAR_API_TOKEN and every other MCP secret on both Macs.
  #
  # MECHANISM (codex-cli 0.149.1, `codex --help`):
  #   -p, --profile <CONFIG_PROFILE_V2>
  #           Layer $CODEX_HOME/<name>.config.toml on top of the base user config
  # so `--profile repogolem-<project>-<launch-id>` layers THIS launch's servers on
  # top of the base user config, and puts their secrets in a 0600 file instead
  # of argv. Note this layers, it does not isolate: servers already declared in
  # the base `$CODEX_HOME/config.toml` still load in every session, exactly as
  # they did before. What the profile guarantees is that the servers rendered
  # from one repo's `.mcp.json` never load in another repo's session.
  # `.mcp.json` remains the source of truth — this file is regenerated from it
  # on every launch and removed once codex exits.
  # A caller-supplied profile wins outright: codex-cli refuses the flag twice
  #   error: the argument '--profile <CONFIG_PROFILE_V2>' cannot be used multiple times
  # so appending ours on top of theirs would abort the launch (verified on 0.149.1).
  local codex_caller_profile=""
  local codex_arg
  for codex_arg in "${codex_args[@]}"; do
    case "$codex_arg" in
      # clap accepts the attached short form too, so `-pmyprofile` is a
      # profile selection and must suppress ours just like `--profile`.
      --profile|--profile=*|-p|-p?*) codex_caller_profile="explicit" ;;
    esac
  done

  local codex_profile_tmp=""
  local codex_profile_published=false
  local -i codex_profile_servers=0
  # NOTE: declare every loop-local up front. Inside the `{ ... } > file` group a
  # bare `local x` re-declaration would PRINT `x=value` into the rendered TOML
  # (zsh typeset displays an already-set variable), corrupting the config file.
  local mcp_names="" mcp_command="" mcp_args_json="" mcp_url="" mcp_env_lines=""
  local mcp_timeout="" mcp_name_toml="" wrote_env_table=false env_json="" env_key="" env_value=""
  local -a codex_http_env=()

  if [[ -n "$codex_caller_profile" ]]; then
    # Their profile wins outright — codex refuses `--profile` twice. Do not
    # write a profile they did not ask for; that would leave MCP secrets on
    # disk for a launch that will never read them.
    print -u2 -- "repoGolem: honoring your explicit Codex profile; this project's .mcp.json MCP servers were NOT layered (Codex accepts one profile)."
    rm -f "$merged_mcp_file"
  elif codex_profile_tmp=$(umask 077; mktemp "${codex_home}/.${codex_profile}.toml.XXXXXX" 2>/dev/null); then
    chmod 600 "$codex_profile_tmp" 2>/dev/null
    # Say so outside the render group below: anything printed inside it lands in the TOML.
    if jq -e '.mcpServers.supabase.args? // [] | any(type == "string" and (. == "--access-token" or startswith("--access-token=")))' \
      "$merged_mcp_file" >/dev/null 2>&1; then
      print -u2 -- "repoGolem: dropped supabase's --access-token arg from the Codex profile (argv is visible via ps); the server reads SUPABASE_ACCESS_TOKEN from its env."
    fi
    {
      print -r -- "# Generated by repoGolem for project '${project_name}'. Do not edit by hand."
      print -r -- "# Source of truth: the project's .mcp.json — regenerated on every launch."
      mcp_names=$(jq -r '.mcpServers // {} | keys[]' "$merged_mcp_file" 2>/dev/null)
      for mcp_name in ${(f)mcp_names}; do
        [[ -z "$mcp_name" ]] && continue
        mcp_name_toml=$(jq -Rn --arg s "$mcp_name" '$s')
        mcp_url=$(jq -r --arg m "$mcp_name" '.mcpServers[$m].url // .mcpServers[$m].serverUrl // .mcpServers[$m].httpUrl // empty' "$merged_mcp_file" 2>/dev/null)
        mcp_command=$(jq -r --arg m "$mcp_name" '.mcpServers[$m].command // empty' "$merged_mcp_file" 2>/dev/null)
        # Only string elements survive: a nested object or a null has no TOML
        # equivalent, and one bad element makes codex refuse the whole config.
        mcp_args_json=$(jq -c --arg m "$mcp_name" "$(_golem_jq_strip_supabase_token_arg)"' .mcpServers // {} | strip_supabase_token_arg | .[$m].args // empty | if type == "array" then map(select(type == "string")) else empty end' "$merged_mcp_file" 2>/dev/null)
        mcp_timeout=$(jq -r --arg m "$mcp_name" '.mcpServers[$m].timeout // empty' "$merged_mcp_file" 2>/dev/null)

        print -r -- ""
        print -r -- "[mcp_servers.${mcp_name_toml}]"
        (( codex_profile_servers += 1 ))
        [[ -n "$mcp_command" ]] && print -r -- "command = $(jq -Rn --arg s "$mcp_command" '$s')"
        [[ -n "$mcp_args_json" && "$mcp_args_json" != "null" && "$mcp_args_json" != '""' ]] && print -r -- "args = ${mcp_args_json}"
        [[ -n "$mcp_url" ]] && print -r -- "url = $(jq -Rn --arg s "$mcp_url" '$s')"
        # A bare non-numeric timeout ("30s") renders `timeout = 30s`, which is
        # not valid TOML and aborts the launch — quote anything non-integer.
        if [[ -n "$mcp_timeout" && "$mcp_timeout" != "null" ]]; then
          if [[ "$mcp_timeout" == (-|)<-> ]]; then
            print -r -- "timeout = ${mcp_timeout}"
          else
            print -r -- "timeout = $(jq -Rn --arg s "$mcp_timeout" '$s')"
          fi
        fi

        # env handling depends on transport:
        # - stdio transport (command-based): written into the 0600 profile file
        # - streamable_http transport: Codex rejects `env` in config; instead it
        #   reads bearer tokens from process env at runtime via bearer_token_env_var.
        #   So we must EXPORT the env vars into the current shell before launching codex.
        # One compact JSON object per entry: a KEY=VALUE line would split a
        # multi-line value (a PEM key, a wrapped token) at its first newline,
        # silently truncating the secret and emitting the remainder as a bogus
        # TOML key.
        mcp_env_lines=$(jq -c --arg m "$mcp_name" '.mcpServers[$m].env // {} | to_entries[] | {k: .key, v: (.value | tostring)}' "$merged_mcp_file" 2>/dev/null)
        wrote_env_table=false
        for env_json in ${(f)mcp_env_lines}; do
          [[ -z "$env_json" ]] && continue
          env_key=$(print -r -- "$env_json" | jq -r '.k' 2>/dev/null)
          env_value=$(print -r -- "$env_json" | jq -r '.v' 2>/dev/null)
          [[ -z "$env_key" ]] && continue
          if [[ -z "$mcp_url" ]]; then
            if [[ "$wrote_env_table" == false ]]; then
              print -r -- "[mcp_servers.${mcp_name_toml}.env]"
              wrote_env_table=true
            fi
            print -r -- "$(jq -Rn --arg s "$env_key" '$s') = $(jq -Rn --arg s "$env_value" '$s')"
          else
            # HTTP transport — Codex rejects `env` for HTTP servers and reads
            # bearer tokens from the process environment instead. Collect here,
            # export AFTER the group: exporting inside it can make zsh echo the
            # assignment straight into the rendered TOML.
            codex_http_env+=("${env_key}=${env_value}")
          fi
        done
      done
    } > "$codex_profile_tmp" 2>/dev/null

    local http_env_entry
    for http_env_entry in "${codex_http_env[@]}"; do
      local -x "${http_env_entry}"
    done

    if (( codex_profile_servers == 0 )); then
      # No servers for this launch — drop any profile left by an earlier one so
      # a removed server never lingers in a later session.
      rm -f "$codex_profile_tmp" "$codex_profile_file"
    elif command -v python3 >/dev/null 2>&1 && \
         ! python3 -c 'import sys, tomllib; tomllib.load(open(sys.argv[1], "rb"))' "$codex_profile_tmp" 2>/dev/null; then
      # Never publish a config codex will reject: it aborts the launch with an
      # error pointing at a generated file rather than at the real cause.
      rm -f "$codex_profile_tmp"
      print -u2 -- "repoGolem: rendered Codex MCP profile for '${project_name}' is not valid TOML; launching without project MCP servers."
    elif mv -f "$codex_profile_tmp" "$codex_profile_file" 2>/dev/null; then
      chmod 600 "$codex_profile_file" 2>/dev/null
      codex_config_args+=("--profile" "$codex_profile")
      codex_profile_published=true
    else
      rm -f "$codex_profile_tmp"
      print -u2 -- "repoGolem: could not write ${codex_profile_file}; launching Codex without project MCP servers."
    fi
  else
    print -u2 -- "repoGolem: could not stage a Codex MCP profile in ${codex_home}; launching Codex without project MCP servers."
  fi

  rm -f "$merged_mcp_file"

  local codex_exit=0
  if [[ "$explicit_resume" == true ]]; then
    local -a explicit_resume_args=("${codex_args[@]}")
    [[ -n "$resume_prefix_flag" ]] && explicit_resume_args+=("$resume_prefix_flag")
    explicit_resume_args+=("${codex_config_args[@]}")
    [[ -n "$model" ]] && explicit_resume_args+=("--model" "$model")
    "${_golem_agent_prefix[@]}" codex "${explicit_resume_args[@]}"
    codex_exit=$?
  elif $_flag_headless && [[ -n "$_flag_headless_prompt" ]]; then
    local exec_prompt="$_flag_headless_prompt"
    if [[ "$worker_mode" == true ]]; then
      exec_prompt=$(_golem_build_worker_prompt "$project_name" "$project_path" "$_flag_headless_prompt")
    elif [[ -n "$agent_prompt" ]]; then
      exec_prompt=$(_golem_build_agent_prompt "$agent_context_file" "$_flag_headless_prompt")
    fi
    "${_golem_agent_prefix[@]}" codex exec "${codex_config_args[@]}" "${codex_args[@]}" "$exec_prompt"
    codex_exit=$?
  elif $_flag_continue; then
    local continue_prompt="${_flag_headless_prompt:-$positional_prompt}"
    if [[ -n "$continue_prompt" ]]; then
      if [[ "$worker_mode" == true ]]; then
        continue_prompt=$(_golem_build_worker_prompt "$project_name" "$project_path" "$continue_prompt")
      elif [[ -n "$agent_prompt" ]]; then
        continue_prompt=$(_golem_build_agent_prompt "$agent_context_file" "$continue_prompt")
      fi
      "${_golem_agent_prefix[@]}" codex resume --last "${codex_config_args[@]}" "${codex_args[@]}" "$continue_prompt"
    else
      "${_golem_agent_prefix[@]}" codex resume --last "${codex_config_args[@]}" "${codex_args[@]}"
    fi
    codex_exit=$?
  else
    if [[ -n "$agent_prompt" && ( "$has_raw_option" == false || "$worker_mode" == true ) ]]; then
      local launch_prompt="$agent_prompt"
      if [[ -n "$positional_prompt" ]]; then
        if [[ "$worker_mode" == true ]]; then
          launch_prompt=$(_golem_build_worker_prompt "$project_name" "$project_path" "$positional_prompt")
        else
          launch_prompt=$(_golem_build_agent_prompt "$agent_context_file" "$positional_prompt")
        fi
      fi
      "${_golem_agent_prefix[@]}" codex "${codex_config_args[@]}" "${codex_args[@]}" "$launch_prompt"
    else
      "${_golem_agent_prefix[@]}" codex "${codex_config_args[@]}" "${codex_args[@]}"
    fi
    codex_exit=$?
  fi

  # The profile holds live MCP secrets and codex only needs it while starting
  # up. The process has exited, so take it back off disk rather than leaving a
  # credential file behind for every project, forever.
  [[ "$codex_profile_published" == true ]] && rm -f "$codex_profile_file"

  _golem_cleanup_agent_context "$agent_context_file"
  _golem_reset_title
  return "$codex_exit"
}

# ── Cursor launcher ───────────────────────────────────────────────

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
  _golem_setup_env "$project_name"
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
