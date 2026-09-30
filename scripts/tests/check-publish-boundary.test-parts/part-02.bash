setup_policy_class_weakening() {
  perl -0pi -e 's/^  health:/  health-renamed:/m' "$1/scripts/publish-boundary-policy.yaml"
}

setup_baseline_fingerprint_weakening() {
  cp "$repo_root/scripts/publish-boundary-known-violations.sha256" \
    "$1/scripts/publish-boundary-known-violations.sha256"
  printf '%s\n' \
    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' \
    >> "$1/scripts/publish-boundary-known-violations.sha256"
}

setup_clean_placeholder() {
  printf 'redacted-tester@example.com\n' > "$1/contact.txt"
}

setup_clean_noreply() {
  printf 'author: 41898282+github-actions[bot]@users.noreply.github.com\n' > "$1/contact.txt"
}

setup_clean_machine_attribution() {
  printf 'Co-Authored-By: Worker <noreply@anthropic.com>\n' > "$1/contact.txt"
  printf 'remote: git@github.com\nnotification: noreply@github.com\n' >> "$1/contact.txt"
}

setup_clean_word_boundaries() {
  printf 'standard publication boundary\n' > "$1/guide.txt"
}

setup_clean_provider_code() {
  printf 'smoke test for bedtime service: TOKEN=process.env.PROVIDER_TOKEN\n' > "$1/provider.txt"
  printf 'client-specific pricing guide and wearable integration\n' >> "$1/provider.txt"
}

setup_clean_identifier_placeholder() {
  # shellcheck disable=SC2016 # The fixture must retain a literal env placeholder.
  printf '{"projectId":"${GOLEMS_SUPABASE_PROJECT_REF}"}\n' > "$1/config.json"
}

setup_clean_synthetic_project_id() {
  printf '{"project_id":"UHJvamVjdDo0OA=="}\n' > "$1/config.json"
}

setup_clean_drive_placeholder() {
  printf 'https://docs.google.com/document/d/<DOCUMENT_ID>/edit\n' > "$1/link.txt"
}

setup_allowlisted_fixture() {
  mkdir -p "$1/allowed"
  printf 'owner-contact@gmail.com\n' > "$1/allowed/synthetic.txt"
  printf 'allowed/synthetic.txt\n' > "$1/.publish-boundary-allow"
}

setup_snapshot_only() {
  :
}

expect_index_reject() {
  local test_repo
  local output_file

  test_repo=$(new_repo "index content beats local scrub")
  output_file="$test_repo/output.txt"
  printf 'owner-contact@gmail.com\n' > "$test_repo/contact.txt"
  git -C "$test_repo" add contact.txt
  printf 'redacted-tester@example.com\n' > "$test_repo/contact.txt"

  if run_guard "$test_repo" "$output_file"; then
    record_fail "index content beats local scrub: guard accepted committed leak" "$output_file"
  elif grep -Fq '[identity-pii] contact.txt' "$output_file"; then
    record_pass "index content beats local scrub rejects identity-pii"
  else
    record_fail "index content beats local scrub: guard failed without identity-pii evidence" "$output_file"
  fi
}

expect_ci_public_safe_warning() {
  local test_repo
  local output_file

  test_repo=$(new_repo "CI public-safe-only warning")
  output_file="$test_repo/output.txt"
  if ! run_guard_ci "$test_repo" "$output_file"; then
    record_fail "CI public-safe-only warning: clean guard failed" "$output_file"
  elif grep -Fq 'private marker policy unavailable; tree-clean classes remain enforced' "$output_file"; then
    record_pass "CI public-safe-only mode emits a visible warning"
  else
    record_fail "CI public-safe-only warning: warning was absent" "$output_file"
  fi
}

expect_private_hash_parity_reject() {
  local test_repo
  local output_file
  local private_policy

  test_repo=$(new_repo "private hash parity")
  output_file="$test_repo/output.txt"
  private_policy="$test_repo/custom-private-policy.yaml"
  printf '%s\n' \
    'hashed_markers:' \
    '  client-or-third-party:' \
    "    salt: 'fixture-private-v1'" \
    '    sha256:' \
    "      - '1:0000000000000000000000000000000000000000000000000000000000000000'" \
    'private_markers:' \
    '  client-or-third-party:' \
    "    - 'Acme'" \
    > "$private_policy"

  if run_guard "$test_repo" "$output_file" "$private_policy"; then
    record_fail "private hash parity: guard accepted an unhashed private marker" "$output_file"
  elif grep -Fq 'private marker hash parity failed' "$output_file"; then
    record_pass "private hash parity rejects drift"
  else
    record_fail "private hash parity: expected configuration evidence was absent" "$output_file"
  fi
}

