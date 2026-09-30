_golem_agy_resolve_model() {
  # Gatherers default to Flash-High: qa-video scored 22/22; Pro-High skimmed (14 and 7).
  # Pro is selected only explicitly; other aliases keep their exact agy strings.
  case "${1:-}" in
    "")                         print -r -- "Gemini 3.8 Flash (High)" ;;
    pro|pro-high)                print -r -- "Gemini 3.1 Pro (High)" ;;
    pro-low)                     print -r -- "Gemini 3.1 Pro (Low)" ;;
    flash|flash-high)            print -r -- "Gemini 3.8 Flash (High)" ;;
    flash-med|flash-medium)      print -r -- "Gemini 3.8 Flash (Medium)" ;;
    flash-low)                   print -r -- "Gemini 3.8 Flash (Low)" ;;
    opus)                        print -r -- "Claude Opus 4.6 (Thinking)" ;;
    sonnet)                      print -r -- "Claude Sonnet 4.6 (Thinking)" ;;
    oss|gpt-oss|gpt-oss-120b)    print -r -- "GPT-OSS 120B (Medium)" ;;
    *)                           print -r -- "$1" ;;
  esac
}

# AIDEV-NOTE: MCP secrets travel in env, never args. A renderer hands args to the
# MCP child as argv, which `ps` shows to every local process. Supabase reads
# SUPABASE_ACCESS_TOKEN from its env, so both the Antigravity and the Codex
# renderers drop `--access-token <v>` and `--access-token=<v>` from its args.
# The bare flag consumes the next arg only when that arg is not itself an option,
# so `--access-token --read-only` keeps `--read-only`; a trailing or repeated
# flag is dropped on its own. Prints a jq `def`; callers prefix their program with it.
_golem_jq_strip_supabase_token_arg() {
  print -r -- 'def strip_supabase_token_arg:
    def is_option: (type == "string") and startswith("-");
    if (.supabase? | type) == "object" and (.supabase.args? | type) == "array" then
      .supabase.args as $args
      | .supabase.args = [
          range(0; ($args | length)) as $i
          | select($args[$i] != "--access-token")
          | select((($args[$i] | type) != "string") or (($args[$i] | startswith("--access-token=")) | not))
          | select(($i == 0) or ($args[$i - 1] != "--access-token") or ($args[$i] | is_option))
          | $args[$i]
        ]
    else
      .
    end;'
}

