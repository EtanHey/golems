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

  # Prelaunch commands are read once here; launchers call the agent through
  # "${_golem_agent_prefix[@]}" (see _golem_run_agent).
  local -a _golem_prelaunch _golem_agent_prefix
  _golem_load_prelaunch "$registry"

  # Route to the correct CLI launcher
  case "$cli_name" in
    claude)  _golem_launch_claude  "$project_name" "$project_path" "$@" ;;
    codex)   _golem_launch_codex   "$project_name" "$project_path" "$@" ;;
    codex-worker) _golem_launch_codex_worker "$project_name" "$project_path" "$@" ;;
    cursor)  _golem_launch_cursor  "$project_name" "$project_path" "$@" ;;
    gemini)  _golem_launch_gemini  "$project_name" "$project_path" "$@" ;;
    run)     _golem_launch_run     "$project_name" "$project_path" "$@" ;;
    open)    cd "$project_path" && echo "Changed to: $(pwd)" ;;
    *)       echo "Unknown CLI: $cli_name (use: claude, codex, cursor, gemini, run, open)" >&2; return 1 ;;
  esac
}

# ── Shared helpers ────────────────────────────────────────────────

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
      fi
    fi
  done
}
