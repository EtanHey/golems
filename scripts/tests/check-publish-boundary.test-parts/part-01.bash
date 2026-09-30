new_repo() {
  local name=$1
  local test_repo="$suite_root/$name"

  mkdir -p "$test_repo/scripts"
  git -C "$test_repo" init -q
  git -C "$test_repo" config user.name "Boundary Fixture"
  git -C "$test_repo" config user.email "boundary-fixture@example.com"
  cp "$policy" "$test_repo/scripts/publish-boundary-policy.yaml"
  : > "$test_repo/.publish-boundary-allow"
  printf 'fixture repository\n' > "$test_repo/README.md"
  git -C "$test_repo" add README.md .publish-boundary-allow scripts/publish-boundary-policy.yaml
  printf '%s\n' "$test_repo"
}

run_guard() {
  local test_repo=$1
  local output_file=$2
  local private_policy=${3:-"$test_repo/private-policy.yaml"}

  if [[ -f $private_policy ]]; then
    PUBLISH_BOUNDARY_ROOT="$test_repo" \
      PUBLISH_BOUNDARY_POLICY="$test_repo/scripts/publish-boundary-policy.yaml" \
      PUBLISH_BOUNDARY_PRIVATE_POLICY="$private_policy" \
      PUBLISH_BOUNDARY_ALLOWLIST="$test_repo/.publish-boundary-allow" \
      "$guard" >"$output_file" 2>&1
  else
    PUBLISH_BOUNDARY_ROOT="$test_repo" \
      PUBLISH_BOUNDARY_POLICY="$test_repo/scripts/publish-boundary-policy.yaml" \
      PUBLISH_BOUNDARY_ALLOWLIST="$test_repo/.publish-boundary-allow" \
      "$guard" >"$output_file" 2>&1
  fi
}

run_guard_ci() {
  local test_repo=$1
  local output_file=$2

  CI=true \
    PUBLISH_BOUNDARY_ROOT="$test_repo" \
    PUBLISH_BOUNDARY_POLICY="$test_repo/scripts/publish-boundary-policy.yaml" \
    PUBLISH_BOUNDARY_ALLOWLIST="$test_repo/.publish-boundary-allow" \
    "$guard" >"$output_file" 2>&1
}

run_guard_ci_with_private_policy() {
  local test_repo=$1
  local output_file=$2
  local private_policy_yaml=$3

  CI=true \
    PUBLISH_BOUNDARY_ROOT="$test_repo" \
    PUBLISH_BOUNDARY_POLICY="$test_repo/scripts/publish-boundary-policy.yaml" \
    PUBLISH_BOUNDARY_PRIVATE_POLICY_YAML="$private_policy_yaml" \
    PUBLISH_BOUNDARY_ALLOWLIST="$test_repo/.publish-boundary-allow" \
    "$guard" >"$output_file" 2>&1
}

run_guard_history() {
  local test_repo=$1
  local output_file=$2

  PUBLISH_BOUNDARY_HISTORY_MODE=single-root \
    PUBLISH_BOUNDARY_ROOT="$test_repo" \
    PUBLISH_BOUNDARY_POLICY="$test_repo/scripts/publish-boundary-policy.yaml" \
    PUBLISH_BOUNDARY_ALLOWLIST="$test_repo/.publish-boundary-allow" \
    "$guard" >"$output_file" 2>&1
}

run_guard_with_baseline() {
  local test_repo=$1
  local output_file=$2

  PUBLISH_BOUNDARY_ROOT="$test_repo" \
    PUBLISH_BOUNDARY_POLICY="$test_repo/scripts/publish-boundary-policy.yaml" \
    PUBLISH_BOUNDARY_ALLOWLIST="$test_repo/.publish-boundary-allow" \
    PUBLISH_BOUNDARY_BASELINE_MANIFEST="$test_repo/scripts/publish-boundary-known-violations.sha256" \
    "$guard" >"$output_file" 2>&1
}