# AGY files are durable config: read static definitions, never resolve credentials.
_golem_jq_agy_servers() {
  print -r -- 'def agy_servers:
    def secret_key: test("(?:^|[_-])(?:API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|AUTHORIZATION)$"; "i");
    def canonical:
      if has("cmuxlayer") then del(.cmux) elif has("cmux") then .cmuxlayer = .cmux | del(.cmux) else . end
      | if has("Context7") then del(.context7) elif has("context7") then .Context7 = .context7 | del(.context7) else . end;
    canonical
    | with_entries(select(.key | test("israeli[-_ ]?bank|leumi"; "i") | not))
    | strip_supabase_token_arg
    | if (.supabase.env? | type) == "object" then .supabase.env |= del(.SUPABASE_ACCESS_TOKEN) else . end
    | walk(if type == "object" then with_entries(
        if (.value | type) == "string" and ((.key | secret_key) or (.value | startswith("op://"))) then
          if (.value | test("^\\$\\{[A-Za-z_][A-Za-z0-9_]*\\}$")) then .
          else .value = ("${" + (.key | ascii_upcase | gsub("[-.]"; "_")) + "}") end
        else . end) else . end)
    | with_entries(.value |= (if type == "object" then
        if ((.serverUrl // "") == "") and ((.url // .httpUrl // "") != "") then .serverUrl = (.url // .httpUrl) else . end
        | del(.url, .httpUrl)
      else . end));'
}

_golem_agy_write_config() {
  local target="$1" servers="$2" mode="$3" allowed="${4:-[]}"
  local parent="${target:h}" existing='{}' tmp_file
  mkdir -p "$parent" || return 1
  if [[ -s "$target" ]]; then
    # Slurp once: retain non-MCP fields and the legacy JSON document count.
    existing=$(jq -cs 'if all(.[]; type == "object") then . else error("invalid MCP config") end' "$target" 2>/dev/null) || return 1
  else
    existing='[{}]'
  fi
  tmp_file=$(umask 077; mktemp "${parent}/.repogolem-mcp.XXXXXX") || return 1
  # Config values travel only on stdin, including project inputs before the
  # credential placeholder transform. jq argv must never carry raw MCP data.
  if print -r -- "$existing" "$servers" "$allowed" | jq -s --arg mode "$mode" \
    "$(_golem_jq_strip_supabase_token_arg)$(_golem_jq_agy_servers)"'
      .[1] as $servers | .[2] as $allowed | .[0][] | .mcpServers = (
        if $mode == "project" then $servers else
          ((.mcpServers // {}) + $servers) | agy_servers
          | with_entries(select(.key as $name | $allowed | index($name)))
        end)
    ' > "$tmp_file" 2>/dev/null; then
    mv "$tmp_file" "$target" || { rm -f "$tmp_file"; return 1; }
  else
    rm -f "$tmp_file"
    return 1
  fi
}

_golem_sync_agy_workspace() {
  local project_name="$1" project_path="$2"
  local registry="${RALPH_REGISTRY_FILE:-$HOME/.config/ralphtools/registry.json}"
  local servers registry_servers project_servers='[]'
  # The generic builder resolves op:// into plaintext, so AGY deliberately uses
  # raw registry definitions. Dynamic token-backed definitions use env refs.
  registry_servers=$(jq -c --arg p "$project_name" '
    . as $registry
    | reduce (.projects[$p].mcps // [])[] as $name (.global.mcps // {};
        if $registry.mcpDefinitions[$name] != null then .[$name] = $registry.mcpDefinitions[$name]
        elif $name == "linear" then .linear = {command:"npx",args:["-y","@tacticlaunch/mcp-linear"],env:{LINEAR_API_TOKEN:"${LINEAR_API_TOKEN}"}}
        elif $name == "supabase" then .supabase = {command:"npx",args:["-y","@supabase/mcp-server-supabase@latest"]}
        else . end)
  ' "$registry" 2>/dev/null) || return 1
  if [[ -f "${project_path}/.mcp.json" ]]; then
    project_servers=$(jq -cs '[.[] | .mcpServers // {}]' "${project_path}/.mcp.json" 2>/dev/null) || return 1
  fi
  servers=$(print -r -- "$registry_servers" "$project_servers" | jq -cs \
    "$(_golem_jq_strip_supabase_token_arg)$(_golem_jq_agy_servers)"'
      .[0] as $registry | reduce .[1][] as $map ($registry; . + $map) | agy_servers
    ' 2>/dev/null) || return 1
  _golem_agy_write_config "${project_path}/.agents/mcp_config.json" "$servers" project || return 1

  # Other live repo launches use this file. Retain only registry-declared names
  # already present (plus this launch), under a whole read/filter/write lock.
  # Never replace the shared file with a single project map or delete the lock.
  (
    local user_dir="$HOME/.gemini/config" lock_fd allowed
    mkdir -p "$user_dir" || exit 1
    (umask 077; : >> "${user_dir}/.repogolem-mcp.lock") || exit 1
    zmodload zsh/system || exit 1
    zsystem flock -t 10 -f lock_fd "${user_dir}/.repogolem-mcp.lock" || exit 1
    allowed=$(jq -c '
      [(.global.mcps // {} | keys[]), ((.projects // {})[] | ((.mcps // []) + (.mcpsLight // []))[])]
      | map(if . == "cmux" then "cmuxlayer" elif . == "context7" then "Context7" else . end) | unique
    ' "$registry" 2>/dev/null) || exit 1
    _golem_agy_write_config "${user_dir}/mcp_config.json" "$servers" global "$allowed"
    # Subshell exit closes the lock FD, including every failure path.
  )
}
