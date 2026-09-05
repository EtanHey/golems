#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
repo_root=$(cd "$script_dir/../.." && pwd -P)
guard=${BOUNDARY_GUARD:-"$repo_root/scripts/check-publish-boundary.sh"}
policy=${BOUNDARY_POLICY:-"$repo_root/scripts/publish-boundary-policy.yaml"}
workflow=${BOUNDARY_WORKFLOW:-"$repo_root/.github/workflows/security.yml"}
tmp_parent=${TMPDIR:-/tmp}
suite_root=$(mktemp -d "$tmp_parent/publish-boundary-test.XXXXXX")
pass_count=0
fail_count=0

cleanup() {
  case "$suite_root" in
    "$tmp_parent"/publish-boundary-test.*) rm -rf -- "$suite_root" ;;
    *) printf 'REFUSING unsafe cleanup path: %s\n' "$suite_root" >&2 ;;
  esac
}
trap cleanup EXIT

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

violation_hash() {
  printf '%s\n' "$1" | shasum -a 256 | awk '{print $1}'
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
  printf 'postgresql://postgres.abcde0ghijklmnopqrst:fixture@aws-0-eu.pooler.supabase.com:6543/postgres\n' > "$1/config.txt"
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
  printf '%s\n' '-Users-etanheyman-Gits-orchestrator-docs' > "$1/path.txt"
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
  local known_line='[publication-operational-data] legacy-path.txt'

  test_repo=$(new_repo "known violation ratchet")
  baseline_output="$test_repo/baseline-output.txt"
  growth_output="$test_repo/growth-output.txt"
  burndown_output="$test_repo/burndown-output.txt"
  printf '%s\n' '/Users/legacy-fixture/.config/tool/settings.json' > "$test_repo/legacy-path.txt"
  violation_hash "$known_line" > "$test_repo/scripts/publish-boundary-known-violations.sha256"
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

expect_history_ratchet_rejects_add_then_delete() {
  local test_repo
  local history_base
  local output_file
  local known_line='[publication-operational-data] legacy-path.txt'

  test_repo=$(new_repo "history ratchet add then delete")
  output_file="$test_repo/output.txt"
  printf '%s\n' '/Users/legacy-fixture/.config/tool/settings.json' > "$test_repo/legacy-path.txt"
  violation_hash "$known_line" > "$test_repo/scripts/publish-boundary-known-violations.sha256"
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
expect_history_ratchet_rejects_add_then_delete
expect_workflow_history_fail_closed

printf 'summary: %d passed, %d failed\n' "$pass_count" "$fail_count"
if (( fail_count > 0 )); then
  exit 1
fi