expect_public_policy_has_no_marker_oracle() {
  if grep -Eq 'hashed_markers:|salt:|[0-9a-f]{64}' "$policy"; then
    record_fail "public marker oracle: tracked policy still contains salt or digests" "$policy"
  else
    record_pass "public policy contains no marker oracle"
  fi
}

expect_ci_private_policy_secret_reject() {
  local test_repo
  local output_file
  local private_policy_yaml

  test_repo=$(new_repo "CI private policy secret")
  output_file="$test_repo/output.txt"
  setup_private_hebrew_marker "$test_repo"
  private_policy_yaml=$(<"$test_repo/private-policy.yaml")
  rm "$test_repo/private-policy.yaml"
  git -C "$test_repo" add -A

  if run_guard_ci_with_private_policy "$test_repo" "$output_file" "$private_policy_yaml"; then
    record_fail "CI private policy secret: guard accepted a private marker" "$output_file"
  elif grep -Fq '[client-or-third-party] client-he.txt' "$output_file"; then
    record_pass "CI private policy secret enforces private markers"
  else
    record_fail "CI private policy secret: expected violation evidence was absent" "$output_file"
  fi
}

expect_ruby_preflight_reject() {
  local test_repo
  local output_file

  test_repo=$(new_repo "Ruby preflight")
  output_file="$test_repo/output.txt"
  if PUBLISH_BOUNDARY_RUBY_BIN=definitely-not-a-ruby-binary run_guard "$test_repo" "$output_file"; then
    record_fail "Ruby preflight: guard accepted a missing Ruby parser" "$output_file"
  elif grep -Fq 'required Ruby YAML parser not found' "$output_file"; then
    record_pass "Ruby preflight fails closed with a clear message"
  else
    record_fail "Ruby preflight: clear preflight message was absent" "$output_file"
  fi
}

expect_missing_private_override_reject() {
  local test_repo
  local output_file
  local missing_policy

  test_repo=$(new_repo "missing private override")
  output_file="$test_repo/output.txt"
  missing_policy="$test_repo/not-present.yaml"
  if PUBLISH_BOUNDARY_ROOT="$test_repo" \
    PUBLISH_BOUNDARY_POLICY="$test_repo/scripts/publish-boundary-policy.yaml" \
    PUBLISH_BOUNDARY_PRIVATE_POLICY="$missing_policy" \
    PUBLISH_BOUNDARY_ALLOWLIST="$test_repo/.publish-boundary-allow" \
    "$guard" >"$output_file" 2>&1; then
    record_fail "missing private override: guard silently skipped parity" "$output_file"
  elif grep -Fq 'private policy override not found' "$output_file"; then
    record_pass "missing private override fails loudly"
  else
    record_fail "missing private override: clear configuration evidence was absent" "$output_file"
  fi
}

expect_reachable_history_reject() {
  local test_repo
  local current_output
  local history_output
  local marker_blob

  test_repo=$(new_repo "reachable history")
  current_output="$test_repo/current-output.txt"
  history_output="$test_repo/history-output.txt"
  printf '%s\n' 'SYNTHETIC_HISTORY_MARKER_ONLY' > "$test_repo/history-marker.txt"
  git -C "$test_repo" add -A
  git -C "$test_repo" commit -qm 'fixture: add approved history marker'
  marker_blob=$(git -C "$test_repo" rev-parse HEAD:history-marker.txt)
  git -C "$test_repo" rm -q history-marker.txt
  git -C "$test_repo" commit -qm 'fixture: remove approved history marker'

  if ! git -C "$test_repo" cat-file -e "$marker_blob"; then
    record_fail "reachable history: approved marker blob is not resolvable before sanitation"
  elif ! run_guard "$test_repo" "$current_output"; then
    record_fail "reachable history: current-tree control failed before history enforcement" "$current_output"
  elif run_guard_history "$test_repo" "$history_output"; then
    record_fail "reachable history: guard accepted a reachable marker ancestor" "$history_output"
  elif grep -Fq '[history-reachability]' "$history_output"; then
    record_pass "reachable history rejects a marker retained only in an ancestor"
  else
    record_fail "reachable history: guard failed without history-reachability evidence" "$history_output"
  fi
}