run_guard_history_ratchet() {
  local test_repo=$1
  local history_base=$2
  local output_file=$3

  PUBLISH_BOUNDARY_HISTORY_MODE=ratchet \
    PUBLISH_BOUNDARY_HISTORY_BASE="$history_base" \
    PUBLISH_BOUNDARY_ROOT="$test_repo" \
    PUBLISH_BOUNDARY_POLICY="$test_repo/scripts/publish-boundary-policy.yaml" \
    PUBLISH_BOUNDARY_ALLOWLIST="$test_repo/.publish-boundary-allow" \
    PUBLISH_BOUNDARY_BASELINE_MANIFEST="$test_repo/scripts/publish-boundary-known-violations.sha256" \
    "$guard" >"$output_file" 2>&1
}

# Declare every current violation of a fixture as known, via the guard's own
# digest printer (content classes digest their matched tokens, GO-5).
declare_baseline() {
  local test_repo=$1
  local manifest="$test_repo/scripts/publish-boundary-known-violations.sha256"

  local printed="$test_repo/printed-digests.txt"

  PUBLISH_BOUNDARY_PRINT_DIGESTS=1 \
    PUBLISH_BOUNDARY_ROOT="$test_repo" \
    PUBLISH_BOUNDARY_POLICY="$test_repo/scripts/publish-boundary-policy.yaml" \
    PUBLISH_BOUNDARY_ALLOWLIST="$test_repo/.publish-boundary-allow" \
    "$guard" > "$printed" 2>&1 || return 1
  awk '$1 ~ /^[0-9a-f]{64}$/ {print $1}' "$printed" | LC_ALL=C sort -u > "$manifest"
  [[ -s $manifest ]]
}

record_pass() {
  pass_count=$((pass_count + 1))
  printf 'ok %d - %s\n' "$pass_count" "$1"
}

record_fail() {
  fail_count=$((fail_count + 1))
  printf 'not ok %d - %s\n' "$fail_count" "$1" >&2
  if [[ -n ${2:-} && -f ${2:-} ]]; then
    sed 's/^/  /' "$2" >&2
  fi
}

expect_reject() {
  local name=$1
  local expected_class=$2
  local setup_function=$3
  local expected_path=${4:-}
  local test_repo
  local output_file

  test_repo=$(new_repo "$name")
  output_file="$test_repo/output.txt"
  "$setup_function" "$test_repo"
  git -C "$test_repo" add -A

  if run_guard "$test_repo" "$output_file"; then
    record_fail "$name: guard accepted planted $expected_class violation" "$output_file"
  elif [[ -n $expected_path ]] && grep -Fq "[$expected_class] $expected_path" "$output_file"; then
    record_pass "$name rejects $expected_class"
  elif [[ -z $expected_path ]] && grep -Fq "[$expected_class]" "$output_file"; then
    record_pass "$name rejects $expected_class"
  else
    record_fail "$name: guard failed without $expected_class evidence" "$output_file"
  fi
}

expect_accept() {
  local name=$1
  local setup_function=$2
  local test_repo
  local output_file

  test_repo=$(new_repo "$name")
  output_file="$test_repo/output.txt"
  "$setup_function" "$test_repo"
  git -C "$test_repo" add -A

  if run_guard "$test_repo" "$output_file"; then
    record_pass "$name passes"
  else
    record_fail "$name: guard rejected clean/allowlisted content" "$output_file"
  fi
}

expect_config_reject() {
  local name=$1
  local expected_message=$2
  local setup_function=$3
  local test_repo
  local output_file

  test_repo=$(new_repo "$name")
  output_file="$test_repo/output.txt"
  "$setup_function" "$test_repo"
  git -C "$test_repo" add -A

  if run_guard "$test_repo" "$output_file"; then
    record_fail "$name: guard accepted invalid configuration" "$output_file"
  elif grep -Fq "$expected_message" "$output_file"; then
    record_pass "$name rejects invalid configuration"
  else
    record_fail "$name: guard failed without expected configuration evidence" "$output_file"
  fi
}

