typeset -g _GOLEM_MCP_POLICY="${${(%):-%x}:A:h:h}/mcp_policy.py"

_golem_filter_mcp_json() {
  python3 "$_GOLEM_MCP_POLICY" "${1:-config}"
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
