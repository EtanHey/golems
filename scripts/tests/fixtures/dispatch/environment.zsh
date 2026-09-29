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

# ── Agent launch + prelaunch ──────────────────────────────────────
# AIDEV-NOTE: every agent CLI invocation is written
#   "${_golem_agent_prefix[@]}" <cli> <args...>
# registry.json's global.prelaunch (from the user's own 0600 repoGolem config,
# the same trust as a shell rc file) lists shell commands, e.g. a ulimit or an
# export, that must take effect in the agent process. _golem_dispatch decides
# once per launch:
#   - None configured (absent or []): the prefix is empty, so the agent is
#     called directly, exactly as before: no extra frame, no subshell, no
#     output. A registry that never mentions "prelaunch" costs no jq at all.
#   - Configured: the prefix is _golem_run_agent. A subshell runs the commands
#     in order, then execs the agent. Their effects reach the agent and die
#     with the subshell, so nothing leaks into the user's interactive shell.
#     exec keeps the agent a direct child of this shell, as a plain launch is,
#     so its parent, exit status and signals match. A shell-function agent
#     (tests, user wrappers) cannot be exec'd; it runs inside the subshell.
#   - Each command runs in its own anonymous function with stderr discarded,
#     so a failure (including `return N`, a missing command or a syntax error)
#     warns by index, never by text, and the launch goes on. Use `export`, not
#     `typeset`/`local`, for variables: those stay local to that function.
#   - `exit` is unsupported: containing it would need a further subshell,
#     which would drop the commands' effects. It ends the launch, and an EXIT
#     trap says which command did it, by index.
typeset -ga _golem_prelaunch=() _golem_agent_prefix=()

_golem_load_prelaunch() {
  local registry="$1" registry_text prelaunch_raw
  # A backslash then u: the only JSON escape that can spell a letter, so the
  # only way a real prelaunch key can be missing its literal "prelaunch" text.
  local json_unicode_escape=$'\x5cu'
  _golem_prelaunch=()
  _golem_agent_prefix=()
  registry_text=$(<"$registry") 2>/dev/null || return 0
  # Skip jq only when the text rules a key out. A false positive just costs
  # one jq read that finds no list; a false negative would silently drop the
  # user's prelaunch, so any unicode escape falls back to jq.
  [[ "$registry_text" == *'"prelaunch"'* || "$registry_text" == *"$json_unicode_escape"* ]] || return 0
  prelaunch_raw=$(jq -j '(.global.prelaunch // [])
    | if type == "array" then .[] | select(type == "string" and length > 0) | . + "\u0000" else empty end' \
    "$registry" 2>/dev/null) || return 0
  _golem_prelaunch=("${(@0)prelaunch_raw}")
  _golem_prelaunch=("${(@)_golem_prelaunch:#}")
  (( ${#_golem_prelaunch} )) && _golem_agent_prefix=(_golem_run_agent)
  return 0
}

_golem_run_agent() {
  (
    setopt posix_traps
    _golem_prelaunch_index=0
    exec {_golem_prelaunch_stderr}>&2
    trap '(( _golem_prelaunch_index )) && print -u "$_golem_prelaunch_stderr" -r -- "repoGolem: prelaunch command ${_golem_prelaunch_index} called exit; the agent was not launched"' EXIT
    local prelaunch_command
    for prelaunch_command in "${_golem_prelaunch[@]}"; do
      (( _golem_prelaunch_index += 1 ))
      () { eval "$1" } "$prelaunch_command" 2>/dev/null \
        || print -u2 -r -- "repoGolem: prelaunch command ${_golem_prelaunch_index} failed (exit $?); launching anyway"
    done
    _golem_prelaunch_index=0
    trap - EXIT
    exec {_golem_prelaunch_stderr}>&-
    [[ "$(builtin whence -w -- "$1")" == *": command" ]] && exec "$@"
    "$@"
  )
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

# -w worktrees get their own dependencies before an agent starts in them
# (never a node_modules symlink into the main checkout). A failed install is
# reported and the launch continues: the agent sees the warning, and a missing
# dependency then fails loudly in the worktree itself.
_golem_bootstrap_worktree() {
  local worktree_dir="$1"
  [[ -z "$worktree_dir" ]] && return 0
  local bootstrap="${_GOLEM_DISPATCH_DIR}/worktree-bootstrap.sh"
  if [[ ! -x "$bootstrap" ]]; then
    echo "[repogolem] worktree-bootstrap.sh not found next to the dispatcher (${_GOLEM_DISPATCH_DIR}); dependencies not installed" >&2
    return 0
  fi
  "$bootstrap" "$worktree_dir" || echo "[repogolem] worktree bootstrap failed; launching anyway" >&2
  return 0
}

# ── Launch staging directory ──────────────────────────────────────
