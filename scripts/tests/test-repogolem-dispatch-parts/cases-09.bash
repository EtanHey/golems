# Stripped launches keep Google Drive read-only (Etan, 2026-10-06), lose every
# other codex_apps connector and browser-tools, and may re-enable named extras
# for one launch with GOLEM_CODEX_WORKER_ALLOW (never inherited).

CODEX_WORKER_ALLOW_LOGGED='repoGolem: GOLEM_CODEX_WORKER_ALLOW re-enabled for this launch:'

# Synthetic connector cache in the shape codex writes to
# $CODEX_HOME/cache/codex_apps_tools/<hash>.json.
write_codex_apps_cache() {
    mkdir -p "$CODEX_HOME/cache/codex_apps_tools"
    cat > "$CODEX_HOME/cache/codex_apps_tools/fixture.json" <<'JSON'
{"schema_version":1,"tools":[
  {"connector_id":"connector_fixturedrive","connector_name":"Google Drive","tool_name":"_search"},
  {"connector_id":"connector_fixturedrive","connector_name":"Google Drive","tool_name":"_create_file"},
  {"connector_id":"connector_fixturegmail","connector_name":"Gmail","tool_name":"_send_email"},
  {"connector_id":"connector_fixturecal","connector_name":"Google Calendar","tool_name":"_create_event"},
  {"connector_id":"connector_fixturegh","connector_name":"GitHub","tool_name":"_create_pull_request"}
]}
JSON
}

# browser-tools by name, the same package under another name (from the
# registry stub), and a harmless server that must survive.
write_browser_tools_mcp_fixture() {
    cat > "$PROJECT_DIR/.mcp.json" <<'JSON'
{"mcpServers":{
  "browser-tools":{"command":"npx","args":["-y","@agentdeskai/browser-tools-mcp@1.2.0"]},
  "harmless":{"command":"harmless-mcp","args":["--stdio"]}
}}
JSON
}

assert_drive_read_only() {
    local launch="$1" launch_output="$2" tool
    codex_arg_pair_present 'apps._default.enabled=false' "$launch_output" || { echo "[$launch] no _default off" >&2; return 1; }
    codex_arg_pair_present 'apps.connector_fixturedrive.enabled=true' "$launch_output" || { echo "[$launch] Drive off" >&2; return 1; }
    codex_arg_pair_present 'apps.connector_fixturedrive.default_tools_enabled=false' "$launch_output" \
      || { echo "[$launch] Drive tools not default-off" >&2; return 1; }
    for tool in search fetch get_document_text list_folder recent_documents export_file; do
        codex_arg_pair_present "apps.connector_fixturedrive.tools.${tool}.enabled=true" "$launch_output" \
          || { echo "[$launch] Drive read tool ${tool} missing" >&2; return 1; }
    done
    # Writes are never allowlisted; with default_tools_enabled=false they stay off.
    for tool in "${CODEX_DRIVE_WRITE_TOOLS[@]}"; do
        refute_contains "tools.${tool}.enabled=true" "$launch_output" "[$launch] Drive write tool ${tool}" || return 1
    done
}

# The 16 Drive tools codex does not mark readOnlyHint (codex-cli 0.160.1 cache).
CODEX_DRIVE_WRITE_TOOLS=(
    batch_update_document batch_update_presentation batch_update_spreadsheet bulk_update_file_comments
    copy_file create_file create_folder create_presentation_from_template delete_file
    duplicate_sheet_in_new_spreadsheet import_document import_presentation import_spreadsheet
    share_file update_file upload_file
)