expect_single_root_history_accept() {
  local test_repo
  local output_file

  test_repo=$(new_repo "single root history")
  output_file="$test_repo/output.txt"
  git -C "$test_repo" commit -qm 'fixture: legitimate single-root publication'
  git -C "$test_repo" tag -a v1.0.0 -m 'fixture tag'

  if run_guard_history "$test_repo" "$output_file"; then
    record_pass "single-root history with a legitimate tag passes"
  else
    record_fail "single-root history: legitimate publication was rejected" "$output_file"
  fi
}

expect_known_violation_ratchet() {
  local test_repo
  local baseline_output
  local growth_output
  local burndown_output

  test_repo=$(new_repo "known violation ratchet")
  baseline_output="$test_repo/baseline-output.txt"
  growth_output="$test_repo/growth-output.txt"
  burndown_output="$test_repo/burndown-output.txt"
  printf '%s\n' '/Users/legacy-fixture/.config/tool/settings.json' > "$test_repo/legacy-path.txt"
  git -C "$test_repo" add -A
  if ! declare_baseline "$test_repo"; then
    record_fail "$(basename "$test_repo"): the guard could not print baseline digests" "$test_repo/printed-digests.txt"
    return
  fi
  git -C "$test_repo" add -A

  if ! run_guard_with_baseline "$test_repo" "$baseline_output"; then
    record_fail "known violation ratchet: declared baseline was rejected" "$baseline_output"
    return
  fi

  printf '%s\n' '/Users/new-fixture/.config/tool/settings.json' > "$test_repo/new-path.txt"
  git -C "$test_repo" add -A
  if run_guard_with_baseline "$test_repo" "$growth_output"; then
    record_fail "known violation ratchet: a new violation was accepted" "$growth_output"
  elif grep -Fq '[publication-operational-data] new-path.txt' "$growth_output"; then
    record_pass "known violation ratchet rejects growth"
  else
    record_fail "known violation ratchet: growth failed without exact evidence" "$growth_output"
  fi

  git -C "$test_repo" rm -q -f legacy-path.txt new-path.txt
  if run_guard_with_baseline "$test_repo" "$burndown_output" \
    && grep -Fq 'known=0; burned-down=1' "$burndown_output"; then
    record_pass "known violation ratchet permits visible burn-down"
  else
    record_fail "known violation ratchet: burn-down was not visible and green" "$burndown_output"
  fi
}

expect_known_violation_content_ratchet() {
  local test_repo
  local edit_output
  local growth_output

  # r14 (GO-5): the baseline used to digest only "[class] path", so a baselined
  # file could gain a NEW private literal and still pass. The digest now covers
  # the matched tokens too.
  test_repo=$(new_repo "known violation content ratchet")
  edit_output="$test_repo/edit-output.txt"
  growth_output="$test_repo/growth-output.txt"
  printf '%s\n' '/Users/legacy-fixture/.config/tool/settings.json' > "$test_repo/legacy-path.txt"
  git -C "$test_repo" add -A
  if ! declare_baseline "$test_repo"; then
    record_fail "$(basename "$test_repo"): the guard could not print baseline digests" "$test_repo/printed-digests.txt"
    return
  fi
  git -C "$test_repo" add -A

  printf '%s\n' 'an unrelated prose line' >> "$test_repo/legacy-path.txt"
  git -C "$test_repo" add -A
  if ! run_guard_with_baseline "$test_repo" "$edit_output"; then
    record_fail "known violation content ratchet: an edit adding no new literal was rejected" "$edit_output"
    return
  fi

  printf '%s\n' '/Users/second-fixture/.ssh/config' >> "$test_repo/legacy-path.txt"
  git -C "$test_repo" add -A
  if run_guard_with_baseline "$test_repo" "$growth_output"; then
    record_fail "known violation content ratchet: a second literal in a baselined file was accepted" "$growth_output"
  elif grep -Fq '[publication-operational-data] legacy-path.txt' "$growth_output" \
    && ! grep -Fq 'second-fixture' "$growth_output"; then
    record_pass "known violation content ratchet rejects a new literal in a baselined file"
  else
    record_fail "known violation content ratchet: rejection lacked the path, or printed the literal" "$growth_output"
  fi
}

