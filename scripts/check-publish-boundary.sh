#!/usr/bin/env bash
#
# HISTORY MODES — read before choosing (learned the hard way on the 2026-09-05 public flip):
#   ratchet     — re-runs this check against every commit since PUBLISH_BOUNDARY_HISTORY_BASE
#                 using the CURRENT allowlist. The base must be reachable. On the public golems
#                 repo (an orphan built from golems-history) the base is the genesis commit.
#   single-root — asserts the repo has EXACTLY ONE reachable commit. It is a verification
#                 snapshot mode: it goes RED on the very first PR after genesis (2 commits).
#                 Do NOT use it on a live repo; it is for proving a freshly-built orphan tree
#                 before its first push.
#   current-tree — no history check; what a local run does by default. A local PASS here
#                 does not predict CI, which runs ratchet.
set -euo pipefail
export LC_ALL=C
export LANG=C

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
default_root=$(cd "$script_dir/.." && pwd -P)
repo_root=${PUBLISH_BOUNDARY_ROOT:-$default_root}
public_policy=${PUBLISH_BOUNDARY_POLICY:-"$repo_root/scripts/publish-boundary-policy.yaml"}
allowlist=${PUBLISH_BOUNDARY_ALLOWLIST:-"$repo_root/.publish-boundary-allow"}
private_policy=${PUBLISH_BOUNDARY_PRIVATE_POLICY:-}
private_policy_overridden=no
[[ -n $private_policy ]] && private_policy_overridden=yes
private_policy_yaml=${PUBLISH_BOUNDARY_PRIVATE_POLICY_YAML:-}
history_mode=${PUBLISH_BOUNDARY_HISTORY_MODE:-current-tree}
history_base=${PUBLISH_BOUNDARY_HISTORY_BASE:-}
baseline_manifest=${PUBLISH_BOUNDARY_BASELINE_MANIFEST:-}
baseline_manifest_overridden=no
[[ -n ${PUBLISH_BOUNDARY_BASELINE_MANIFEST:-} ]] && baseline_manifest_overridden=yes
ruby_bin=${PUBLISH_BOUNDARY_RUBY_BIN:-ruby}
tmp_parent=${TMPDIR:-/tmp}
scratch_dir=$(mktemp -d "$tmp_parent/publish-boundary.XXXXXX")
allowlist_normalized="$scratch_dir/allowlist.txt"
patterns_file="$scratch_dir/patterns.tsv"
allowed_patterns_file="$scratch_dir/allowed-patterns.tsv"
classes_file="$scratch_dir/classes.txt"
indexed_rules_file="$scratch_dir/indexed-rules.tsv"
hashed_markers_file="$scratch_dir/hashed-markers.tsv"
relocate_patterns="$scratch_dir/relocate-patterns.txt"
violations_file="$scratch_dir/violations.txt"
private_literals="$scratch_dir/private-literals.txt"
symlink_paths="$scratch_dir/symlink-paths.txt"
grep_paths_file="$scratch_dir/grep-paths.bin"
new_violations_file="$scratch_dir/new-violations.txt"
history_diagnostics="$scratch_dir/history-diagnostics.txt"
expected_public_policy_fingerprint='dcae1580b07b2fd737e4e53e721940a4c7f4124f30308f63d2722151be20ff10'
expected_known_violation_baseline_fingerprint='f3db6b8d5c7b51687104a3c00a0e91d0c81ac49980fac025edde1fb05fa0edfa'
expected_forbidden_classes='client-or-third-party credential-adjacent finance-rate finding-content github_action_full_sha health identity-pii mcp_executable_exact_version operator-verbatim private-structure private_structure_slash_suffix publication-operational-data raw-session real-identifiers substance synthetic_personal_fixture telegram_chat_id'
# Bash 3.2 + `set -u` rejects expansion of a truly empty array. The empty
# sentinel keeps exact-path lookup portable and can never match a tracked path.
allowlisted_paths=("")

cleanup() {
  case "$scratch_dir" in
    "$tmp_parent"/publish-boundary.*) rm -rf -- "$scratch_dir" ;;
    *) printf 'REFUSING unsafe cleanup path: %s\n' "$scratch_dir" >&2 ;;
  esac
}
trap cleanup EXIT

fail_config() {
  printf 'publish-boundary: configuration error: %s\n' "$1" >&2
  exit 2
}

grep_matches_or_fails() {
  local failure_context=$1
  local grep_exit
  shift

  if grep "$@"; then
    return 0
  else
    grep_exit=$?
    [[ $grep_exit -eq 1 ]] && return 1
    fail_config "$failure_context (grep exit $grep_exit)"
  fi
}