function split_case_141() {
    write_codex_apps_cache
    local launch
    for launch in 'testrepoCodex -E low --worker' 'testrepoCodex resume --last' 'testrepoCodex -s -m gpt-6.1-sol -E high'; do
        run_codex_policy_launch "$launch"
        [ "$status" -eq 0 ] || { echo "[$launch] status=$status: $output" >&2; return 1; }
        assert_drive_read_only "$launch" "$output" || return 1
        local id
        for id in connector_fixturegmail connector_fixturecal connector_fixturegh; do
            codex_arg_pair_present "apps.${id}.enabled=false" "$output" \
              || { echo "[$launch] ${id} not off: $output" >&2; return 1; }
        done
        refute_contains "$CODEX_WORKER_CONNECTOR_OVERRIDE" "$output" "[$launch] Drive read needs the apps feature on" || return 1
    done
    # A lead keeps everything: no apps.* args at all.
    run_codex_policy_launch 'testrepoCodex --lead -s -m gpt-6.1-sol -E high'
    [ "$status" -eq 0 ]
    refute_contains 'CODEX_ARG=apps.' "$output" "a lead keeps its connectors"
}

function split_case_142() {
    # Nothing cached to allowlist against: no connectors at all, Drive included.
    run_codex_policy_launch 'testrepoCodex -E low --worker'
    [ "$status" -eq 0 ]
    codex_arg_pair_present "$CODEX_WORKER_CONNECTOR_OVERRIDE" "$output"
    refute_contains 'CODEX_ARG=apps.' "$output" "no cache: features.apps=false only"
}

function split_case_143() {
    # Opt-in by name: the named connector comes back in full, Drive stays
    # read-only unless named, one stderr line, and nothing is inherited.
    write_codex_apps_cache
    run_codex_policy_launch 'testrepoCodex -E low --worker' 'gmail'
    [ "$status" -eq 0 ]
    codex_arg_pair_present 'apps.connector_fixturegmail.enabled=true' "$output"
    codex_arg_pair_present 'apps.connector_fixturegh.enabled=false' "$output"
    assert_drive_read_only "allow gmail" "$output"
    [ "$(grep -F -c -- "$CODEX_WORKER_ALLOW_LOGGED gmail" <<< "$output")" = "1" ]
    grep -F -x -q -- 'ALLOW_ENV=unset' <<< "$output"
    # Naming google_drive gives full Drive: no default-off, no allowlist.
    run_codex_policy_launch 'testrepoCodex -E low --worker' 'google_drive'
    [ "$status" -eq 0 ]
    codex_arg_pair_present 'apps.connector_fixturedrive.enabled=true' "$output"
    refute_contains 'default_tools_enabled' "$output" "full Drive by name"
}

function split_case_144() {
    # An unknown connector name, or no cache to resolve it from, refuses.
    write_codex_apps_cache
    run_codex_policy_launch 'testrepoCodex -E low --worker' 'gmial'
    [ "$status" -eq 2 ]
    grep -F -q -- 'unknown connector "gmial"' <<< "$output"
    refute_contains 'CODEX_ARG=' "$output" "codex must not start"
    rm -rf "$CODEX_HOME/cache/codex_apps_tools"
    run_codex_policy_launch 'testrepoCodex -E low --worker' 'gmail'
    [ "$status" -eq 2 ]
    grep -F -q -- 'unknown connector "gmail"' <<< "$output"
    refute_contains 'CODEX_ARG=' "$output" "codex must not start"
}

function split_case_145() {
    # browser-tools: dropped by name and by package on stripped launches,
    # kept for a lead and when named.
    write_browser_tools_mcp_fixture
    run_codex_policy_launch 'testrepoCodex resume --last'
    [ "$status" -eq 0 ]
    grep -F -x -q -- 'PROFILE_SERVERS=harmless' <<< "$output" || { echo "stripped profile: $output" >&2; return 1; }
    run_codex_policy_launch 'testrepoCodex --lead -s -m gpt-6.1-sol -E high'
    [ "$status" -eq 0 ]
    grep -F -x -q -- 'PROFILE_SERVERS=browser-tools,devtools-renamed,harmless' <<< "$output" \
      || { echo "lead profile: $output" >&2; return 1; }
    run_codex_policy_launch 'testrepoCodex -E low --worker' 'browser-tools'
    [ "$status" -eq 0 ]
    grep -F -x -q -- 'PROFILE_SERVERS=browser-tools,devtools-renamed,harmless' <<< "$output"
    [ "$(grep -F -c -- "$CODEX_WORKER_ALLOW_LOGGED browser-tools" <<< "$output")" = "1" ]
    grep -F -x -q -- 'ALLOW_ENV=unset' <<< "$output"
}