expect_history_ratchet_rejects_add_then_delete() {
  local test_repo
  local history_base
  local output_file

  test_repo=$(new_repo "history ratchet add then delete")
  output_file="$test_repo/output.txt"
  printf '%s\n' '/Users/legacy-fixture/.config/tool/settings.json' > "$test_repo/legacy-path.txt"
  git -C "$test_repo" add -A
  if ! declare_baseline "$test_repo"; then
    record_fail "$(basename "$test_repo"): the guard could not print baseline digests" "$test_repo/printed-digests.txt"
    return
  fi
  git -C "$test_repo" add -A
  git -C "$test_repo" commit -qm 'fixture: declare known publication baseline'
  history_base=$(git -C "$test_repo" rev-parse HEAD)

  printf '%s\n' '/Users/new-fixture/.config/tool/settings.json' > "$test_repo/transient-path.txt"
  git -C "$test_repo" add -A
  git -C "$test_repo" commit -qm 'fixture: add transient violation'
  git -C "$test_repo" rm -q transient-path.txt
  git -C "$test_repo" commit -qm 'fixture: delete transient violation'

  if run_guard_history_ratchet "$test_repo" "$history_base" "$output_file"; then
    record_fail "history ratchet: add-then-delete violation was accepted" "$output_file"
  elif grep -Fq '[publication-operational-data] transient-path.txt' "$output_file" \
    && grep -Fq '[history-ratchet]' "$output_file"; then
    record_pass "history ratchet rejects add-then-delete violations"
  else
    record_fail "history ratchet: rejection lacked commit/path evidence" "$output_file"
  fi
}

expect_workflow_history_fail_closed() {
  # shellcheck disable=SC2016 # GitHub expression must remain literal.
  if ! grep -Fq 'PUBLISH_BOUNDARY_HISTORY_MODE: ratchet' "$workflow"; then
    record_fail "workflow history evidence: publish job does not require ratcheted history" "$workflow"
  elif ! grep -Eq 'PUBLISH_BOUNDARY_HISTORY_BASE: [0-9a-f]{40}' "$workflow"; then
    record_fail "workflow history evidence: ratchet base is missing" "$workflow"
  elif ! grep -Fq '${{ needs.publish-boundary.result }}' "$workflow"; then
    record_fail "workflow history evidence: required aggregate ignores publish-boundary result" "$workflow"
  elif ! grep -Fq 'scripts/ci/boundary-history-base.sh "$GITHUB_EVENT_NAME" "$PUBLISH_BOUNDARY_HISTORY_BASE" "$PUSH_BEFORE"' "$workflow" \
    || ! grep -Fq 'PUSH_BEFORE: ${{ github.event.before }}' "$workflow"; then
    record_fail "workflow history evidence: ratchet base is not chosen per event (PR merge base, push range, nightly genesis)" "$workflow"
  elif ! grep -Fq "cron: \"0 2 * * *\"" "$workflow" || ! grep -Fq 'workflow_dispatch:' "$workflow"; then
    record_fail "workflow history evidence: no nightly or manual full ratchet from genesis" "$workflow"
  else
    record_pass "workflow requires history evidence and aggregates publish-boundary failure"
  fi
}