expect_locale_deterministic_config_reject() {
  local name=$1
  local test_repo
  local output_file
  local grep_shim_dir
  local real_grep

  test_repo=$(new_repo "$name")
  output_file="$test_repo/output.txt"
  grep_shim_dir="$test_repo/grep-shim"
  real_grep=$(command -v grep)
  setup_public_snapshot_concrete_pii "$test_repo"
  git -C "$test_repo" add -A
  mkdir -p "$grep_shim_dir"
  cat > "$grep_shim_dir/grep" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

safety_scan=no
for argument in "$@"; do
  case "$argument" in
    *'@gmail[.]com'*) safety_scan=yes ;;
  esac
done

if [[ $safety_scan == yes ]]; then
  if [[ ${FAKE_GREP_MODE:-} == locale-error && ${LC_ALL:-} != C ]]; then
    printf '%s\n' 'grep: Invalid collation character' >&2
    exit 2
  fi
  if [[ ${FAKE_GREP_MODE:-} == always-error ]]; then
    printf '%s\n' 'grep: simulated read error' >&2
    exit 2
  fi
fi

exec "$REAL_GREP" "$@"
SH
  chmod +x "$grep_shim_dir/grep"

  if LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 \
    PATH="$grep_shim_dir:$PATH" REAL_GREP="$real_grep" FAKE_GREP_MODE=locale-error \
    PUBLISH_BOUNDARY_ROOT="$test_repo" \
    PUBLISH_BOUNDARY_POLICY="$test_repo/scripts/publish-boundary-policy.yaml" \
    PUBLISH_BOUNDARY_ALLOWLIST="$test_repo/.publish-boundary-allow" \
    "$guard" >"$output_file" 2>&1; then
    record_fail "$name: guard accepted invalid configuration under a UTF-8 locale" "$output_file"
    return
  elif ! grep -Fq 'public policy contains concrete PII' "$output_file"; then
    record_fail "$name: guard did not reject concrete PII under a UTF-8 locale" "$output_file"
    return
  fi

  if LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 \
    PATH="$grep_shim_dir:$PATH" REAL_GREP="$real_grep" FAKE_GREP_MODE=always-error \
    PUBLISH_BOUNDARY_ROOT="$test_repo" \
    PUBLISH_BOUNDARY_POLICY="$test_repo/scripts/publish-boundary-policy.yaml" \
    PUBLISH_BOUNDARY_ALLOWLIST="$test_repo/.publish-boundary-allow" \
    "$guard" >"$output_file" 2>&1; then
    record_fail "$name: guard accepted invalid configuration after grep errored" "$output_file"
  elif grep -Fq 'public policy safety scan failed (grep exit 2)' "$output_file"; then
    record_pass "$name rejects invalid configuration under UTF-8 and fails closed on grep errors"
  else
    record_fail "$name: guard failed without grep-error configuration evidence" "$output_file"
  fi
}

setup_retro() {
  mkdir -p "$1/skills/golem-powers/weave/retros"
  printf 'private retrospective\n' > "$1/skills/golem-powers/weave/retros/fixture.md"
}

setup_relocate_path() {
  mkdir -p "$1/skills/golem-powers/weave/registry"
  printf 'historical operator registry\n' > "$1/skills/golem-powers/weave/registry/RULES.md"
}

setup_client_archive_path() {
  mkdir -p "$1/skills/golem-powers/_archive/client-management/workflows"
  printf 'private client workflow\n' \
    > "$1/skills/golem-powers/_archive/client-management/workflows/daily-update.md"
}

setup_jobs_profile_server_path() {
  mkdir -p "$1/packages/jobs/src"
  printf 'export const profileFallback = true;\n' > "$1/packages/jobs/src/mcp-server.ts"
}

setup_gmail() {
  printf 'different.person+guard@gmail.com\n' > "$1/contact.txt"
}

