# ── Codex connector policy (Etan, 2026-10-06) ──────────────────────
# Computer use stays on for every launch. The codex_apps cloud connectors
# (Gmail send, Calendar, Drive, GitHub as Etan...) and browser-tools-mcp are
# stripped from every agent-shaped launch, fail-safe: only `--lead` or the bare
# human shape (no args, a TTY, no agent markers) keeps them. Stripped launches
# still get Google Drive read-only.

# Drive tools codex marks readOnlyHint=true (codex-cli 0.160.1 cache). Drive
# runs with default_tools_enabled=false, so a tool missing here stays off.
_golem_codex_drive_read_tools=(
  export_file fetch fetch_file_revision find_document_text_range
  get_document get_document_comments get_document_paragraph_range get_document_tables get_document_text
  get_file_comments get_file_metadata
  get_presentation get_presentation_comments get_presentation_outline get_presentation_tables get_presentation_text
  get_profile get_slide get_slide_thumbnail
  get_spreadsheet_cells get_spreadsheet_comments get_spreadsheet_metadata get_spreadsheet_range
  list_drives list_file_revisions list_folder recent_documents search search_spreadsheet_rows
)

# ...and the 16 it does not. default_tools_enabled=false already keeps these
# off; each is also disabled explicitly, so a codex that ignored the default
# would still not expose a Drive write.
_golem_codex_drive_write_tools=(
  batch_update_document batch_update_presentation batch_update_spreadsheet bulk_update_file_comments
  copy_file create_file create_folder create_presentation_from_template delete_file
  duplicate_sheet_in_new_spreadsheet import_document import_presentation import_spreadsheet
  share_file update_file upload_file
)

# Seam for tests: bats has no TTY, so they stub this to model a human terminal.
_golem_codex_stdio_is_tty() {
  [[ -t 0 && -t 1 ]]
}

# Prints the first agent marker present in the environment, if any.
_golem_codex_agent_marker() {
  local marker
  for marker in CODEX_THREAD_ID CLAUDECODE CLAUDE_CODE_SESSION_ID AI_AGENT CLAUDE_WORKER CMUX_AGENT_ID; do
    if [[ -n "${(P)marker:-}" ]]; then
      print -r -- "$marker"
      return 0
    fi
  done
  return 1
}

# Sets REPLY to why a launch is not the bare human shape: zero launcher args
# (cmuxlayer always passes -E), not a worker, stdin+stdout on a TTY, and no
# agent marker. REPLY is empty for the bare human shape. Called directly, not
# in $(...), so the TTY test sees the real stdout.
_golem_codex_bare_human_reason() {
  local -i argc="$1"
  local worker_mode="$2" marker=""
  REPLY=""
  if (( argc > 0 )); then
    REPLY="launcher arguments"
  elif [[ "$worker_mode" == true ]]; then
    REPLY="worker mode"
  elif ! _golem_codex_stdio_is_tty; then
    REPLY="no TTY"
  elif marker=$(_golem_codex_agent_marker); then
    REPLY="agent marker ${marker}"
  fi
}

# Scans raw Codex args for the `-c` spellings codex 0.160.1 honours: `-c K=V`,
# `-cK=V`, `-c=K=V` (clap strips the `=` after a short flag), `--config K=V`
# and `--config=K=V`; `--conf`/`--confi` are rejected and `-c==` aborts.
# Prints the first value whose key matches <predicate>. Codex lets the last
# `-c` win, so a matching caller key would undo the launcher's own.
_golem_codex_args_config_match() {
  local predicate="$1"; shift
  local -a args=("$@")
  local -i i=1
  local arg value
  while (( i <= ${#args[@]} )); do
    arg="${args[$i]}"
    value=""
    case "$arg" in
      -c|--config) value="${args[$(( i + 1 ))]:-}"; (( i += 1 )) ;;
      --config=*) value="${arg#--config=}" ;;
      -c?*) value="${arg#-c}"; value="${value#=}" ;;
    esac
    if [[ -n "$value" ]] && "$predicate" "$value"; then
      print -r -- "$value"
      return 0
    fi
    (( i += 1 ))
  done
  return 1
}