expect_reject "tracked retro" "retro-content" setup_retro
expect_reject "June relocate path" "relocate-path" setup_relocate_path
expect_reject "client archive path" "relocate-path" setup_client_archive_path
expect_reject "jobs profile server path" "relocate-path" setup_jobs_profile_server_path
expect_reject "Gmail PII" "identity-pii" setup_gmail
expect_reject "custom-domain email PII" "identity-pii" setup_custom_domain_email
expect_reject "Israeli phone PII" "identity-pii" setup_phone
expect_reject "WhatsApp JID PII" "identity-pii" setup_jid
expect_reject "binary PII" "identity-pii" setup_binary_pii
expect_reject "quote class" "operator-verbatim" setup_quote
expect_reject "external symlink" "external-symlink" setup_external_symlink
expect_reject "health marker" "health" setup_health
expect_reject "health score marker" "health" setup_health_score
expect_reject "substance marker" "substance" setup_substance
expect_reject "raw session marker" "raw-session" setup_raw_session
expect_reject "generic client marker" "client-or-third-party" setup_client_generic
expect_reject "finance rate marker" "finance-rate" setup_finance_rate
expect_reject "identity marker" "identity-pii" setup_identity_marker
expect_reject "real Supabase project identifier" "real-identifiers" setup_real_identifier
expect_reject "real Supabase identifier in markdown" "real-identifiers" setup_real_identifier_markdown
expect_reject "real Supabase project host with digit" "real-identifiers" setup_real_identifier_host
expect_reject "real Supabase pooler identifier" "real-identifiers" setup_real_identifier_pooler
expect_reject "real Google document identifier" "real-identifiers" setup_real_drive_identifier
expect_reject "real Google Drive open identifier" "real-identifiers" setup_real_drive_open_identifier
expect_reject "real Tailscale tailnet identifier" "real-identifiers" setup_real_tailnet_identifier
expect_reject "real Google Stitch project identifier" "real-identifiers" setup_real_stitch_identifier
expect_reject "credential-adjacent marker" "credential-adjacent" setup_credential_adjacent
expect_reject "private structure marker" "private-structure" setup_private_structure
expect_reject "dash-encoded private structure marker" "private-structure" setup_dash_encoded_private_structure
expect_reject "dash-encoded private subdirectory marker" "private-structure" setup_dash_encoded_private_subdirectory
expect_reject "dash-encoded home slug" "publication-operational-data" setup_dash_encoded_home_slug
expect_reject "dash-encoded bare home slug" "publication-operational-data" setup_dash_encoded_home_slug_bare
expect_reject "Telegram chat ID" "telegram_chat_id" setup_telegram_chat_id "config.ts"
expect_reject "Telegram snake-case user ID" "telegram_chat_id" setup_telegram_snake_case_user_id "config.py"
expect_reject "Telegram camel-case assignment" "telegram_chat_id" setup_telegram_camel_case_assignment "config.ts"
expect_reject "Telegram concatenated supergroup ID" "telegram_chat_id" setup_telegram_concatenated_supergroup_id "config.ts"
expect_reject "private structure slash suffix" "private_structure_slash_suffix" setup_private_structure_slash_suffix "session.jsonl"
expect_reject "private structure tilde path" "private-structure" setup_private_structure_tilde "instructions.md"
expect_reject "operator machine path" "publication-operational-data" setup_operator_machine_path "path.txt"
expect_reject "literal macOS home path" "publication-operational-data" setup_literal_home_path "path.txt"
expect_reject "live agent topology" "publication-operational-data" setup_live_agent_topology "topology.txt"
expect_reject "client engagement detail" "publication-operational-data" setup_client_engagement_detail "engagement.txt"
expect_reject "Drive folder assignment" "publication-operational-data" setup_drive_folder_assignment "drive-config.txt"
expect_reject "Drive folder table" "publication-operational-data" setup_drive_folder_table "drive-map.md"
expect_reject "tracked finding occurrence" "finding-content" setup_tracked_finding_occurrence "security-review.md"
expect_reject "tracked finding artifact" "finding-content" setup_tracked_finding_artifact "docs/security/deep-security-remediation-7609.md"
expect_reject "finding hash manifest with content" "finding-content" setup_finding_hash_manifest_with_content "security/deep-security-remediation-7609.sha256"
expect_reject "mutable external GitHub Action" "github_action_full_sha" setup_mutable_github_action ".github/workflows/fixture.yml"
expect_reject "mutable external GitHub Action flow mapping" "github_action_full_sha" setup_mutable_github_action_flow_mapping ".github/workflows/fixture.yml"
expect_reject "mutable external GitHub Action next-line value" "github_action_full_sha" setup_mutable_github_action_next_line ".github/workflows/fixture.yml"
expect_reject "mutable external GitHub Action folded scalar" "github_action_full_sha" setup_mutable_github_action_folded_scalar ".github/workflows/fixture.yml"
expect_reject "mutable external composite Action" "github_action_full_sha" setup_mutable_composite_action ".github/actions/fixture/action.yml"
expect_reject "unpinned npx MCP executable" "mcp_executable_exact_version" setup_unpinned_mcp_executable ".mcp.json.example"
expect_reject "unpinned multiline npx MCP executable" "mcp_executable_exact_version" setup_unpinned_multiline_mcp_executable "mcp-example.md"
expect_reject "unpinned npx --yes MCP executable" "mcp_executable_exact_version" setup_unpinned_npx_yes_mcp_executable "mcp-example.md"
expect_reject "unpinned bare npx MCP executable" "mcp_executable_exact_version" setup_unpinned_npx_bare_mcp_executable "mcp-example.md"
expect_reject "unpinned bunx MCP executable" "mcp_executable_exact_version" setup_unpinned_bunx_mcp_executable "mcp-example.md"
expect_reject "unpinned pnpm dlx MCP executable" "mcp_executable_exact_version" setup_unpinned_pnpm_dlx_mcp_executable "mcp-example.md"
expect_reject "unpinned JSON runner args" "mcp_executable_exact_version" setup_unpinned_json_runner_args ".mcp.json.example"
expect_reject "unpinned JSON npx --yes args" "mcp_executable_exact_version" setup_unpinned_json_npx_yes_args ".mcp.json.example"
expect_reject "unpinned JSON pnpm dlx args" "mcp_executable_exact_version" setup_unpinned_json_pnpm_dlx_args ".mcp.json.example"
expect_reject "unpinned fenced JSON runner args" "mcp_executable_exact_version" setup_unpinned_fenced_json_runner_args "mcp-example.md"
expect_accept "public-only mode omits private marker class" setup_public_hashed_marker
expect_reject "personal fixture without synthetic header" "synthetic_personal_fixture" setup_personal_fixture_without_synthetic_header "skill-evals/fixtures/coach-reflection.txt"
expect_reject "private Hebrew name marker" "client-or-third-party" setup_private_hebrew_marker "client-he.txt"
expect_reject "private examples augment the public policy" "client-or-third-party" setup_private_example_exact "client-private.txt"
expect_accept "placeholder domain" setup_clean_placeholder
expect_accept "GitHub noreply domain" setup_clean_noreply
expect_accept "machine attribution addresses" setup_clean_machine_attribution
expect_accept "forbidden abbreviations require token boundaries" setup_clean_word_boundaries
expect_accept "generic provider code is not personal data" setup_clean_provider_code
expect_accept "identifier env placeholder" setup_clean_identifier_placeholder
expect_accept "base64 project fixture is not a Supabase ref" setup_clean_synthetic_project_id
expect_accept "document identifier placeholder" setup_clean_drive_placeholder
expect_accept "publication metadata placeholders" setup_publication_metadata_placeholders
expect_accept "content-free finding hash manifest" setup_content_free_finding_hash_manifest
expect_accept "dash-encoded placeholder home slugs" setup_clean_dash_encoded_placeholders
expect_accept "pinned and local GitHub Actions" setup_pinned_and_local_github_actions
expect_accept "exact npx MCP executable versions" setup_exact_mcp_executables
expect_accept "unversioned local runner binaries" setup_local_runner_binaries
expect_accept "scoped synthetic Telegram constants" setup_synthetic_telegram_constants
expect_accept "synthetic personal fixture header" setup_personal_fixture_with_synthetic_header
expect_accept "private policy config is not scanned as content" setup_private_policy_only
expect_accept "private example markers require token boundaries" setup_private_example_boundary
expect_accept "explicit path allowlist" setup_allowlisted_fixture
expect_accept "policy config is exempt after dedicated safety validation" setup_snapshot_only
expect_config_reject "public snapshot cannot copy private markers" "public policy contains a private marker" setup_public_snapshot_private_leak
expect_locale_deterministic_config_reject "public snapshot cannot contain concrete PII"
expect_config_reject "public snapshot cannot contain a concrete home path" "public policy contains concrete PII" setup_public_snapshot_concrete_home
expect_config_reject "public policy pattern weakening" "public policy pattern fingerprint changed" setup_policy_pattern_weakening
expect_config_reject "public policy class weakening" "public policy forbidden-class set changed" setup_policy_class_weakening
expect_config_reject "known-violation baseline growth" "known-violation baseline fingerprint changed" setup_baseline_fingerprint_weakening
expect_index_reject
expect_ci_public_safe_warning
expect_private_hash_parity_reject
expect_public_policy_has_no_marker_oracle
expect_ci_private_policy_secret_reject
expect_ruby_preflight_reject
expect_missing_private_override_reject
expect_reachable_history_reject
expect_single_root_history_accept
expect_known_violation_ratchet
expect_known_violation_content_ratchet
expect_history_ratchet_rejects_add_then_delete
expect_workflow_history_fail_closed

printf 'summary: %d passed, %d failed\n' "$pass_count" "$fail_count"
if (( fail_count > 0 )); then
  exit 1
fi
