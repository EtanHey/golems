# ═══════════════════════════════════════════════════════════════════
# GOLEM DISPATCH — R78 shell optimization
# Replaces 189 eval'd functions with thin wrappers + one dispatch.
# Startup cost: ~1ms (registering names) vs ~2min (eval'ing bodies)
# ═══════════════════════════════════════════════════════════════════

# Registry file path
: ${RALPH_REGISTRY_FILE:="$HOME/.config/ralphtools/registry.json"}

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

_golem_dispatch() {
  local project_name="$1"
  local cli_name="$2"
  shift 2

  # Read project config from registry at call time (not startup)
  local registry="$RALPH_REGISTRY_FILE"
  if [[ ! -f "$registry" ]]; then
    echo "Registry not found: $registry" >&2
    return 1
  fi

  local project_path
  project_path=$(jq -r --arg p "$project_name" '.projects[$p].path // ""' "$registry" 2>/dev/null)
  project_path="${project_path/#\~/$HOME}"

  if [[ -z "$project_path" ]]; then
    echo "Unknown project: $project_name" >&2
    return 1
  fi

  if [[ ! -d "$project_path" ]]; then
    echo "Project path not found: $project_path" >&2
    return 1
  fi

  # Route to the correct CLI launcher
  case "$cli_name" in
    claude)  _golem_launch_claude  "$project_name" "$project_path" "$@" ;;
    codex)   _golem_launch_codex   "$project_name" "$project_path" "$@" ;;
    codex-worker) _golem_launch_codex_worker "$project_name" "$project_path" "$@" ;;
    cursor)  _golem_launch_cursor  "$project_name" "$project_path" "$@" ;;
    gemini)  _golem_launch_gemini  "$project_name" "$project_path" "$@" ;;
    kiro)    _golem_launch_kiro    "$project_name" "$project_path" "$@" ;;
    run)     _golem_launch_run     "$project_name" "$project_path" "$@" ;;
    open)    cd "$project_path" && echo "Changed to: $(pwd)" ;;
    *)       echo "Unknown CLI: $cli_name (use: claude, codex, cursor, gemini, kiro, run, open)" >&2; return 1 ;;
  esac
}

# ── Shared helpers ────────────────────────────────────────────────

_golem_setup_title() {
  local project_name="$1" func_name="$2"
  local _title
  if typeset -f _repogolem_build_title >/dev/null 2>&1; then
    _title=$(_repogolem_build_title "$project_name" "$func_name")
  else
    _title="$func_name"
  fi
  [[ -t 1 ]] && echo -ne "\e]2;${_title}\a"
  local _guardian_bg="$HOME/.config/ralphtools/guardian-bg.png"
  if [[ -t 1 && -e /dev/tty ]]; then
    (
      /Applications/iTerm.app/Contents/Resources/it2profile -s Golems 2>/dev/null
      printf "\e]1337;SetBadgeFormat=%s\a" "$(echo -n "${_title}" | base64)" > /dev/tty
      [[ -f "${_guardian_bg}" ]] && printf "\e]1337;SetBackgroundImageFile=%s\a" "$(echo -n "${_guardian_bg}" | base64)" > /dev/tty
    ) &
  fi
  echo "${_title}"
  echo ""
}

_golem_setup_env() {
  local project_name="$1"
  # Lazy-load ralph libs on first launcher call (not shell startup)
  typeset -f _ralph_load_libs >/dev/null 2>&1 && _ralph_load_libs
  source "$HOME/.config/ralphtools/lib/ralph-secrets.zsh" 2>/dev/null

  # Get MCPs from registry
  local mcps_json
  mcps_json=$(jq -c --arg p "$project_name" '.projects[$p].mcps // []' "$RALPH_REGISTRY_FILE" 2>/dev/null)
  [[ "$mcps_json" == "null" ]] && mcps_json="[]"

  if typeset -f _ralph_setup_mcps >/dev/null 2>&1; then
    _ralph_setup_mcps "$mcps_json" "$project_name"
  fi
  if typeset -f _ralph_setup_secrets >/dev/null 2>&1; then
    _ralph_setup_secrets "$project_name"
  fi

  # Caller launch functions set CLI env with `local -x` so child processes
  # inherit it without leaking these vars into the user's shell after exit.
}

_golem_reset_title() {
  echo -ne "\e]2;Terminal\a"
}

_golem_copy_mcp_to_worktree() {
  local repo_root="$1" worktree_dir="$2"
  [[ -z "$repo_root" || -z "$worktree_dir" ]] && return 0

  local source_mcp="${repo_root}/.mcp.json"
  local target_mcp="${worktree_dir}/.mcp.json"
  [[ -f "$source_mcp" ]] || return 0
  # First-copy-wins by design: never clobber a worktree's own .mcp.json
  # (it may be a symlink or a deliberately customized per-worktree config).
  # Worktrees are ephemeral, so a stale copy is refreshed by recreating the
  # worktree, not by overwriting on every launch (which would nuke local edits).
  [[ -e "$target_mcp" || -L "$target_mcp" ]] && return 0

  cp "$source_mcp" "$target_mcp" || return 1
  echo "[repogolem] copied .mcp.json into worktree" >&2
}