setup_custom_domain_email() {
  printf 'maintainer-contact@project.invalid\n' > "$1/contact.txt"
}

setup_phone() {
  printf 'mobile: +972541234567\n' > "$1/contact.txt"
}

setup_jid() {
  printf 'jid: 972541234567@s.whatsapp.net\n' > "$1/contact.txt"
}

setup_binary_pii() {
  printf '\000owner-contact@gmail.com\000' > "$1/binary-ish.dat"
}

setup_quote() {
  printf 'Operator correction: WTAF happened here\n' > "$1/transcript.txt"
}

setup_external_symlink() {
  ln -s /etc/hosts "$1/outside-link"
}

setup_health() {
  printf 'recovery: 94%%\n' > "$1/profile.txt"
}

setup_health_score() {
  printf 'sleep score: 62%%\n' > "$1/profile.txt"
}

setup_substance() {
  printf 'weed frequency: most evenings\n' > "$1/profile.txt"
}

setup_raw_session() {
  printf 'raw type:user transcript excerpt\n' > "$1/session.txt"
}

setup_client_generic() {
  printf 'client name: Example Customer\n' > "$1/client.txt"
}

setup_finance_rate() {
  printf 'billing rate: 160 NIS/hr\n' > "$1/contract.txt"
}

setup_identity_marker() {
  printf 'home address: fixture street\n' > "$1/profile.txt"
}

setup_real_identifier() {
  printf '{"projectId":"abcdefghijklmnopqrst"}\n' > "$1/config.json"
}

setup_real_identifier_markdown() {
  printf '| Supabase | Database (project: abcdefghijklmnopqrst) |\n' > "$1/context.md"
}

setup_real_identifier_host() {
  printf 'db.abcde0ghijklmnopqrst.supabase.co\n' > "$1/config.txt"
}

setup_real_identifier_pooler() {
  # The scheme is filled in at runtime so the committed line is not a connection
  # string for Secret Scanning to flag; the file the check reads is unchanged.
  printf '%s://postgres.abcde0ghijklmnopqrst:fixture@aws-0-eu.pooler.supabase.com:6543/postgres\n' postgresql > "$1/config.txt"
}

setup_real_drive_identifier() {
  printf 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit\n' > "$1/link.txt"
}

setup_real_drive_open_identifier() {
  printf 'https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz012345\n' > "$1/link.txt"
}

setup_real_tailnet_identifier() {
  printf 'dashboard: https://workstation.tail123abc.ts.net/report.html\n' > "$1/config.txt"
}

setup_real_stitch_identifier() {
  printf 'Google Stitch projectId: projects/12345678901234567890\n' > "$1/config.txt"
}

setup_credential_adjacent() {
  printf 'PRIVATE_TOKEN=sk-fixturevalue123456789012\n' > "$1/config.txt"
}

setup_private_structure() {
  printf '/Users/example/Gits/orchestrator/docs.local/plan.md\n' > "$1/path.txt"
}

setup_dash_encoded_private_structure() {
  printf '%s\n' '-Users-example-Gits-coach/example-session.jsonl' > "$1/path.txt"
}

setup_dash_encoded_private_subdirectory() {
  printf '%s\n' '-Users-example-Gits-orchestrator-docs' > "$1/path.txt"
}

# Claude Code names project and scratch dirs after the cwd with / turned into
# -, so /Users/<name>/Gits/<repo> becomes -Users-<name>-Gits-<repo>.
setup_dash_encoded_home_slug() {
  printf '%s\n' '/private/tmp/claude-501/-Users-someowner-Gits-somerepo/x.txt' > "$1/path.txt"
}

setup_dash_encoded_home_slug_bare() {
  printf '%s\n' 'ls ~/.claude/projects/-Users-someowner/' > "$1/path.txt"
}

setup_clean_dash_encoded_placeholders() {
  printf '%s\n' \
    '~/.claude/projects/-Users-example-Gits-golems/session.jsonl' \
    '/private/tmp/claude-501/-Users-x-Gits-golems/x.txt' > "$1/path.txt"
}

