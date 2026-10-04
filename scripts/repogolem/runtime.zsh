# Standalone replacements for the six dispatcher dependencies on Ralph.
# Legacy Ralph entrypoints remain available during the migration soak.
typeset -g _GOLEM_RUNTIME_DIR="${${(%):-%x}:A:h}"
: ${REPOGOLEM_GENERATED_DIR:="$HOME/.config/repogolem/generated"}
typeset -g RALPH_REGISTRY_FILE="$REPOGOLEM_GENERATED_DIR/registry.json"
_golem_runtime_read() { bun --no-install "$_GOLEM_RUNTIME_DIR/runtime-reader.ts" "$1" "$REPOGOLEM_GENERATED_DIR" "${2:-}"; }
_golem_runtime_read check || return $?
source "$_GOLEM_RUNTIME_DIR/golem-dispatch.zsh" || return $?

repoGolem() {
  (( $# >= 2 )) || { print -u2 'Usage: repoGolem <name> <path> [mcp ...]'; return 1; }
  # The call emitted by generate registers existing projects only. Dispatcher
  # wrappers already exist; configuration edits belong in config.yaml now.
  typeset -f "${(L)1}Claude" >/dev/null || { print -u2 'repoGolem: project is absent from the generated registry'; return 1; }
}
_ralph_load_libs() { return 0; } # Every required implementation is shipped beside this file.
_ralph_build_mcp_config() { _golem_runtime_read mcp "$1"; }
_ralph_setup_mcps() { _golem_runtime_read check; } # Validation, without fallback op reads.
_ralph_setup_secrets() {
  local pairs key value index
  local -a entries
  pairs=$(_golem_runtime_read env "$1") || return $?
  entries=("${(@0)pairs}")
  for (( index=1; index < ${#entries}; index+=2 )); do
    key="${entries[index]}"; value="${entries[index+1]}"
    # Project secrets retain the legacy environment-first override behaviour.
    [[ -n "${(P)key}" ]] || export "$key=$value"
  done
}
_repogolem_build_title() {
  local emoji label="$2" task="${3:-${CMUX_AGENT_TASK_NAME:-}}"
  emoji=$(jq -r --arg p "$1" '.projects[$p].emoji // ""' "$RALPH_REGISTRY_FILE") || return $?
  [[ -n "$emoji" ]] && label="$emoji $label"
  [[ -n "$task" ]] && label="$label: $task"
  print -r -- "$label"
}
_golem_setup_env() {
  _ralph_load_libs && _ralph_setup_mcps '[]' "$1" && _ralph_setup_secrets "$1"
}