# True when a `-c` key would toggle a feature or touch the connectors. Codex
# 0.160.1 accepts `connectors` as an alias of the `apps` feature; keys keep
# their quotes as literal characters, so those are stripped before matching.
_golem_codex_config_key_is_connector() {
  local key="${1%%=*}"
  key=${key//[[:space:]\"\']/}
  [[ "$key" == features || "$key" == features.* || "$key" == apps || "$key" == apps.* \
     || "$key" == connectors || "$key" == connectors.* ]]
}

# Feature toggles are not an agent's call: `--enable` beats `-c` in any order
# (`--enable connectors` re-enabled codex_apps past features.apps=false), so
# every --enable/--disable spelling is refused, as are features/apps keys.
_golem_codex_args_reenable_connectors() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --enable|--enable=*|--disable|--disable=*) print -r -- "$arg"; return 0 ;;
    esac
  done
  _golem_codex_args_config_match _golem_codex_config_key_is_connector "$@"
}

# Prints `<connector id><TAB><name>` from codex's own connector tool cache, with
# names normalised the way the tools are prefixed ("Google Drive" ->
# google_drive). Codex has no CLI for this map; the cache is what it wrote.
_golem_codex_connector_ids() {
  local cache_dir="${CODEX_HOME:-$HOME/.codex}/cache/codex_apps_tools" cache_file
  for cache_file in "$cache_dir"/*.json(N); do
    jq -r '.tools[]? | select((.connector_id | type) == "string" and (.connector_name | type) == "string")
      | [.connector_id, (.connector_name | ascii_downcase | gsub("[^a-z0-9]+"; "_") | gsub("^_+|_+$"; ""))] | @tsv' \
      "$cache_file" 2>/dev/null
  done | LC_ALL=C sort -u
}

# Drops browser-tools-mcp from a merged MCP JSON, matched by server name or by
# the package in command/args, so a renamed entry is still caught.
_golem_jq_drop_browser_tools() {
  print -r -- '.mcpServers |= ((. // {}) | with_entries(select(
    ((.key | ascii_downcase | gsub("[^a-z0-9]"; "") | contains("browsertools"))
     or ([(.value.command // ""), ((.value.args // [])[]? | tostring)] | map(tostring) | any(contains("browser-tools-mcp"))))
    | not)))'
}

# Resolves the codex.security role from standards/model-roles.json: the root is
# GOLEMS_MODEL_ROLES_ROOT, else the registry's golems project. No fallback pin.
_golem_codex_security_model() {
  local roles_root="${GOLEMS_MODEL_ROLES_ROOT:-}" model=""
  if [[ -z "$roles_root" ]]; then
    roles_root=$(jq -r '.projects.golems.path // empty' "${RALPH_REGISTRY_FILE:-$HOME/.config/ralphtools/registry.json}" 2>/dev/null)
  fi
  # The generated registry stores paths as `~/Gits/<repo>`.
  roles_root="${roles_root/#\~/$HOME}"
  [[ -n "$roles_root" && -f "$roles_root/standards/model-roles.json" ]] || return 1
  model=$(jq -r '.roles["codex.security"] | select(.status != "candidate") | .model // empty' \
    "$roles_root/standards/model-roles.json" 2>/dev/null)
  [[ -n "$model" ]] || return 1
  print -r -- "$model"
}

# True when a `-c` key would loosen the scan seat's sandbox or approvals, or
# turn its computer use back on.
_golem_codex_config_key_is_scan_sandbox() {
  local key="${1%%=*}"
  key=${key//[[:space:]\"\']/}
  [[ "$key" == sandbox_mode* || "$key" == sandbox_workspace_write* || "$key" == approval_policy* \
     || "$key" == permissions || "$key" == permissions.* || "$key" == default_permissions* \
     || "$key" == plugins || "$key" == plugins.* || "$key" == mcp_servers \
     || "$key" == mcp_servers.node_repl || "$key" == mcp_servers.node_repl.* \
     || "$key" == mcp_servers.computer-use || "$key" == mcp_servers.computer-use.* ]]
}

# A scan seat does not test, so unlike every other launch it turns computer use
# off: the app-driving plugins plus the node_repl/computer-use servers hosting
# their runtime (full tables: a bare enabled=false aborts codex where the server
# is undeclared). Bare dotted keys: codex keeps quotes inside a key segment.
_golem_codex_scan_computer_use_overrides() {
  local name
  for name in computer-use unified-computer-use browser computer-history chrome record-and-replay messages codex-app-tools; do
    print -r -- "-c"
    print -r -- "plugins.${name}@openai-bundled.enabled=false"
  done
  for name in node_repl computer-use; do
    print -r -- "-c"
    print -r -- "mcp_servers.${name}={command=\"/usr/bin/false\",enabled=false}"
  done
}

# Prints the first caller argument that would take a --scan launch off the
# managed workspace-write sandbox Deep Scan requires. Sweep of codex-cli
# 0.160.1 (`--help` for codex, exec and resume, plus hidden aliases probed on
# the real binary): `--yolo` is an alias of the bypass flag; `-s`/`--sandbox`
# and `-a`/`--ask-for-approval` take `X`, `=X` and attached `X` spellings;
# --approve-for-me reroutes approvals; --add-dir widens the writable set; a
# caller profile (-p/--profile) can widen sandbox_workspace_write. Restating
# the seat's own `workspace-write` / `never` is allowed.
_golem_codex_scan_conflict() {
  local -a args=("$@")
  local -i i=1
  local arg value
  while (( i <= ${#args[@]} )); do
    arg="${args[$i]}"
    value=""
    case "$arg" in
      --dangerously-bypass-approvals-and-sandbox|--yolo|--full-auto|--approve-for-me \
      |--add-dir|--add-dir=*|-p|-p?*|--profile|--profile=*)
        print -r -- "$arg"; return 0 ;;
      -s|--sandbox) value="${args[$(( i + 1 ))]:-}"; (( i += 1 ))
        [[ "$value" == workspace-write ]] || { print -r -- "$arg ${value}"; return 0; } ;;
      --sandbox=*|-s?*) value="${arg#--sandbox=}"; [[ "$arg" == -s?* ]] && { value="${arg#-s}"; value="${value#=}"; }
        [[ "$value" == workspace-write ]] || { print -r -- "$arg"; return 0; } ;;
      -a|--ask-for-approval) value="${args[$(( i + 1 ))]:-}"; (( i += 1 ))
        [[ "$value" == never ]] || { print -r -- "$arg ${value}"; return 0; } ;;
      --ask-for-approval=*|-a?*) value="${arg#--ask-for-approval=}"; [[ "$arg" == -a?* ]] && { value="${arg#-a}"; value="${value#=}"; }
        [[ "$value" == never ]] || { print -r -- "$arg"; return 0; } ;;
    esac
    (( i += 1 ))
  done
  _golem_codex_args_config_match _golem_codex_config_key_is_scan_sandbox "$@"
}

_golem_launch_codex() {
  local project_name="$1" project_path="$2"; shift 2
  # The bare human shape starts with zero launcher args: cmuxlayer always passes -E.
  local -i codex_launcher_argc=$#
  local -x MCP_CONNECTION_NONBLOCKING=1
  local -x CLAUDE_CODE_NO_FLICKER=1
  local _flag_codex_effort _flag_codex_effort_explicit _flag_codex_help _flag_codex_worker _flag_codex_lead _flag_codex_scan
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
  # Pin the CURRENT top Sol on fresh boots so a prior session's model cannot leak into
  # the next one. This is a moving fleet default, not a frozen version: bump it on each
  # Sol release, and do not drop the --model flag. Resume paths recover their session model
  # from the selected rollout unless the caller deliberately supplies -m/--model.
  local model="${_flag_model:-}"
  # A scan seat runs on the codex.security role, resolved at launch: no pin here.
  if $_flag_codex_scan && [[ -z "$model" ]]; then
    if ! model=$(_golem_codex_security_model); then
      print -u2 -- "repoGolem: --scan cannot resolve the codex.security model from standards/model-roles.json (set GOLEMS_MODEL_ROLES_ROOT or register the golems project, or pass -m explicitly)."
      return 2
    fi
  fi
  if [[ "$explicit_resume" == false && "$_flag_continue" == false && -z "$model" ]]; then
    model="gpt-6.1-sol"
  fi
  local worker_mode="${_golem_codex_worker_mode:-false}"
  $_flag_codex_worker && worker_mode=true
  # A scan seat is always a worker: every strip applies and the hatch never opens.
  $_flag_codex_scan && worker_mode=true
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

  # Ambient effort belongs only to a fresh prompted/worker boot. Bare boots use
  # Codex config; resume (including a continue prompt) restores rollout effort.
  # Raw passthrough arguments may contain a prompt, so require effort for them too.
  if [[ "$explicit_resume" == false && "$_flag_continue" == false ]] \
     && [[ "$worker_mode" == true || "$_flag_headless" == true || -n "$positional_prompt" || ${#codex_args[@]} -gt 0 ]]; then
    if ! $_flag_codex_effort_explicit && [[ -n "${GOLEM_EFFORT:-}" ]]; then
      case "$GOLEM_EFFORT" in
        low|medium|high|xhigh|max|ultra)
          _flag_codex_effort="$GOLEM_EFFORT"
          _flag_codex_effort_explicit=true ;;
        *)
          echo "Error: Invalid Codex effort: $GOLEM_EFFORT (expected: low, medium, high, xhigh, max, ultra)" >&2
          return 2 ;;
      esac
    fi
    if ! $_flag_codex_effort_explicit; then
      echo "Error: Codex prompted/worker launches require explicit effort: low, medium, high, xhigh, max, ultra." >&2
      echo "Pass -E <level>, --effort <level>, or GOLEM_EFFORT; choose per plan phase (see /agent-routing)." >&2
      return 2
    fi
  fi
  # codex-security Deep Scan refuses a parent without a managed filesystem
  # permission profile, which a danger-full-access (bypass) seat cannot give.
  if $_flag_codex_scan; then
    local codex_scan_conflict=""
    if codex_scan_conflict=$(_golem_codex_scan_conflict "$resume_prefix_flag" "${codex_args[@]}"); then
      print -u2 -- "repoGolem: --scan refuses ${codex_scan_conflict%%=*}: a scan seat runs workspace-write with approval_policy=never and computer use off so codex-security Deep Scan can start."
      return 2
    fi
  fi

  # Connector policy: strip unless --lead or the bare human shape. A lane
  # re-enables what it needs for one launch, by name:
  #   GOLEM_CODEX_WORKER_ALLOW=gmail,google_calendar,google_drive,browser-tools
  # (google_drive here means full Drive, writes included). The variable is
  # shadowed below, so the launched codex never inherits it.
  local codex_worker_allow="${GOLEM_CODEX_WORKER_ALLOW:-}"
  local GOLEM_CODEX_WORKER_ALLOW
  unset GOLEM_CODEX_WORKER_ALLOW
  local codex_strip_extras=true
  if $_flag_codex_lead; then
    if [[ "$worker_mode" == true ]]; then
      print -u2 -- "repoGolem: --lead ignored: a worker signal (--worker or GOLEM_ROLE=worker) wins; codex_apps connectors and browser-tools stay stripped."
    else
      codex_strip_extras=false
    fi
  else
    _golem_codex_bare_human_reason "$codex_launcher_argc" "$worker_mode"
    [[ -z "$REPLY" ]] && codex_strip_extras=false
  fi
  local -a codex_connector_args=()
  local codex_strip_browser_tools=false
  if [[ "$codex_strip_extras" == true ]]; then
    local codex_reenabling_connector=""
    if codex_reenabling_connector=$(_golem_codex_args_reenable_connectors "$resume_prefix_flag" "${codex_args[@]}"); then
      print -u2 -- "repoGolem: refusing a Codex ${codex_reenabling_connector%%=*} without --lead: feature toggles and connector config are not an agent's call; name connectors in GOLEM_CODEX_WORKER_ALLOW instead."
      return 2
    fi
    local -a codex_allow_names=(${(s:,:)${codex_worker_allow//[[:space:]]/}})
    local -a codex_allow_connectors=("${(@)codex_allow_names:#browser-tools}")
    (( ${codex_allow_names[(Ie)browser-tools]} )) || codex_strip_browser_tools=true
    local -A codex_connector_id_by_name=() codex_connector_wanted=()
    local codex_connector_line codex_connector_name codex_connector_id codex_drive_tool
    for codex_connector_line in ${(f)"$(_golem_codex_connector_ids)"}; do
      codex_connector_id_by_name[${codex_connector_line#*$'\t'}]="${codex_connector_line%%$'\t'*}"
    done
    for codex_connector_name in "${codex_allow_connectors[@]}"; do
      if [[ -z "${codex_connector_id_by_name[$codex_connector_name]:-}" ]]; then
        local codex_known_connectors="${(j:, :)${(@ko)codex_connector_id_by_name}}"
        print -u2 -- "repoGolem: GOLEM_CODEX_WORKER_ALLOW: unknown connector \"${codex_connector_name}\" (known: ${codex_known_connectors:-none cached; run plain codex once}). Refusing the launch."
        return 2
      fi
      codex_connector_wanted[${codex_connector_id_by_name[$codex_connector_name]}]=1
    done
    local codex_drive_id="${codex_connector_id_by_name[google_drive]:-}"
    if (( ${#codex_connector_id_by_name[@]} == 0 )); then
      # Nothing cached to allowlist against: no connectors at all, Drive included.
      codex_connector_args=("-c" "features.apps=false")
    else
      # apps._default alone is not enough: an app with its own [apps.<id>] table
      # in config.toml stays on, so every cached id is set explicitly.
      codex_connector_args=("-c" "apps._default.enabled=false")
      for codex_connector_id in ${(ou)codex_connector_id_by_name}; do
        if [[ -n "${codex_connector_wanted[$codex_connector_id]:-}" ]]; then
          codex_connector_args+=("-c" "apps.${codex_connector_id}.enabled=true")
        elif [[ "$codex_connector_id" == "$codex_drive_id" ]]; then
          codex_connector_args+=("-c" "apps.${codex_connector_id}.enabled=true"
                                 "-c" "apps.${codex_connector_id}.default_tools_enabled=false")
          for codex_drive_tool in "${_golem_codex_drive_read_tools[@]}"; do
            codex_connector_args+=("-c" "apps.${codex_connector_id}.tools.${codex_drive_tool}.enabled=true")
          done
          for codex_drive_tool in "${_golem_codex_drive_write_tools[@]}"; do
            codex_connector_args+=("-c" "apps.${codex_connector_id}.tools.${codex_drive_tool}.enabled=false")
          done
        else
          codex_connector_args+=("-c" "apps.${codex_connector_id}.enabled=false")
        fi
      done
    fi
    if (( ${#codex_allow_names[@]} > 0 )); then
      print -u2 -- "repoGolem: GOLEM_CODEX_WORKER_ALLOW re-enabled for this launch: ${(j:, :)codex_allow_names}"
    fi
  fi

  local codex_config_args=()
  if $_flag_codex_effort_explicit; then
    codex_config_args=("-c" "model_reasoning_effort=\"${_flag_codex_effort}\"")
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
  _golem_setup_env "$project_name" || return $?

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

  codex_config_args+=("${codex_connector_args[@]}")
  if $_flag_codex_scan; then
    codex_config_args+=("-s" "workspace-write" "-c" 'approval_policy="never"'
                        "${(@f)$(_golem_codex_scan_computer_use_overrides)}")
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

  if [[ "$codex_strip_browser_tools" == true ]]; then
    local _tmp_filter
    _tmp_filter=$(umask 077; mktemp "${codex_home}/.repogolem-codex-${codex_profile}.filter.json.XXXXXX") || { rm -f "$merged_mcp_file"; _golem_cleanup_agent_context "$agent_context_file"; return 1; }
    if jq "$(_golem_jq_drop_browser_tools)" "$merged_mcp_file" > "$_tmp_filter" 2>/dev/null; then
      mv "$_tmp_filter" "$merged_mcp_file"
      chmod 600 "$merged_mcp_file" 2>/dev/null
    else
      # Fail closed: a stripped launch never gets the unfiltered servers.
      rm -f "$_tmp_filter"
      print -r -- '{"mcpServers":{}}' > "$merged_mcp_file"
      print -u2 -- "repoGolem: could not filter browser-tools from this launch's MCP servers; launching without project MCP servers."
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
  local env_key_toml="" env_value_toml=""
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
        [[ -n "$mcp_command" ]] && print -r -- "command = $(print -rn -- "$mcp_command" | jq -Rs '.')"
        [[ -n "$mcp_args_json" && "$mcp_args_json" != "null" && "$mcp_args_json" != '""' ]] && print -r -- "args = ${mcp_args_json}"
        [[ -n "$mcp_url" ]] && print -r -- "url = $(print -rn -- "$mcp_url" | jq -Rs '.')"
        # A bare non-numeric timeout ("30s") renders `timeout = 30s`, which is
        # not valid TOML and aborts the launch — quote anything non-integer.
        if [[ -n "$mcp_timeout" && "$mcp_timeout" != "null" ]]; then
          if [[ "$mcp_timeout" == (-|)<-> ]]; then
            print -r -- "timeout = ${mcp_timeout}"
          else
            print -r -- "timeout = $(print -rn -- "$mcp_timeout" | jq -Rs '.')"
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
            env_key_toml=$(print -rn -- "$env_key" | jq -Rs '.')
            env_value_toml=$(print -rn -- "$env_value" | jq -Rs '.')
            print -r -- "${env_key_toml} = ${env_value_toml}"
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

  # Deep Scan cost cap for this launch (codex-security reads [deep_scan] from
  # CODEX_SECURITY_DEEP_SCAN_CONFIG_PATH; its own defaults are 4 workers x 3
  # subagents, 40 discovery runs, 96 h). A caller-supplied file wins.
  local codex_scan_cap_file=""
  if $_flag_codex_scan && [[ -z "${CODEX_SECURITY_DEEP_SCAN_CONFIG_PATH:-}" ]]; then
    codex_scan_cap_file="${codex_home}/${codex_profile}.deep_scan.toml"
    if print -r -- $'[deep_scan]\nworkers = 2\nsubagents = 2\nmax_discovery_runs = 10\nmax_time_hours = 2' > "$codex_scan_cap_file" 2>/dev/null; then
      local -x CODEX_SECURITY_DEEP_SCAN_CONFIG_PATH="$codex_scan_cap_file"
    else
      print -u2 -- "repoGolem: could not write the Deep Scan cost cap ${codex_scan_cap_file}; refusing an uncapped scan."
      rm -f "$codex_scan_cap_file"
      [[ "$codex_profile_published" == true ]] && rm -f "$codex_profile_file"
      _golem_cleanup_agent_context "$agent_context_file"
      _golem_reset_title
      return 1
    fi
  fi

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
  [[ -n "$codex_scan_cap_file" ]] && rm -f "$codex_scan_cap_file"

  _golem_cleanup_agent_context "$agent_context_file"
  _golem_reset_title
  return "$codex_exit"
}

# ── Cursor launcher ───────────────────────────────────────────────