# ── Launch staging directory ──────────────────────────────────────
# Short-lived launch files (persona context, agy MCP merges, notify config)
# stage HERE, never in a shared /tmp. Two reasons:
#   1. The fleet's TMP-BLOCK guard (skills/golem-powers/tmp-block) denies agents
#      every /tmp write, fail-closed. A launcher that staged through /tmp could
#      not be driven by an agent at all — backlog #24's ruling is that the
#      LAUNCHER moves and the guard stays fail-closed.
#   2. These files carry MCP config and per-seat context. /tmp is shared and
#      world-readable; this dir is 0700 and the files inside it are 0600.
# Cleanup is the same two-layer shape the Codex profile staging already uses
# below: every call site removes its own file on the way out, and each launch
# reaps entries an interrupted earlier launch orphaned. The 24h guard keeps the
# reaper off a concurrent launch's live files.
# (A `trap`-based sweep cannot replace the reaper here: this file is sourced
# into the user's interactive shell, so a trap set outside `localtraps` would
# outlive the launch and fire on the shell itself.)
_golem_staging_dir() {
  local project_name="${1:-project}"
  local safe="${project_name//[^A-Za-z0-9_-]/-}"
  [[ -z "$safe" ]] && safe="project"

  local base
  if [[ -n "${XDG_RUNTIME_DIR:-}" ]]; then
    base="${XDG_RUNTIME_DIR}/repogolem"
  else
    base="${HOME}/.cache/repogolem"
  fi

  local dir="${base}/${safe}"
  mkdir -p "$dir" 2>/dev/null || return 1
  chmod 700 "$base" "$dir" 2>/dev/null
  # (no (#cN) here: that needs EXTENDED_GLOB, which this file does not set)
  rm -f "$dir"/*(N.mh+24) 2>/dev/null

  print -r -- "$dir"
}

_golem_inject_agent_context() {
  # Personas are a LEAD affordance. A worker seat gets its brief, not a boot ritual.
  # Gates all four CLIs (codex/cursor/gemini/kiro) at the single shared injection point;
  # _golem_launch_codex's own worker_mode check remains as belt-and-braces.
  [[ "${GOLEM_ROLE:-}" == "worker" ]] && return 0
  local project_name="$1" cli_name="$2"
  local registry="$RALPH_REGISTRY_FILE"
  [[ ! -f "$registry" ]] && return 0

  local agent_name
  agent_name=$(jq -r --arg p "$project_name" '.projects[$p].agent // ""' "$registry" 2>/dev/null)
  [[ -z "$agent_name" || "$agent_name" == "null" ]] && return 0

  local agent_file="$HOME/.claude/agents/${agent_name}.md"
  [[ ! -f "$agent_file" ]] && return 0

  local safe_project_name="${project_name//[^a-zA-Z0-9_-]/}"
  [[ -z "$safe_project_name" ]] && safe_project_name="project"

  local staging_dir
  staging_dir=$(_golem_staging_dir "$project_name") || return 0

  local context_file
  context_file=$(umask 077; mktemp "${staging_dir}/repogolem-${cli_name}-${safe_project_name}-agent.XXXXXX") || return 0
  chmod 600 "$context_file" 2>/dev/null
  if ! awk '
    NR == 1 && $0 == "---" { in_frontmatter = 1; next }
    in_frontmatter && $0 == "---" {
      in_frontmatter = 0
      if (initial_prompt != "") {
        print "## Initial prompt from agent frontmatter"
        printf "%s", initial_prompt
        print ""
      }
      next
    }
    in_frontmatter {
      if ($0 ~ /^initialPrompt:[[:space:]]*\|[[:space:]]*$/) {
        capture_initial = 1
        next
      }
      if (capture_initial && $0 ~ /^[A-Za-z_][A-Za-z0-9_-]*:/) {
        capture_initial = 0
      }
      if (capture_initial) {
        line = $0
        sub(/^  /, "", line)
        initial_prompt = initial_prompt line "\n"
      }
      next
    }
    !in_frontmatter { print }
  ' "$agent_file" > "$context_file"; then
    rm -f "$context_file" 2>/dev/null
    return 0
  fi

  print -r -- "$context_file"
}

_golem_build_agent_prompt() {
  local context_file="$1" user_prompt="${2:-}"
  [[ ! -f "$context_file" ]] && return 1

  local context_body
  context_body=$(<"$context_file")
  local ambiguity_gate
  ambiguity_gate='## BrainLayer-first ambiguity gate

For ambiguous proper nouns, named people, private voices, repo-local entities, projects, and artifacts:
1. Search or use BrainLayer/user/project context before public web or popularity inference.
2. If the task depends on a named person, voice, or private entity and BrainLayer is unavailable, stop with BLOCKED_BRAINLAYER_UNAVAILABLE instead of guessing.
3. If the prompt mentions only `Theo` in a private voice/person task, resolve from BrainLayer context as Theo Brown / T3.gg / existing Theo voice artifacts unless verified context says otherwise.'

  if [[ -n "$user_prompt" ]]; then
    print -r -- "Adopt the following launcher agent context for this session. Treat it as the active agent protocol for this non-Claude CLI.

<agent_context>
${context_body}
</agent_context>

${ambiguity_gate}

User prompt:
${user_prompt}"
  else
    print -r -- "Adopt the following launcher agent context for this session. Treat it as the active agent protocol for this non-Claude CLI.

<agent_context>
${context_body}
</agent_context>

${ambiguity_gate}"
  fi
}

_golem_build_worker_prompt() {
  local user_prompt="${3:-}"
  [[ -n "$user_prompt" ]] && print -r -- "$user_prompt"
  return 0
}

_golem_cleanup_agent_context() {
  local context_file="${1:-}"
  [[ -n "$context_file" && -f "$context_file" ]] && rm -f "$context_file" 2>/dev/null
}

_golem_agy_resolve_model() {
  # Map short aliases to exact agy model strings; empty means default.
  case "${1:-}" in
    ""|pro|pro-high)             print -r -- "Gemini 3.1 Pro (High)" ;;
    pro-low)                     print -r -- "Gemini 3.1 Pro (Low)" ;;
    flash|flash-high)            print -r -- "Gemini 3.5 Flash (High)" ;;
    flash-med|flash-medium)      print -r -- "Gemini 3.5 Flash (Medium)" ;;
    flash-low)                   print -r -- "Gemini 3.5 Flash (Low)" ;;
    opus)                        print -r -- "Claude Opus 4.6 (Thinking)" ;;
    sonnet)                      print -r -- "Claude Sonnet 4.6 (Thinking)" ;;
    oss|gpt-oss|gpt-oss-120b)    print -r -- "GPT-OSS 120B (Medium)" ;;
    *)                           print -r -- "$1" ;;
  esac
}

_golem_sync_agy_workspace() {
  local project_name="$1" project_path="$2"
  local merged='{"mcpServers":{}}'

  if typeset -f _ralph_build_mcp_config >/dev/null 2>&1; then
    local built
    built=$(_ralph_build_mcp_config "$project_name" 2>/dev/null)
    [[ -n "$built" && "$built" != "null" ]] && merged="$built"
  fi

  local staging_dir
  staging_dir=$(_golem_staging_dir "$project_name") || return 1

  local merged_file
  merged_file=$(umask 077; mktemp "${staging_dir}/repogolem-agy-${project_name}.XXXXXX.json") || return 1
  print -r -- "$merged" > "$merged_file"

  if [[ -f "${project_path}/.mcp.json" ]]; then
    local merge_file
    merge_file=$(umask 077; mktemp "${staging_dir}/repogolem-agy-${project_name}.merge.XXXXXX.json") || {
      rm -f "$merged_file"
      return 1
    }
    if jq -s 'reduce .[] as $item ({"mcpServers":{}}; .mcpServers += ($item.mcpServers // {}))' \
      "$merged_file" "${project_path}/.mcp.json" > "$merge_file" 2>/dev/null; then
      mv "$merge_file" "$merged_file"
    else
      rm -f "$merge_file"
    fi
  fi

  local servers
  servers=$(jq -c '.mcpServers // {}' "$merged_file" 2>/dev/null)
  [[ -z "$servers" || "$servers" == "null" ]] && servers='{}'
  servers=$(print -r -- "$servers" | jq -c '
    if (.supabase? | type) == "object" then
      (if (.supabase.args? | type) == "array" then
        .supabase.args as $args
        | .supabase.args = [
          range(0; ($args | length)) as $i
          | select($args[$i] != "--access-token")
          | select(($i == 0) or ($args[$i - 1] != "--access-token"))
          | $args[$i]
        ]
      else
        .
      end)
      | if (.supabase.env? | type) == "object" then
        .supabase.env |= del(.SUPABASE_ACCESS_TOKEN)
      else
        .
      end
    else
      .
    end
    | with_entries(
        .value |= (
          if type == "object" then
            (if ((.serverUrl // "") == "") and ((.url // .httpUrl // "") != "") then
              .serverUrl = (.url // .httpUrl)
            else
              .
            end)
            | del(.url, .httpUrl)
          else
            .
          end
        )
      )
  ' 2>/dev/null)
  [[ -z "$servers" || "$servers" == "null" ]] && servers='{}'

  local agents_dir="${project_path}/.agents"
  local agents_file="${agents_dir}/mcp_config.json"
  local existing='{"mcpServers":{}}'
  local tmp_file
  mkdir -p "$agents_dir"
  [[ -s "$agents_file" ]] && existing=$(<"$agents_file")
  if ! print -r -- "$existing" | jq -e 'type == "object"' >/dev/null 2>&1; then
    existing='{"mcpServers":{}}'
  fi
  tmp_file=$(umask 077; mktemp "${staging_dir}/repogolem-agy-${project_name}.agents.XXXXXX.json") || {
    rm -f "$merged_file"
    return 1
  }
  if print -r -- "$existing" | jq --argjson servers "$servers" \
    '.mcpServers = ((.mcpServers // {}) + $servers)' > "$tmp_file" 2>/dev/null; then
    mv "$tmp_file" "$agents_file"
  else
    rm -f "$tmp_file"
  fi

  local user_dir="$HOME/.gemini/config"
  local user_file="${user_dir}/mcp_config.json"
  local user_existing='{"mcpServers":{}}'
  local user_tmp
  mkdir -p "$user_dir"
  [[ -s "$user_file" ]] && user_existing=$(<"$user_file")
  if ! print -r -- "$user_existing" | jq -e 'type == "object"' >/dev/null 2>&1; then
    user_existing='{"mcpServers":{}}'
  fi
  user_tmp=$(umask 077; mktemp "${staging_dir}/repogolem-agy-${project_name}.user.XXXXXX.json") || {
    rm -f "$merged_file"
    return 1
  }
  if print -r -- "$user_existing" | jq --argjson servers "$servers" \
    '.mcpServers = ((.mcpServers // {}) + $servers)' > "$user_tmp" 2>/dev/null; then
    mv "$user_tmp" "$user_file"
  else
    rm -f "$user_tmp"
  fi

  rm -f "$merged_file"
}

_golem_parse_unified_flags() {
  # Parse the unified -s/-c/-m/-p/-u/--web flags shared across CLIs.
  # Sets variables in the CALLER's scope (no subshell).
  local -a _parsed_args=()
  _flag_skip=false
  _flag_continue=false
  _flag_update=false
  _flag_web=false
  _flag_headless=false
  _flag_model=""
  _flag_effort=""
  _flag_sonnet=false
  _flag_headless_prompt=""
  _flag_notify_mode=""
  _flag_worktree=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      -s|--skip-permissions) _flag_skip=true; shift ;;
      -c|--continue) _flag_continue=true; shift ;;
      -u|--update) _flag_update=true; shift ;;
      --web) _flag_web=true; shift ;;
      -m|--model)
        if [[ -z "${2:-}" || "${2:-}" == -* ]]; then
          echo "Error: $1 requires a model name" >&2
          return 2
        fi
        _flag_model="$2"; shift 2 ;;
      -S|--sonnet) _flag_sonnet=true; shift ;;
      -E|--effort)
        if [[ -z "${2:-}" ]]; then
          print -u2 -r -- "repoGolem: --effort requires a value (low|medium|high|xhigh|max)"; return 2
        fi
        _flag_effort="$2"; shift 2 ;;
      -p|--print)
        _flag_headless=true
        if [[ -n "$2" && "$2" != -* ]]; then _flag_headless_prompt="$2"; shift; fi
        shift ;;
      -w|--worktree)
        if [[ -n "$2" && "$2" != -* ]]; then _flag_worktree="${2/#\~/$HOME}"; shift 2
        else echo "Error: $1 requires a path" >&2; return 2; fi ;;
      -QN|--quiet-notify) _flag_notify_mode="quiet"; shift ;;
      -SN|--simple-notify) _flag_notify_mode="simple"; shift ;;
      -VN|--verbose-notify) _flag_notify_mode="verbose"; shift ;;
      *) _parsed_args+=("$1"); shift ;;
    esac
  done
  _extra_args=("${_parsed_args[@]}")
}

_golem_print_codex_help() {
  print -r -- "Codex launcher options:"
  print -r -- "  -E, --effort <value>   low, medium, high, xhigh, max, ultra"
  print -r -- "                         default: Codex high; Claude -E > GOLEM_EFFORT > worker medium > high"
  print -r -- "                         set it per dispatch — lower for scoped jobs; the default is a ceiling"
  print -r -- "  -m, --model <name>     explicit model override"
  print -r -- "  -s, --skip-permissions compatibility no-op (has no effect)"
  print -r -- "  -c, --continue         resume the last session"
  print -r -- "  -p, --print [prompt]   run a headless one-shot"
  print -r -- "  -w, --worktree <existing path>  launch from a pre-created worktree"
  print -r -- "      --worker          launch plain Codex without registry persona context"
  print -r -- "  -h, --help             show this help"
}

_golem_parse_codex_flags() {
  local -a _parsed_args=()
  _flag_codex_effort="high"
  _flag_codex_effort_explicit=false
  _flag_codex_help=false
  _flag_codex_worker=false
  _codex_passthrough_args=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --) shift; _codex_passthrough_args=("$@"); break ;;
      -E|--effort)
        local effort_flag="$1"
        if [[ -z "${2:-}" || "${2:-}" == -* ]]; then
          echo "Error: ${effort_flag} requires one of: low, medium, high, xhigh, max, ultra" >&2
          return 2
        fi
        case "$2" in
          low|medium|high|xhigh|max|ultra)
            _flag_codex_effort="$2"
            _flag_codex_effort_explicit=true ;;
          *)
            echo "Error: Invalid Codex effort: $2 (expected: low, medium, high, xhigh, max, ultra)" >&2
            return 2 ;;
        esac
        shift 2 ;;
      --worker) _flag_codex_worker=true; shift ;;
      -h|--help) _flag_codex_help=true; shift ;;
      *) _parsed_args+=("$1"); shift ;;
    esac
  done
  _codex_extra_args=("${_parsed_args[@]}")
}

_golem_refuse_agent_model_override() {
  local launcher_name="$1"
  [[ -z "$_flag_model" ]] && return 0
  $_flag_headless && return 0
  [[ "${REPOGOLEM_ALLOW_MODEL:-}" == "1" ]] && return 0

  echo "Error: ${launcher_name} refuses -m/--model for agent sessions." >&2
  echo "repoGolem bare-launcher law: use the bare launcher so the Opus 1M pin is preserved." >&2
  echo "For scripted non-agent one-shots, use -p; for explicit automation overrides, set REPOGOLEM_ALLOW_MODEL=1." >&2
  return 2
}

_golem_refuse_claude_sonnet_full_pane() {
  $_flag_headless && return 0

  local model="$_flag_model"
  $_flag_sonnet && model="sonnet"
  [[ "${(L)model}" != *sonnet* ]] && return 0

  echo "Error: Claude launchers refuse Sonnet-tier models for full panes." >&2
  echo "Use Opus for full panes; Sonnet remains available for headless/subagent work." >&2
  return 2
}

_golem_claude_resolve_model() {
  # Map short Claude aliases to exact model strings; unknown names pass through verbatim.
  # `fable` tracks the CURRENT Fable release (not a frozen id): bump the target on each
  # Fable release so `-m fable` stays a one-flag boot. Fable is per-invocation only
  # (canon rule 5) - the default pin below stays on Opus.
  case "${1:-}" in
    fable|fable-5.1) print -r -- "claude-fable-5-1[1m]" ;;
    *)               print -r -- "$1" ;;
  esac
}

# ── Claude launcher ───────────────────────────────────────────────

_golem_launch_claude() {
  local project_name="$1" project_path="$2"; shift 2
  local -x MCP_CONNECTION_NONBLOCKING=1
  local -x CLAUDE_CODE_NO_FLICKER=1
  local capitalized_name="${(C)project_name[1]}${project_name[2,-1]}"
  local ntfy_topic="etans-${project_name}Claude"

  _golem_parse_unified_flags "$@" || return $?
  _golem_refuse_claude_sonnet_full_pane || return $?
  local claude_args=("${_extra_args[@]}")

  if [[ -n "$_flag_worktree" ]]; then
    _golem_copy_mcp_to_worktree "$project_path" "$_flag_worktree" || return $?
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
  #   default     claude-opus-5[1m]
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
    _claude_model="claude-opus-5[1m]"
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
      _repoclaude_web_mode "$project_name" "${project_name}Claude" "$_ttyd_port" "${claude_args[@]}"
      claude_exit=$?
    else
      echo "Web mode not configured for $project_name"
      claude_exit=1
    fi
  else
    claude "${claude_args[@]}"
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
    model="gpt-5.6-sol"
  fi
  local worker_mode="${_golem_codex_worker_mode:-false}"
  $_flag_codex_worker && worker_mode=true
  [[ "${GOLEM_ROLE:-}" == "worker" ]] && worker_mode=true
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
  merged_mcp_file=$(umask 077; mktemp "${codex_home}/.repogolem-codex-${codex_profile}.XXXXXX.json") || { _golem_cleanup_agent_context "$agent_context_file"; return 1; }
  chmod 600 "$merged_mcp_file" 2>/dev/null
  print -r -- "$merged_mcp_json" > "$merged_mcp_file"

  if [[ -f ".mcp.json" ]]; then
    local _tmp_merge
    _tmp_merge=$(umask 077; mktemp "${codex_home}/.repogolem-codex-${codex_profile}.merge.XXXXXX.json") || { rm -f "$merged_mcp_file"; _golem_cleanup_agent_context "$agent_context_file"; return 1; }
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
  elif codex_profile_tmp=$(umask 077; mktemp "${codex_home}/.${codex_profile}.XXXXXX.toml" 2>/dev/null); then
    chmod 600 "$codex_profile_tmp" 2>/dev/null
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
        mcp_args_json=$(jq -c --arg m "$mcp_name" '.mcpServers[$m].args // empty | if type == "array" then map(select(type == "string")) else empty end' "$merged_mcp_file" 2>/dev/null)
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
    codex "${explicit_resume_args[@]}"
    codex_exit=$?
  elif $_flag_headless && [[ -n "$_flag_headless_prompt" ]]; then
    local exec_prompt="$_flag_headless_prompt"
    if [[ "$worker_mode" == true ]]; then
      exec_prompt=$(_golem_build_worker_prompt "$project_name" "$project_path" "$_flag_headless_prompt")
    elif [[ -n "$agent_prompt" ]]; then
      exec_prompt=$(_golem_build_agent_prompt "$agent_context_file" "$_flag_headless_prompt")
    fi
    codex exec "${codex_config_args[@]}" "${codex_args[@]}" "$exec_prompt"
    codex_exit=$?
  elif $_flag_continue; then
    local continue_prompt="${_flag_headless_prompt:-$positional_prompt}"
    if [[ -n "$continue_prompt" ]]; then
      if [[ "$worker_mode" == true ]]; then
        continue_prompt=$(_golem_build_worker_prompt "$project_name" "$project_path" "$continue_prompt")
      elif [[ -n "$agent_prompt" ]]; then
        continue_prompt=$(_golem_build_agent_prompt "$agent_context_file" "$continue_prompt")
      fi
      codex resume --last "${codex_config_args[@]}" "${codex_args[@]}" "$continue_prompt"
    else
      codex resume --last "${codex_config_args[@]}" "${codex_args[@]}"
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
      codex "${codex_config_args[@]}" "${codex_args[@]}" "$launch_prompt"
    else
      codex "${codex_config_args[@]}" "${codex_args[@]}"
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

  cd "${_flag_worktree:-$project_path}" || return 1
  _golem_setup_title "$project_name" "${project_name}Cursor"
  _golem_setup_env "$project_name"
  agent_context_file=$(_golem_inject_agent_context "$project_name" "cursor")
  [[ -n "$agent_context_file" ]] && agent_prompt=$(_golem_build_agent_prompt "$agent_context_file")

  $_flag_skip && cursor_args=("--yolo" "--approve-mcps" "${cursor_args[@]}")
  [[ -n "$_flag_model" ]] && cursor_args=("--model" "$_flag_model" "${cursor_args[@]}")

  local cursor_exit=0
  if $_flag_headless && [[ -n "$_flag_headless_prompt" ]]; then
    local exec_prompt="$_flag_headless_prompt"
    [[ -n "$agent_prompt" ]] && exec_prompt=$(_golem_build_agent_prompt "$agent_context_file" "$_flag_headless_prompt")
    cursor agent "${cursor_args[@]}" --print --output-format text "$exec_prompt"
    cursor_exit=$?
  elif $_flag_continue; then
    local continue_prompt="${_flag_headless_prompt:-$positional_prompt}"
    if [[ -n "$continue_prompt" ]]; then
      [[ -n "$agent_prompt" ]] && continue_prompt=$(_golem_build_agent_prompt "$agent_context_file" "$continue_prompt")
      cursor agent --continue "${cursor_args[@]}" "$continue_prompt"
    else
      cursor agent --continue "${cursor_args[@]}"
    fi
    cursor_exit=$?
  else
    if [[ -n "$agent_prompt" && "$has_raw_option" == false ]]; then
      local launch_prompt="$agent_prompt"
      if [[ -n "$positional_prompt" ]]; then
        launch_prompt=$(_golem_build_agent_prompt "$agent_context_file" "$positional_prompt")
      fi
      cursor agent "${cursor_args[@]}" "$launch_prompt"
    else
      cursor agent "${cursor_args[@]}"
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

  local launch_dir="${_flag_worktree:-$project_path}"
  cd "$launch_dir" || return 1
  _golem_setup_title "$project_name" "${project_name}Gemini"
  _golem_setup_env "$project_name"
  _golem_sync_agy_workspace "$project_name" "$launch_dir"
  agent_context_file=$(_golem_inject_agent_context "$project_name" "gemini")
  [[ -n "$agent_context_file" ]] && agent_prompt=$(_golem_build_agent_prompt "$agent_context_file")

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
    "$agy_bin" "${agy_args[@]}" --print "$exec_prompt"
    agy_exit=$?
  elif $_flag_continue; then
    if [[ -n "$positional_prompt" ]]; then
      local continue_prompt="$positional_prompt"
      [[ -n "$agent_prompt" ]] && continue_prompt=$(_golem_build_agent_prompt "$agent_context_file" "$positional_prompt")
      "$agy_bin" "${agy_args[@]}" --prompt-interactive "$continue_prompt"
    elif [[ -n "$agent_prompt" ]]; then
      "$agy_bin" "${agy_args[@]}" --prompt-interactive "$agent_prompt"
    else
      "$agy_bin" "${agy_args[@]}"
    fi
    agy_exit=$?
  else
    if [[ -n "$agent_prompt" && "$has_raw_option" == false ]]; then
      local launch_prompt="$agent_prompt"
      if [[ -n "$positional_prompt" ]]; then
        launch_prompt=$(_golem_build_agent_prompt "$agent_context_file" "$positional_prompt")
      fi
      "$agy_bin" "${agy_args[@]}" --prompt-interactive "$launch_prompt"
    elif [[ -n "$positional_prompt" ]]; then
      "$agy_bin" "${agy_args[@]}" --prompt-interactive "$positional_prompt"
    else
      "$agy_bin" "${agy_args[@]}"
    fi
    agy_exit=$?
  fi

  _golem_cleanup_agent_context "$agent_context_file"
  _golem_reset_title
  return "$agy_exit"
}

# ── Kiro launcher ─────────────────────────────────────────────────

_golem_launch_kiro() {
  local project_name="$1" project_path="$2"; shift 2
  local -x MCP_CONNECTION_NONBLOCKING=1
  local -x CLAUDE_CODE_NO_FLICKER=1

  _golem_parse_unified_flags "$@" || return $?
  local kiro_args=("${_extra_args[@]}")
  local agent_context_file=""
  local agent_prompt=""
  local has_raw_option=false
  local arg
  for arg in "${kiro_args[@]}"; do
    [[ "$arg" == -* ]] && has_raw_option=true
  done
  local positional_prompt=""
  if [[ "$has_raw_option" == false && ${#kiro_args[@]} -gt 0 ]]; then
    positional_prompt="${(j: :)kiro_args}"
    kiro_args=()
  fi

  cd "${_flag_worktree:-$project_path}" || return 1
  _golem_setup_title "$project_name" "${project_name}Kiro"
  _golem_setup_env "$project_name"
  agent_context_file=$(_golem_inject_agent_context "$project_name" "kiro")
  [[ -n "$agent_context_file" ]] && agent_prompt=$(_golem_build_agent_prompt "$agent_context_file")

  [[ -n "$_flag_model" ]] && kiro_args=("--model" "$_flag_model" "${kiro_args[@]}")
  $_flag_skip && kiro_args=("--trust-all-tools" "${kiro_args[@]}")
  $_flag_continue && kiro_args=("--resume" "${kiro_args[@]}")

  local kiro_exit=0
  if $_flag_headless && [[ -n "$_flag_headless_prompt" ]]; then
    local exec_prompt="$_flag_headless_prompt"
    [[ -n "$agent_prompt" ]] && exec_prompt=$(_golem_build_agent_prompt "$agent_context_file" "$_flag_headless_prompt")
    kiro-cli chat "${kiro_args[@]}" --no-interactive "$exec_prompt"
    kiro_exit=$?
  elif $_flag_continue; then
    local continue_prompt="${_flag_headless_prompt:-$positional_prompt}"
    if [[ -n "$continue_prompt" ]]; then
      [[ -n "$agent_prompt" ]] && continue_prompt=$(_golem_build_agent_prompt "$agent_context_file" "$continue_prompt")
      kiro-cli chat "${kiro_args[@]}" "$continue_prompt"
    else
      kiro-cli chat "${kiro_args[@]}"
    fi
    kiro_exit=$?
  else
    if [[ -n "$agent_prompt" && "$has_raw_option" == false ]]; then
      local launch_prompt="$agent_prompt"
      if [[ -n "$positional_prompt" ]]; then
        launch_prompt=$(_golem_build_agent_prompt "$agent_context_file" "$positional_prompt")
      fi
      kiro-cli chat "${kiro_args[@]}" "$launch_prompt"
    else
      kiro-cli chat "${kiro_args[@]}"
    fi
    kiro_exit=$?
  fi

  _golem_cleanup_agent_context "$agent_context_file"
  _golem_reset_title
  return "$kiro_exit"
}

# ── Run launcher (dev server) ─────────────────────────────────────

_golem_launch_run() {
  local project_name="$1" project_path="$2"; shift 2

  cd "$project_path" || return 1
  if [[ -f "package.json" ]]; then
    if [[ -f "bun.lockb" ]] || { command -v bun &>/dev/null && grep -q '"bun"' package.json 2>/dev/null; }; then
      bun run dev
    else
      npm run dev
    fi
  else
    echo "No package.json found in $project_path"
    return 1
  fi
}

# ── Register thin wrappers from registry ──────────────────────────
# Creates named functions like brainlayerClaude, brainlayerCodex, etc.
# Each wrapper is ONE LINE — no eval of function bodies.

_golem_register_wrappers() {
  local registry="${RALPH_REGISTRY_FILE:-$HOME/.config/ralphtools/registry.json}"
  [[ ! -f "$registry" ]] && return 1

  # Single jq call: emit "name|funcAlias|launcherAliasPrefix|clis|path" tuples.
  # path is appended for hyphen-aware verbatim-launcher aliases (P10).
  local entries
  entries=$(jq -r '
    .projects
    | to_entries[]
    | "\(.key)|\(.value.funcAlias // "")|\(.value.launcherAliasPrefix // "")|\((.value.clis // []) | join(","))|\(.value.path // "")"
  ' "$registry" 2>/dev/null) || return 1

  local line name alias prefix clis_csv path_field lower cap cli suffix
  for line in ${(f)entries}; do
    local -a _parts=("${(@s:|:)line}")
    name="${_parts[1]}"
    alias="${_parts[2]}"
    prefix="${_parts[3]}"
    clis_csv="${_parts[4]}"
    path_field="${_parts[5]}"
    lower="${(L)name}"
    cap="${(C)name[1]}${name[2,-1]}"

    # Thin wrappers — ONE LINE each, no function body eval
    eval "function ${lower}Claude()   { _golem_dispatch '$lower' claude  \"\$@\"; }"
    eval "function ${lower}Codex()    { _golem_dispatch '$lower' codex   \"\$@\"; }"
    eval "function ${lower}CodexWorker() { _golem_dispatch '$lower' codex-worker \"\$@\"; }"
    eval "function ${lower}Cursor()   { _golem_dispatch '$lower' cursor  \"\$@\"; }"
    eval "function ${lower}Gemini()   { _golem_dispatch '$lower' gemini  \"\$@\"; }"
    eval "function ${lower}Kiro()     { _golem_dispatch '$lower' kiro    \"\$@\"; }"
    eval "function run${cap}()        { _golem_dispatch '$lower' run     \"\$@\"; }"
    eval "function open${cap}()       { _golem_dispatch '$lower' open    \"\$@\"; }"

    # funcAlias (e.g., songClaude -> songscriptClaude)
    if [[ -n "$alias" && "$alias" != "${lower}Claude" ]]; then
      eval "function ${alias}() { _golem_dispatch '$lower' claude \"\$@\"; }"
    fi

    if [[ -n "$prefix" ]]; then
      eval "function ${prefix}() { _golem_dispatch '$lower' claude \"\$@\"; }"
      for cli in ${(s:,:)clis_csv}; do
        case "$cli" in
          claude) suffix="Claude" ;;
          codex) suffix="Codex" ;;
          gemini) suffix="Gemini" ;;
          cursor) suffix="Cursor" ;;
          kiro) suffix="Kiro" ;;
          *) suffix="" ;;
        esac
        [[ -z "$suffix" ]] && continue
        eval "function ${prefix}${suffix}() { _golem_dispatch '$lower' ${cli} \"\$@\"; }"
        [[ "$cli" == "codex" ]] && eval "function ${prefix}CodexWorker() { _golem_dispatch '$lower' codex-worker \"\$@\"; }"
      done
    fi

    # Hyphen-aware verbatim aliases (P10): when registry key strips hyphens
    # (skillcreator) but directory keeps them (skill-creator), users naturally
    # type the dir name. cmux spawn_agent also passes the dir name. Emit
    # {dir-name}{Cli} → dispatch wrappers when basename(path) (with _→-) is
    # hyphenated AND differs from the registry name. Skips when registry key
    # already matches dir (cmux-fork), when no hyphen present (golems), and
    # when the result isn't a valid zsh function name (etanheyman.com).
    if [[ -n "$path_field" ]]; then
      local _dir_name="${path_field:t}"
      local _hyphenated_dir="${_dir_name//_/-}"
      if [[ "$_hyphenated_dir" != "$lower" \
         && "$_hyphenated_dir" == *-* \
         && "$_hyphenated_dir" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]]; then
        eval "function ${_hyphenated_dir}Claude() { _golem_dispatch '$lower' claude  \"\$@\"; }"
        eval "function ${_hyphenated_dir}Codex()  { _golem_dispatch '$lower' codex   \"\$@\"; }"
        eval "function ${_hyphenated_dir}CodexWorker() { _golem_dispatch '$lower' codex-worker \"\$@\"; }"
        eval "function ${_hyphenated_dir}Cursor() { _golem_dispatch '$lower' cursor  \"\$@\"; }"
        eval "function ${_hyphenated_dir}Gemini() { _golem_dispatch '$lower' gemini  \"\$@\"; }"
        eval "function ${_hyphenated_dir}Kiro()   { _golem_dispatch '$lower' kiro    \"\$@\"; }"
      fi
    fi
  done
}

# Register all wrappers on source
_golem_register_wrappers
