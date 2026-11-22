typeset -g _GOLEM_MCP_POLICY="${${(%):-%x}:A:h:h}/mcp_policy.py"

_golem_filter_mcp_json() {
  python3 "$_GOLEM_MCP_POLICY" "${1:-config}" "${project_name:-}"
}

_golem_filter_mcp_file() {
  local target="$1" mode="${2:-config}" filtered
  [[ -f "$target" ]] || return 0
  filtered=$(umask 077; mktemp "${target:h}/.repogolem-deny.XXXXXX") || return 1
  if ! _golem_filter_mcp_json "$mode" < "$target" > "$filtered"; then
    rm -f "$filtered"; return 1
  fi
  if cmp -s "$target" "$filtered"; then
    rm -f "$filtered"; return 0
  fi
  if [[ -L "$target" ]]; then
    rm -f "$filtered"
    print -u2 -- "repoGolem: forbidden MCP in symlinked config; refusing launch"
    return 1
  fi
  mv "$filtered" "$target"
}

# Profiles layer on user config, so disable denied global servers per launch.
_golem_codex_mcp_block_args() {
  local codex_home="$1" project_name="$2" blocked_mcps blocked_mcp
  [[ -f "${codex_home}/config.toml" ]] || return 0
  blocked_mcps=$(python3 "$_GOLEM_MCP_POLICY" codex-blocks "$project_name" < "${codex_home}/config.toml") || return 1
  for blocked_mcp in ${(f)blocked_mcps}; do
    [[ -z "$blocked_mcp" ]] || print -rl -- "-c" "$blocked_mcp"
  done
  return 0
}