setup_telegram_chat_id() {
  printf 'const telegramChatId: 9876543210\n' > "$1/config.ts"
}

setup_telegram_snake_case_user_id() {
  printf 'telegram_chat_id = "9876543210"\n' > "$1/config.py"
}

setup_telegram_camel_case_assignment() {
  printf 'const chatId = 9876543210\n' > "$1/config.ts"
}

setup_telegram_concatenated_supergroup_id() {
  printf '%s\n' 'const chatId = "-100" + "1234567890"' > "$1/config.ts"
}

setup_private_structure_slash_suffix() {
  printf '%s\n' '{"cwd":"/Users/example/Gits/coach"}' > "$1/session.jsonl"
}

setup_private_structure_tilde() {
  # shellcheck disable=SC2088 # The fixture must contain a literal tracked tilde path.
  printf '%s\n' '~/Gits/orchestrator/AGENTS.md' > "$1/instructions.md"
}

setup_operator_machine_path() {
  printf '%s\n' '/Users/operator-fixture/Gits/golems/docs.local/live-plan.md' > "$1/path.txt"
}

setup_literal_home_path() {
  printf '%s\n' '/Users/operator-fixture/.config/tool/settings.json' > "$1/path.txt"
}

setup_live_agent_topology() {
  printf '%s\n' 'worker golemsCodex-deadbeef is attached to surface:757' > "$1/topology.txt"
}

setup_client_engagement_detail() {
  printf '%s\n' 'client engagement incident: Synthetic Customer escalation' > "$1/engagement.txt"
}

setup_drive_folder_assignment() {
  printf '%s\n' 'archive_folder_id = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345"' > "$1/drive-config.txt"
}

setup_drive_folder_table() {
  printf '%s\n' \
    '| Folder | id |' \
    '|---|---|' \
    '| 01_STANDARDS | 1AbCdEfGhIjKlMnOpQrStUvWxYz012345 |' \
    > "$1/drive-map.md"
}

setup_publication_metadata_placeholders() {
  # shellcheck disable=SC2016 # These are literal placeholder fixtures.
  printf '%s\n' \
    'workspace: ${GOLEMS_WORKSPACE_ROOT}' \
    'worker: <AGENT_ID>' \
    'client: Synthetic Customer' \
    'archive_folder_id: ${GOLEMS_ARCHIVE_FOLDER_ID}' \
    > "$1/publication-config.txt"
}

setup_tracked_finding_occurrence() {
  printf '%s\n' \
    'occ_0123456789abcdef01234567 | source/path.ts | confirmed | open' \
    > "$1/security-review.md"
}

setup_tracked_finding_artifact() {
  mkdir -p "$1/docs/security"
  printf '%s\n' 'validated security remediation details' \
    > "$1/docs/security/deep-security-remediation-7609.md"
}

setup_finding_hash_manifest_with_content() {
  mkdir -p "$1/security"
  printf '%s  %s\n' \
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' \
    'docs.local/plan/deep-security-remediation-7609/findings.md' \
    > "$1/security/deep-security-remediation-7609.sha256"
}

setup_content_free_finding_hash_manifest() {
  mkdir -p "$1/security"
  printf '%s\n' \
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' \
    'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789' \
    > "$1/security/deep-security-remediation-7609.sha256"
}

setup_mutable_github_action() {
  mkdir -p "$1/.github/workflows"
  printf '%s\n' 'steps:' '  - uses: example/action@main' > "$1/.github/workflows/fixture.yml"
}

setup_mutable_github_action_flow_mapping() {
  mkdir -p "$1/.github/workflows"
  printf '%s\n' 'steps:' '  - {uses: example/action@main}' > "$1/.github/workflows/fixture.yml"
}