function split_case_146() {
    # On a lead launch the variable has nothing to re-enable: no line, and it
    # still does not reach codex.
    run_codex_policy_launch 'testrepoCodex --lead -s -m gpt-6.1-sol -E high' 'gmail'
    [ "$status" -eq 0 ]
    refute_contains "$CODEX_WORKER_ALLOW_LOGGED" "$output" "a lead launch has nothing to re-enable"
    grep -F -x -q -- 'ALLOW_ENV=unset' <<< "$output"
}

function split_case_147() {
    # A caller flag that would re-enable connectors wins as the last -c (and
    # --enable beats -c in any order), so every spelling is refused without
    # --lead. `connectors` is a real codex alias of the apps feature.
    local launch
    local -a refused=(
        'testrepoCodex -E low --worker -- -c features.apps=true'
        'testrepoCodex -E low --worker -- -cfeatures.apps=true'
        'testrepoCodex -E low --worker -- -c=features.apps=true'
        'testrepoCodex -E low --worker -- --config features.apps=true'
        'testrepoCodex -E low --worker -- --config=features={apps=true}'
        'testrepoCodex -E low --worker --config features.connectors=true "task"'
        'testrepoCodex -E low --worker -- -c features.js_repl=true'
        'testrepoCodex -E low --worker -- -c apps.connector_fixturegmail.enabled=true'
        'testrepoCodex -E low --worker -- -c "apps._default.enabled=true"'
        'testrepoCodex -E low --worker -- -c connectors.connector_fixturegmail.enabled=true'
        'testrepoCodex -E low --worker --enable connectors "task"'
        'testrepoCodex -E low --worker -- --enable=connectors'
        'testrepoCodex -E low --worker -- --enable apps'
        'testrepoCodex -E low --worker -- --disable memories'
        'testrepoCodex resume --last --config features.apps=true'
        'testrepoCodex -s -m gpt-6.1-sol -E high -- --enable apps'
    )
    for launch in "${refused[@]}"; do
        run_codex_policy_launch "$launch"
        [ "$status" -eq 2 ] || { echo "[$launch] status=$status: $output" >&2; return 1; }
        grep -F -q -- 'repoGolem: refusing a Codex' <<< "$output" \
          || { echo "[$launch] missing refusal: $output" >&2; return 1; }
        refute_contains 'CODEX_ARG=' "$output" "[$launch] codex must not start" || return 1
    done
    # The same flags on a lead launch are the lead's own business.
    run_codex_policy_launch 'testrepoCodex --lead -s -E high -- --enable apps'
    [ "$status" -eq 0 ]
    # Unrelated -c keys pass through on stripped launches.
    run_codex_policy_launch 'testrepoCodex -E low --worker -- -c model_verbosity="low"'
    [ "$status" -eq 0 ]
}

function split_case_148() {
    # Belt and braces (#678 rework review): besides default_tools_enabled=false,
    # each known Drive write tool is disabled explicitly.
    write_codex_apps_cache
    run_codex_policy_launch 'testrepoCodex -E low --worker'
    [ "$status" -eq 0 ]
    [ "${#CODEX_DRIVE_WRITE_TOOLS[@]}" -eq 16 ]
    local tool
    for tool in "${CODEX_DRIVE_WRITE_TOOLS[@]}"; do
        codex_arg_pair_present "apps.connector_fixturedrive.tools.${tool}.enabled=false" "$output" \
          || { echo "Drive write tool ${tool} not explicitly disabled: $output" >&2; return 1; }
    done
}