command -v "$ruby_bin" >/dev/null 2>&1 \
  || fail_config "required Ruby YAML parser not found: $ruby_bin"
[[ -d $repo_root ]] || fail_config "repository root does not exist: $repo_root"
repo_root=$(cd "$repo_root" && pwd -P)
if [[ -z $baseline_manifest ]]; then
  baseline_manifest="$repo_root/scripts/publish-boundary-known-violations.sha256"
elif [[ $baseline_manifest == /* ]]; then
  baseline_manifest=$(cd "$(dirname "$baseline_manifest")" && pwd -P)/$(basename "$baseline_manifest")
else
  fail_config "known-violation baseline path must be absolute"
fi
git -C "$repo_root" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || fail_config "not a git work tree: $repo_root"
case "$history_mode" in
  current-tree|ratchet|single-root) ;;
  *) fail_config "unknown history mode: $history_mode" ;;
esac
[[ -f $public_policy ]] || fail_config "public policy not found: $public_policy"
if [[ -f $baseline_manifest ]]; then
  case "$baseline_manifest" in
    "$repo_root"/*) baseline_manifest_relative=${baseline_manifest#"$repo_root"/} ;;
    *) fail_config "known-violation baseline must be tracked inside the repository" ;;
  esac
  git -C "$repo_root" ls-files --error-unmatch -- "$baseline_manifest_relative" >/dev/null 2>&1 \
    || fail_config "known-violation baseline is not tracked: $baseline_manifest_relative"
  awk '
    length($0) != 64 || $0 !~ /^[0-9a-f]+$/ { invalid = 1 }
    END { exit invalid || NR == 0 }
  ' "$baseline_manifest" \
    || fail_config "known-violation baseline must contain bare lowercase SHA-256 values"
  LC_ALL=C sort -c -u "$baseline_manifest" >/dev/null 2>&1 \
    || fail_config "known-violation baseline must be sorted and unique"
  if [[ $baseline_manifest_overridden == no ]]; then
    baseline_fingerprint=$(shasum -a 256 "$baseline_manifest" | awk '{print $1}')
    [[ $baseline_fingerprint == "$expected_known_violation_baseline_fingerprint" ]] \
      || fail_config "known-violation baseline fingerprint changed (got $baseline_fingerprint)"
  fi
elif [[ $baseline_manifest_overridden == yes || $history_mode == ratchet ]]; then
  fail_config "known-violation baseline not found: $baseline_manifest"
fi
concrete_pii_pattern='[[:alnum:]._%+-]+@gmail[.]com|\+972[[:digit:]]{7,}|[[:digit:]]{8,}@s[.]whatsapp[.]net|/Users/[[:alnum:]_.-]+/|(א|ב|ג|ד|ה|ו|ז|ח|ט|י|כ|ך|ל|מ|ם|נ|ן|ס|ע|פ|ף|צ|ץ|ק|ר|ש|ת)'
if grep_matches_or_fails "public policy safety scan failed" -a -E -q -- "$concrete_pii_pattern" "$public_policy"; then
  fail_config "public policy contains concrete PII"
fi

if [[ -n $private_policy_yaml ]]; then
  [[ -z $private_policy ]] \
    || fail_config "set only one of PUBLISH_BOUNDARY_PRIVATE_POLICY and PUBLISH_BOUNDARY_PRIVATE_POLICY_YAML"
  private_policy="$scratch_dir/private-policy.yaml"
  printf '%s\n' "$private_policy_yaml" > "$private_policy"
elif [[ -z $private_policy ]]; then
  common_git_dir=$(git -C "$repo_root" rev-parse --git-common-dir)
  if [[ $common_git_dir != /* ]]; then
    common_git_dir="$repo_root/$common_git_dir"
  fi
  common_checkout=$(cd "$common_git_dir/.." && pwd -P)
  private_policy="$common_checkout/docs.local/plan/golems-public-flip/phase-2/PUBLISH-BOUNDARY-POLICY.yaml"
fi
if [[ $private_policy_overridden == yes && ! -f $private_policy ]]; then
  fail_config "private policy override not found: $private_policy"
fi

: > "$allowlist_normalized"
if [[ -f $allowlist ]]; then
  while IFS= read -r entry || [[ -n $entry ]]; do
    entry=${entry%$'\r'}
    [[ -z $entry || $entry == \#* ]] && continue
    case "$entry" in
      /*|*..*|*'*'*|*'?'*|*'['*) fail_config "allowlist entry must be one explicit relative path: $entry" ;;
    esac
    [[ $entry != */ ]] || fail_config "allowlist entry must name a file, not a directory: $entry"
    printf '%s\n' "$entry" >> "$allowlist_normalized"
  done < "$allowlist"