setup_mutable_github_action_next_line() {
  mkdir -p "$1/.github/workflows"
  printf '%s\n' 'steps:' '  - uses:' '      example/action@main' > "$1/.github/workflows/fixture.yml"
}

setup_mutable_github_action_folded_scalar() {
  mkdir -p "$1/.github/workflows"
  printf '%s\n' 'steps:' '  - uses: >-' '      example/action@main' > "$1/.github/workflows/fixture.yml"
}

setup_mutable_composite_action() {
  mkdir -p "$1/.github/actions/fixture"
  printf '%s\n' \
    'name: Fixture' \
    'runs:' \
    '  using: composite' \
    '  steps:' \
    '    - uses: example/action@main' \
    > "$1/.github/actions/fixture/action.yml"
}

setup_unpinned_mcp_executable() {
  printf '%s\n' '{"mcpServers":{"fixture":{"command":"npx","args":["-y","example-mcp@latest"]}}}' \
    > "$1/.mcp.json.example"
}

setup_unpinned_multiline_mcp_executable() {
  # shellcheck disable=SC1003 # The fixture intentionally ends its first line with a backslash.
  printf '%s\n' 'npx -y \' '  @example/mcp@latest --help' > "$1/mcp-example.md"
}

setup_unpinned_npx_yes_mcp_executable() {
  printf 'npx --yes some-pkg@latest --help\n' > "$1/mcp-example.md"
}

setup_unpinned_npx_bare_mcp_executable() {
  printf 'npx some-pkg@latest --help\n' > "$1/mcp-example.md"
}

setup_unpinned_bunx_mcp_executable() {
  printf 'bunx some-pkg@latest --help\n' > "$1/mcp-example.md"
}

setup_unpinned_pnpm_dlx_mcp_executable() {
  printf 'pnpm dlx some-pkg@latest --help\n' > "$1/mcp-example.md"
}

setup_unpinned_json_runner_args() {
  printf '%s\n' '{"mcpServers":{"fixture":{"command":"bunx","args":["some-pkg@latest"]}}}' \
    > "$1/.mcp.json.example"
}

setup_unpinned_json_npx_yes_args() {
  printf '%s\n' '{"mcpServers":{"fixture":{"command":"npx","args":["--yes","some-pkg@latest"]}}}' \
    > "$1/.mcp.json.example"
}

setup_unpinned_json_pnpm_dlx_args() {
  printf '%s\n' '{"mcpServers":{"fixture":{"command":"pnpm","args":["dlx","some-pkg@latest"]}}}' \
    > "$1/.mcp.json.example"
}

setup_unpinned_fenced_json_runner_args() {
  printf '%s\n' \
    'Example configuration:' \
    '```json' \
    '{"mcpServers":{"fixture":{"command":"bunx","args":["some-pkg@latest"]}}}' \
    '```' \
    > "$1/mcp-example.md"
}

setup_synthetic_telegram_constants() {
  printf '%s\n' \
    'const groupChatId = -1001234567890' \
    'const telegram_chat_id = 123456789' \
    > "$1/config.ts"
}

setup_public_hashed_marker() {
  printf 'Boundary Hash Fixture\n' > "$1/client.txt"
}

setup_personal_fixture_without_synthetic_header() {
  mkdir -p "$1/skill-evals/fixtures"
  printf 'fictional user asks for a short reflection\n' > "$1/skill-evals/fixtures/coach-reflection.txt"
}

setup_pinned_and_local_github_actions() {
  mkdir -p "$1/.github/workflows" "$1/.github/actions/local"
  printf '%s\n' \
    'steps:' \
    '  - uses: example/action@0123456789abcdef0123456789abcdef01234567 # v1' \
    '  - uses: ./.github/actions/local' \
    > "$1/.github/workflows/fixture.yml"
}

