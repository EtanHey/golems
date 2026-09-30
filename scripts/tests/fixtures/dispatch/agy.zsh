_golem_agy_resolve_model() {
  # Map short aliases to exact agy model strings; empty means default.
  case "${1:-}" in
    ""|pro|pro-high)             print -r -- "Gemini 3.1 Pro (High)" ;;
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
  merged_file=$(umask 077; mktemp "${staging_dir}/repogolem-agy-${project_name}.json.XXXXXX") || return 1
  print -r -- "$merged" > "$merged_file"

  if [[ -f "${project_path}/.mcp.json" ]]; then
    local merge_file
    merge_file=$(umask 077; mktemp "${staging_dir}/repogolem-agy-${project_name}.merge.json.XXXXXX") || {
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
  servers=$(print -r -- "$servers" | jq -c "$(_golem_jq_strip_supabase_token_arg)"'
    strip_supabase_token_arg
    | if (.supabase? | type) == "object" and (.supabase.env? | type) == "object" then
      .supabase.env |= del(.SUPABASE_ACCESS_TOKEN)
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
  tmp_file=$(umask 077; mktemp "${staging_dir}/repogolem-agy-${project_name}.agents.json.XXXXXX") || {
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
  user_tmp=$(umask 077; mktemp "${staging_dir}/repogolem-agy-${project_name}.user.json.XXXXXX") || {
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