fi

if [[ -s $allowlist_normalized ]]; then
  duplicates=$(sort "$allowlist_normalized" | uniq -d)
  [[ -z $duplicates ]] || fail_config "duplicate allowlist path: $duplicates"
fi
while IFS= read -r allowed_path; do
  [[ -n $allowed_path ]] && allowlisted_paths+=("$allowed_path")
done < "$allowlist_normalized"

extract_policy() {
  local policy_file=$1
  local include_examples=$2
  local include_indexed_rules=$3
  local include_hashed_markers=$4

  awk -v patterns_out="$patterns_file" -v allowed_out="$allowed_patterns_file" -v classes_out="$classes_file" -v indexed_out="$indexed_rules_file" -v hashed_out="$hashed_markers_file" -v relocate_out="$relocate_patterns" -v private_out="$private_literals" -v include_examples="$include_examples" -v include_indexed_rules="$include_indexed_rules" -v include_hashed_markers="$include_hashed_markers" '
    function unquote(value) {
      sub(/^[[:space:]]+/, "", value)
      sub(/[[:space:]]+$/, "", value)
      if ((substr(value, 1, 1) == "\047" && substr(value, length(value), 1) == "\047") ||
          (substr(value, 1, 1) == "\"" && substr(value, length(value), 1) == "\"")) {
        value = substr(value, 2, length(value) - 2)
      }
      return value
    }
    /^[^[:space:]#][^:]*:/ {
      section = $0
      sub(/:.*/, "", section)
      class_name = ""
      list_kind = ""
      next
    }
    section == "forbidden_classes" || section == "private_markers" {
      if ($0 ~ /^  [a-z0-9_-]+:/) {
        class_name = $0
        sub(/^  /, "", class_name)
        sub(/:.*/, "", class_name)
        list_kind = ""
        if (include_indexed_rules == "yes") print class_name >> classes_out
      }
      if (section == "forbidden_classes" && include_indexed_rules == "yes" && $0 ~ /^    indexed_rule:/) {
        value = $0
        sub(/^    indexed_rule:[[:space:]]*/, "", value)
        value = unquote(value)
        if (class_name != "" && value != "") print class_name "\t" value >> indexed_out
      }
      if (section == "forbidden_classes" && $0 ~ /^    (patterns|allowed_patterns):/) {
        list_kind = $0
        sub(/^    /, "", list_kind)
        sub(/:.*/, "", list_kind)
      }
      if ((section == "forbidden_classes" && $0 ~ /^      - /) || (section == "private_markers" && $0 ~ /^    - /)) {
        value = $0
        sub(/^ +-[[:space:]]*/, "", value)
        value = unquote(value)
        if (class_name != "" && value != "") {
          if (section == "forbidden_classes" && list_kind == "allowed_patterns") {
            print class_name "\t" value >> allowed_out
          } else {
            print class_name "\t" value >> patterns_out
            if (include_examples == "yes" && section == "private_markers") print class_name "\t" value >> private_out
          }
        }
      }
      if (include_examples == "yes" && class_name == "client-or-third-party" && $0 ~ /examples: "/) {
        value = $0
        sub(/^.*examples: "/, "", value)
        sub(/".*$/, "", value)
        sub(/[[:space:]]*\(.*/, "", value)
        count = split(value, items, ",")
        for (item_index = 1; item_index <= count; item_index++) {
          item = items[item_index]
          sub(/^[[:space:]]+/, "", item)
          sub(/[[:space:]]+$/, "", item)
          if (item != "") {
            print class_name "\t(^|[^[:alnum:]_])" item "([^[:alnum:]_]|$)" >> patterns_out
            print class_name "\t" item >> private_out
          }
        }
      }
    }
    section == "hashed_markers" && include_hashed_markers == "yes" {
      if ($0 ~ /^  [a-z0-9_-]+:/) {
        class_name = $0
        sub(/^  /, "", class_name)
        sub(/:.*/, "", class_name)
        hash_salt = ""
        list_kind = ""
      }
      if ($0 ~ /^    salt:/) {
        hash_salt = $0
        sub(/^    salt:[[:space:]]*/, "", hash_salt)
        hash_salt = unquote(hash_salt)
      }
      if ($0 ~ /^    sha256:/) list_kind = "sha256"
      if (list_kind == "sha256" && $0 ~ /^      - /) {
        value = $0
        sub(/^ +-[[:space:]]*/, "", value)
        value = unquote(value)
        split(value, hash_parts, ":")
        if (class_name != "" && hash_salt != "" && hash_parts[1] ~ /^[1-9][0-9]*$/ && hash_parts[2] ~ /^[0-9a-f]{64}$/) {
          print class_name "\t" hash_salt "\t" hash_parts[1] "\t" hash_parts[2] >> hashed_out
        }
      }
    }
    section == "relocate_path_patterns" && $0 ~ /^  - / {
      value = $0
      sub(/^ +-[[:space:]]*/, "", value)
      value = unquote(value)
      if (value != "") print value >> relocate_out
    }
  ' "$policy_file"
}

: > "$patterns_file"
: > "$allowed_patterns_file"
: > "$classes_file"
: > "$indexed_rules_file"
: > "$hashed_markers_file"
: > "$relocate_patterns"
: > "$private_literals"
extract_policy "$public_policy" "no" "yes" "no"
actual_forbidden_classes=$(LC_ALL=C sort -u "$classes_file" | paste -sd ' ' -)
if [[ $actual_forbidden_classes != "$expected_forbidden_classes" ]]; then
  fail_config "public policy forbidden-class set changed (got: $actual_forbidden_classes)"
fi
public_policy_fingerprint=$(
  {
    printf '%s\n' '[patterns]'
    LC_ALL=C sort "$patterns_file"
    printf '%s\n' '[allowed-patterns]'
    LC_ALL=C sort "$allowed_patterns_file"
    printf '%s\n' '[indexed-rules]'
    LC_ALL=C sort "$indexed_rules_file"
    printf '%s\n' '[relocate-path-patterns]'
    LC_ALL=C sort "$relocate_patterns"
  } | shasum -a 256 | awk '{print $1}'
)
if [[ $public_policy_fingerprint != "$expected_public_policy_fingerprint" ]]; then
  fail_config "public policy pattern fingerprint changed (got $public_policy_fingerprint)"
fi
if [[ -f $private_policy ]]; then
  extract_policy "$private_policy" "yes" "no" "yes"
  while IFS=$'\t' read -r private_class private_literal; do
    [[ -z $private_class || -z $private_literal ]] && continue
    if grep_matches_or_fails "public policy private-marker scan failed" -a -Fq -- "$private_literal" "$public_policy"; then
      fail_config "public policy contains a private marker"
    fi
  done < "$private_literals"
  [[ -s $private_literals && -s $hashed_markers_file ]] \
    || fail_config "private marker hash parity cannot run: private literals or hashes are missing"
  python3 - "$private_literals" "$hashed_markers_file" <<'PY' \
    || fail_config "private marker hash parity failed"
import hashlib
import re
import sys
import unicodedata

private_path, hashes_path = sys.argv[1:]
hashes = {}
with open(hashes_path, encoding="utf-8") as entries:
    for line in entries:
        class_name, salt, token_count, digest = line.rstrip("\n").split("\t")
        hashes.setdefault(class_name, []).append((salt, int(token_count), digest))

missing = 0
with open(private_path, encoding="utf-8") as literals:
    for line in literals:
        class_name, literal = line.rstrip("\n").split("\t", 1)
        normalized = " ".join(re.findall(
            r"\w+", unicodedata.normalize("NFKC", literal).casefold(), re.UNICODE
        ))
        token_count = len(normalized.split())
        covered = False
        for salt, count, digest in hashes.get(class_name, []):
            if count != token_count:
                continue
            if hashlib.sha256((salt + "\0" + normalized).encode()).hexdigest() == digest:
                covered = True
        missing += int(not covered)
raise SystemExit(1 if missing else 0)
PY
elif [[ ${CI:-} == true || ${CI:-} == 1 ]]; then
  printf '%s\n' '::warning title=Publish boundary private policy unavailable::private marker policy unavailable; tree-clean classes remain enforced' >&2
fi
[[ -s $patterns_file ]] || fail_config "policy contains no forbidden-class patterns"

is_allowlisted() {
  local candidate=$1
  local allowed_path
  for allowed_path in "${allowlisted_paths[@]}"; do
    [[ $candidate == "$allowed_path" ]] && return 0
  done
  return 1
}

relative_config_path() {
  local candidate=$1
  case "$candidate" in
    "$repo_root"/*) printf '%s\n' "${candidate#"$repo_root"/}" ;;
    *) return 1 ;;
  esac
}

public_policy_relative=$(relative_config_path "$(cd "$(dirname "$public_policy")" && pwd -P)/$(basename "$public_policy")" || true)
allowlist_relative=$(relative_config_path "$(cd "$(dirname "$allowlist")" && pwd -P)/$(basename "$allowlist")" || true)
private_policy_relative=''
if [[ -f $private_policy ]]; then
  private_policy_relative=$(relative_config_path "$(cd "$(dirname "$private_policy")" && pwd -P)/$(basename "$private_policy")" || true)
fi

record_violation() {
  local class_name=$1
  local path_name=$2
  printf '[%s] %s\n' "$class_name" "$path_name" >> "$violations_file"
}

matches_relocate_pattern() {
  local path_name=$1
  local path_pattern
  while IFS= read -r path_pattern; do
    [[ -z $path_pattern ]] && continue
    # Policy entries are intentionally interpreted as path globs here.
    # shellcheck disable=SC2254
    case "$path_name" in
      $path_pattern) return 0 ;;
    esac
  done < "$relocate_patterns"
  return 1
}

resolved_symlink_target() {
  local link_path=$1
  local link_target=$2
  python3 - "$link_path" "$link_target" <<'PY'
import os
import sys

link_path, link_target = sys.argv[1:]
if os.path.isabs(link_target):
    print(os.path.realpath(link_target))
else:
    print(os.path.realpath(os.path.join(os.path.dirname(link_path), link_target)))
PY
}

git_grep_paths() {
  local pattern=$1
  local output_file=$2
  local grep_exit

  if git -C "$repo_root" grep --cached -a -i -z -l -E -e "$pattern" -- . > "$output_file"; then
    return 0
  else
    grep_exit=$?
    if [[ $grep_exit -eq 1 ]]; then
      : > "$output_file"
      return 0
    fi
    fail_config "indexed candidate scan failed (git grep exit $grep_exit)"
  fi
}

is_tracked_symlink() {
  grep_matches_or_fails "tracked symlink lookup failed" -Fqx -- "$1" "$symlink_paths"
}

index_content_matches() {
  local class_name=$1
  local pattern=$2
  local tracked_path=$3
  local allowed_regex
  local pipeline_statuses

  allowed_regex=$(awk -F '\t' -v wanted="$class_name" '$1 == wanted { if (found++) printf "|"; printf "%s", $2 }' "$allowed_patterns_file")
  if [[ -z $allowed_regex ]]; then
    return 0
  fi

  if ALLOWED_REGEX="$allowed_regex" git -C "$repo_root" show ":$tracked_path" \
    | ALLOWED_REGEX="$allowed_regex" perl -0pe 'BEGIN { $allowed = qr/$ENV{ALLOWED_REGEX}/i } s/$allowed//g' \
    | grep -a -i -E -e "$pattern" >/dev/null; then
    return 0
  else
    pipeline_statuses=("${PIPESTATUS[@]}")
    if [[ ${pipeline_statuses[0]} -eq 0 && ${pipeline_statuses[1]} -eq 0 && ${pipeline_statuses[2]} -eq 1 ]]; then
      return 1
    fi
    fail_config "indexed content scan failed for $tracked_path (pipeline exits: ${pipeline_statuses[*]})"
  fi
}

github_action_full_sha_violations() {
  "$ruby_bin" - "$repo_root" <<'RUBY'
require "open3"
require "yaml"

root = ARGV.fetch(0)
paths, status = Open3.capture2("git", "-C", root, "ls-files", "-z", "--", ".github")
exit status.exitstatus unless status.success?

workflow = %r{\A\.github/workflows/[^/]+[.]ya?ml\z}
composite = %r{\A\.github/actions/.+/action[.]ya?ml\z}
full_sha = /\A[0-9a-f]{40}\z/i

walk = lambda do |value, &block|
  case value
  when Hash
    value.each do |key, child|
      block.call(child) if key.to_s == "uses"
      walk.call(child, &block)
    end
  when Array
    value.each { |child| walk.call(child, &block) }
  end
end

paths.split("\0").reject(&:empty?).each do |path|
  next unless workflow.match?(path) || composite.match?(path)
  content, show_status = Open3.capture2("git", "-C", root, "show", ":#{path}")
  exit show_status.exitstatus unless show_status.success?
  begin
    document = YAML.safe_load(content, permitted_classes: [], permitted_symbols: [], aliases: false)
  rescue Psych::Exception => error
    warn "#{path}: invalid YAML: #{error.message}"
    exit 2
  end
  violation = false
  walk.call(document) do |raw_reference|
    reference = raw_reference.to_s.strip
    next if reference.start_with?("./", "docker://")
    next unless reference.include?("/") && reference.include?("@")
    violation = true unless full_sha.match?(reference.rpartition("@").last)
  end
  puts path if violation
end
RUBY
}

mcp_executable_exact_version_violations() {
  python3 - "$repo_root" <<'PY'
import json
import re
import subprocess
import sys

root = sys.argv[1]
candidate_bytes = subprocess.run(
    ["git", "-C", root, "grep", "--cached", "-a", "-z", "-l", "-E", "-e", r'npx|bunx|pnpm[[:space:]]+dlx|mcpServers', "--", "."],
    check=False,
    stdout=subprocess.PIPE,
)
if candidate_bytes.returncode not in (0, 1):
    raise SystemExit(candidate_bytes.returncode)
candidate_bytes = candidate_bytes.stdout
paths = candidate_bytes.decode().split("\0")
package_token = r"(?:@[A-Za-z0-9._-]+/[A-Za-z0-9._-]+|[A-Za-z0-9._-]+)(?:@[^\s\\\"'`]+)?"
exact_package = re.compile(r"^(?:@[A-Za-z0-9._-]+/[A-Za-z0-9._-]+|[A-Za-z0-9._-]+)@[0-9]+\.[0-9]+\.[0-9]+$")
shell_runner = re.compile(
    rf"\b(npx(?:\s+(?:-y|--yes))?|bunx|pnpm\s+dlx)\s+([\"']?)({package_token})\2"
)

def is_mcp_package(package):
    lowered = package.lower()
    return "mcp" in lowered or "modelcontextprotocol" in lowered

def has_version_spec(package):
    if package.startswith("@"):
        return "@" in package[1:]
    return "@" in package

def runner_package(command, args):
    if not isinstance(command, str) or not isinstance(args, list):
        return None
    string_args = [item for item in args if isinstance(item, str)]
    if command == "npx":
        string_args = [item for item in string_args if item not in ("-y", "--yes")]
    elif command == "bunx":
        pass
    elif command == "pnpm" and string_args[:1] == ["dlx"]:
        string_args = string_args[1:]
    elif command == "pnpm dlx":
        pass
    else:
        return None
    return string_args[0] if string_args else None

def json_runner_packages(value, in_mcp_servers=False):
    if isinstance(value, dict):
        package = runner_package(value.get("command"), value.get("args"))
        if package and (in_mcp_servers or is_mcp_package(package)):
            yield package
        for key, child in value.items():
            yield from json_runner_packages(child, in_mcp_servers or key == "mcpServers")
    elif isinstance(value, list):
        for child in value:
            yield from json_runner_packages(child, in_mcp_servers)

for path in filter(None, paths):
    content = subprocess.check_output(["git", "-C", root, "show", f":{path}"]).decode("utf-8", "replace")
    shell_content = re.sub(r"\\\r?\n[ \t]*", " ", content)
    packages = []
    for match in shell_runner.finditer(shell_content):
        runner, package = match.group(1), match.group(3)
        auto_install_npx = re.fullmatch(r"npx\s+(?:-y|--yes)", runner) is not None
        if auto_install_npx or has_version_spec(package):
            packages.append(package)
    json_documents = [content]
    json_documents.extend(re.findall(r"```json[ \t]*\r?\n(.*?)```", content, re.IGNORECASE | re.DOTALL))
    for document in json_documents:
        try:
            packages.extend(json_runner_packages(json.loads(document)))
        except (json.JSONDecodeError, UnicodeDecodeError):
            pass
    if any(isinstance(package, str) and not exact_package.fullmatch(package) for package in packages):
        print(path)
PY
}

synthetic_personal_fixture_violations() {
  local tracked_path
  local first_line
  while IFS= read -r -d '' tracked_path; do
    is_allowlisted "$tracked_path" && continue
    first_line=$(git -C "$repo_root" show ":$tracked_path" | sed -n '1p')
    [[ $first_line == 'Synthetic fixture only'* ]] || printf '%s\n' "$tracked_path"
  done < <(git -C "$repo_root" ls-files -z -- 'skill-evals/fixtures/coach-*' 'skill-evals/fixtures/nightly-journal-*')
}

finding_artifact_violations() {
  local tracked_paths_file="$scratch_dir/tracked-finding-paths.bin"
  local manifest_content="$scratch_dir/finding-manifest.txt"
  local tracked_path

  git -C "$repo_root" ls-files -z > "$tracked_paths_file" \
    || return 1
  while IFS= read -r -d '' tracked_path; do
    case "$tracked_path" in
      *deep-security-remediation*|*deep-scan-7609*) ;;
      *) continue ;;
    esac

    if [[ $tracked_path == *.sha256 ]]; then
      git -C "$repo_root" show ":$tracked_path" > "$manifest_content" \
        || return 1
      if awk '
        BEGIN { invalid = 0 }
        length($0) != 64 || $0 !~ /^[0-9a-f]+$/ { invalid = 1 }
        END { exit invalid || NR == 0 }
      ' "$manifest_content"; then
        continue
      fi
    fi
    printf '%s\n' "$tracked_path"
  done < "$tracked_paths_file"
}

run_indexed_rule() {
  local class_name=$1
  local rule_name=$2
  local rule_output="$scratch_dir/indexed-$class_name.txt"
  local tracked_path

  case "$rule_name" in
    workflow-external-uses-full-sha)
      github_action_full_sha_violations > "$rule_output" \
        || fail_config "indexed rule failed for $class_name"
      while IFS= read -r tracked_path; do
        if [[ -n $tracked_path ]] && ! is_allowlisted "$tracked_path"; then
          record_violation "$class_name" "$tracked_path"
        fi
      done < "$rule_output"
      ;;
    runner-package-exact-version)
      mcp_executable_exact_version_violations > "$rule_output" \
        || fail_config "indexed rule failed for $class_name"
      while IFS= read -r tracked_path; do
        if [[ -n $tracked_path ]] && ! is_allowlisted "$tracked_path"; then
          record_violation "$class_name" "$tracked_path"
        fi
      done < "$rule_output"
      ;;
    synthetic-personal-fixture-header)
      synthetic_personal_fixture_violations > "$rule_output" \
        || fail_config "indexed rule failed for $class_name"
      while IFS= read -r tracked_path; do
        [[ -n $tracked_path ]] && record_violation "$class_name" "$tracked_path"
      done < "$rule_output"
      ;;
    finding-artifacts-hashes-only)
      finding_artifact_violations > "$rule_output" \
        || fail_config "indexed rule failed for $class_name"
      while IFS= read -r tracked_path; do
        if [[ -n $tracked_path ]] && ! is_allowlisted "$tracked_path"; then
          record_violation "$class_name" "$tracked_path"
        fi
      done < "$rule_output"
      ;;
    *) fail_config "unknown indexed rule for $class_name: $rule_name" ;;
  esac
}

: > "$violations_file"
: > "$symlink_paths"
while IFS= read -r -d '' index_entry; do
  file_mode=${index_entry%% *}
  tracked_path=${index_entry#*$'\t'}
  [[ $tracked_path == "$public_policy_relative" || $tracked_path == "$allowlist_relative" || $tracked_path == "$private_policy_relative" ]] && continue
  is_allowlisted "$tracked_path" && continue

  if [[ $tracked_path == skills/golem-powers/weave/retros/* && $tracked_path != skills/golem-powers/weave/retros/README.md ]]; then
    record_violation "retro-content" "$tracked_path"
  fi
  if matches_relocate_pattern "$tracked_path"; then
    record_violation "relocate-path" "$tracked_path"
  fi

  if [[ $file_mode == 120000 ]]; then
    printf '%s\n' "$tracked_path" >> "$symlink_paths"
    link_target=$(git -C "$repo_root" show ":$tracked_path")
    resolved_target=$(resolved_symlink_target "$repo_root/$tracked_path" "$link_target")
    case "$resolved_target" in
      "$repo_root"|"$repo_root"/*) ;;
      *) record_violation "external-symlink" "$tracked_path" ;;
    esac
  fi
done < <(git -C "$repo_root" ls-files -s -z)

while IFS=$'\t' read -r class_name pattern; do
  [[ -z $class_name || -z $pattern ]] && continue
  git_grep_paths "$pattern" "$grep_paths_file"
  while IFS= read -r -d '' tracked_path; do
    [[ $tracked_path == "$public_policy_relative" || $tracked_path == "$allowlist_relative" || $tracked_path == "$private_policy_relative" ]] && continue
    is_allowlisted "$tracked_path" && continue
    if ! is_tracked_symlink "$tracked_path" && index_content_matches "$class_name" "$pattern" "$tracked_path"; then
      record_violation "$class_name" "$tracked_path"
    fi
  done < "$grep_paths_file"
done < "$patterns_file"

while IFS=$'\t' read -r class_name indexed_rule; do
  [[ -z $class_name || -z $indexed_rule ]] && continue
  run_indexed_rule "$class_name" "$indexed_rule"
done < "$indexed_rules_file"

if [[ $history_mode == ratchet ]]; then
  [[ -n $history_base ]] || fail_config "ratchet history mode requires PUBLISH_BOUNDARY_HISTORY_BASE"
  shallow_repository=$(git -C "$repo_root" rev-parse --is-shallow-repository 2>/dev/null) \
    || fail_config "could not determine whether history is shallow"
  [[ $shallow_repository == false ]] \
    || fail_config "ratchet history evidence is shallow"
  resolved_history_base=$(git -C "$repo_root" rev-parse --verify "$history_base^{commit}" 2>/dev/null) \
    || fail_config "ratchet history base is not a reachable commit: $history_base"
  git -C "$repo_root" merge-base --is-ancestor "$resolved_history_base" HEAD \
    || fail_config "ratchet history base is not an ancestor of HEAD: $resolved_history_base"

  history_index="$scratch_dir/history.index"
  history_output="$scratch_dir/history-output.txt"
  while IFS= read -r history_commit; do
    [[ -n $history_commit ]] || continue
    rm -f -- "$history_index"
    GIT_INDEX_FILE="$history_index" git -C "$repo_root" read-tree "$history_commit" \
      || fail_config "could not materialize history index for $history_commit"
    if ! GIT_INDEX_FILE="$history_index" \
      PUBLISH_BOUNDARY_HISTORY_MODE=current-tree \
      PUBLISH_BOUNDARY_BASELINE_MANIFEST="$baseline_manifest" \
      "$0" >"$history_output" 2>&1; then
      printf 'commit %s:\n' "$history_commit" >> "$history_diagnostics"
      sed 's/^/  /' "$history_output" >> "$history_diagnostics"
      record_violation "history-ratchet" "$history_commit"
    fi
  done < <(git -C "$repo_root" rev-list --reverse "$resolved_history_base..HEAD")
elif [[ $history_mode == single-root ]]; then
  shallow_repository=$(git -C "$repo_root" rev-parse --is-shallow-repository 2>/dev/null) \
    || fail_config "could not determine whether history is shallow"
  if [[ $shallow_repository != false ]]; then
    record_violation "history-reachability" "shallow-history-evidence"
  else
    reachable_commit_count=$(git -C "$repo_root" rev-list --count --all HEAD 2>/dev/null) \
      || fail_config "reachable history enumeration failed"
    if [[ $reachable_commit_count != 1 ]]; then
      record_violation "history-reachability" "reachable-commit-count=$reachable_commit_count"
    fi
  fi
fi

if [[ -f $baseline_manifest ]]; then
  : > "$new_violations_file"
  known_violation_count=0
  baseline_violation_count=$(wc -l < "$baseline_manifest" | tr -d ' ')
  if [[ -s $violations_file ]]; then
    while IFS= read -r violation_line; do
      [[ -n $violation_line ]] || continue
      violation_digest=$(printf '%s\n' "$violation_line" | shasum -a 256 | awk '{print $1}')
      if grep -Fqx -- "$violation_digest" "$baseline_manifest"; then
        known_violation_count=$((known_violation_count + 1))
      else
        printf '%s\n' "$violation_line" >> "$new_violations_file"
      fi
    done < <(LC_ALL=C sort -u "$violations_file")
  fi
  burned_down_count=$((baseline_violation_count - known_violation_count))
  new_violation_count=$(wc -l < "$new_violations_file" | tr -d ' ')
  printf 'publish-boundary: BASELINE (declared=%s; known=%s; burned-down=%s; new=%s)\n' \
    "$baseline_violation_count" "$known_violation_count" "$burned_down_count" "$new_violation_count"
  cp "$new_violations_file" "$violations_file"
fi

if [[ -s $violations_file ]]; then
  [[ ! -s $history_diagnostics ]] || cat "$history_diagnostics" >&2
  sort -u "$violations_file"
  violation_count=$(sort -u "$violations_file" | wc -l | tr -d ' ')
  printf 'publish-boundary: FAIL (%s violation(s)); exceptions require exact paths in %s\n' \
    "$violation_count" "$allowlist" >&2
  exit 1
fi

tracked_count=$(git -C "$repo_root" ls-files | wc -l | tr -d ' ')
if [[ -f $private_policy ]]; then
  policy_mode='public + private augmentation'
else
  policy_mode='public-safe snapshot only'
fi
printf 'publish-boundary: PASS (%s tracked paths scanned; %s; history=%s)\n' \
  "$tracked_count" "$policy_mode" "$history_mode"
