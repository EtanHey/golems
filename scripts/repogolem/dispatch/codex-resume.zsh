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