setup_exact_mcp_executables() {
  printf '%s\n' '{"mcpServers":{"fixture":{"command":"npx","args":["-y","example-mcp@1.2.3"]}}}' \
    > "$1/.mcp.json.example"
  printf '%s\n' \
    'npx -y @example/mcp@2.3.4 --help' \
    'npx --yes @example/mcp@2.3.4 --help' \
    'npx @example/mcp@2.3.4 --help' \
    'bunx @example/mcp@2.3.4 --help' \
    'pnpm dlx @example/mcp@2.3.4 --help' \
    > "$1/mcp-example.md"
}

setup_local_runner_binaries() {
  printf '%s\n' \
    'npx convex dev' \
    'bunx remotion render' \
    'pnpm dlx eslint .' \
    > "$1/local-tools.md"
}

setup_personal_fixture_with_synthetic_header() {
  mkdir -p "$1/skill-evals/fixtures"
  printf 'Synthetic fixture only: fictional reflection.\n' > "$1/skill-evals/fixtures/nightly-journal-reflection.txt"
}

setup_private_hebrew_marker() {
  cat > "$1/private-policy.yaml" <<'YAML'
hashed_markers:
  client-or-third-party:
    salt: 'fixture-private-v1'
    sha256:
      - '2:5550be575b49e030f7891eca5520b14c084e46461ca8fa7384e933c9fa1e8df4'
private_markers:
  client-or-third-party:
    - 'אלון לוי'
YAML
  printf 'לקוח: אלון לוי\n' > "$1/client-he.txt"
}

setup_private_policy_only() {
  cat > "$1/private-policy.yaml" <<'YAML'
hashed_markers:
  client-or-third-party:
    salt: 'fixture-private-v1'
    sha256:
      - '2:5550be575b49e030f7891eca5520b14c084e46461ca8fa7384e933c9fa1e8df4'
private_markers:
  client-or-third-party:
    - 'אלון לוי'
YAML
}

setup_private_example_exact() {
  cat > "$1/private-policy.yaml" <<'YAML'
hashed_markers:
  client-or-third-party:
    salt: 'fixture-private-v1'
    sha256:
      - '1:2083e123c75f155e32e49c40ae258e54c9cd25525f0f94dad2ff3ef6146b8dc9'
forbidden_classes:
  client-or-third-party: {disposition: GENERALIZE, examples: "Acme"}
YAML
  printf 'client: Acme\n' > "$1/client-private.txt"
}

setup_private_example_boundary() {
  cat > "$1/private-policy.yaml" <<'YAML'
hashed_markers:
  client-or-third-party:
    salt: 'fixture-private-v1'
    sha256:
      - '1:2083e123c75f155e32e49c40ae258e54c9cd25525f0f94dad2ff3ef6146b8dc9'
forbidden_classes:
  client-or-third-party: {disposition: GENERALIZE, examples: "Acme"}
YAML
  printf 'AcmeToolkit is a synthetic provider component\n' > "$1/provider.txt"
}

setup_public_snapshot_private_leak() {
  cat > "$1/private-policy.yaml" <<'YAML'
hashed_markers:
  client-or-third-party:
    salt: 'fixture-private-v1'
    sha256:
      - '1:2083e123c75f155e32e49c40ae258e54c9cd25525f0f94dad2ff3ef6146b8dc9'
private_markers:
  client-or-third-party:
    - 'Acme'
YAML
  printf "\nleaked_private_example: 'Acme'\n" >> "$1/scripts/publish-boundary-policy.yaml"
}

setup_public_snapshot_concrete_pii() {
  printf "\nleaked_contact: 'owner-contact@gmail.com'\n" >> "$1/scripts/publish-boundary-policy.yaml"
}

setup_public_snapshot_concrete_home() {
  printf "\nleaked_home: '/Users/arbitrary-user/private'\n" >> "$1/scripts/publish-boundary-policy.yaml"
}

setup_policy_pattern_weakening() {
  perl -0pi -e 's{\Q[[:alnum:]._%+-]+@[[:alnum:].-]+[.][[:alpha:]]{2,}\E}{owner-contact\@gmail[.]com}' "$1/scripts/publish-boundary-policy.yaml"
}

