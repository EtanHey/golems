#!/usr/bin/env bash
# secret-scan.sh — the required "Secret Scanning" check, on the pinned
# TruffleHog v3 binary ($TRUFFLEHOG, default: trufflehog on PATH).
#
#   secret-scan.sh scan <event> <genesis> [<push-before>]
#       Scans this checkout's git history from the base that
#       boundary-history-base.sh picks (the Publish Boundary Guard's ratchet
#       base: pull_request → merge base with origin/master; push → before,
#       else genesis; schedule and workflow_dispatch → genesis) to HEAD.
#       push, schedule and workflow_dispatch also scan the working tree.
#   secret-scan.sh canary
#       Self-test. Plants runtime-generated AWS-key-shaped canaries in a
#       throwaway repo (at the root and under dist/, build/ and node_modules/)
#       and asserts the same scan functions, with the same flags, flag every one
#       in history and on disk, and that a clean tree passes. A missing, broken
#       or mis-invoked scanner, or a path exclude, fails here.
#
# Exit status: 0 clean, 1 findings, 2 tool error. A tool error is an exit
# status other than 0 or 183 (TruffleHog's --fail code), any error-level log
# line (a bad ref or an unreadable chunk still exits 0), unparseable output, or
# an exit status that disagrees with the findings printed.
#
# Findings print as GitHub annotations naming detector, file, line and commit,
# never the value: this is a public repo, and its Actions logs are public. The
# scanner's raw JSON and its logs stay in a private temp dir removed on exit; a
# tool error prints only the exit status and error count, because scanner logs
# can quote the content they failed on.
set -uo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
repo_root=$(cd "$script_dir/../.." && pwd -P)
TRUFFLEHOG=${TRUFFLEHOG:-trufflehog}

work=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/secret-scan.XXXXXX") || exit 2
trap 'rm -rf -- "$work"' EXIT

# History scans exclude no path: anything committed is public. The working-tree
# scan excludes only .git/ (git internals, which history covers; git refuses to
# track a .git path component, so no committed file can hide there). No
# vendored/generated-dir excludes: a tracked file under dist/ is as public as
# any other, and this job installs no dependencies, so its tree holds only the
# checkout. Written here, not kept as a committed file, because TruffleHog
# reads a blank line in it as a pattern that excludes everything.
printf '%s\n' '(^|/)\.git/' > "$work/tree-exclude-paths"

# --results=verified,unknown: fail on a credential the provider confirmed live,
# and on one whose verification could not finish (fail closed). A match the
# provider rejected (unverified) is not reported: test fixtures and dead keys.
# The comma is part of TruffleHog's single --results value.
# shellcheck disable=SC2054
scan_flags=(--no-update --fail --json --results=verified,unknown)
scanner_env=()
annotate=1
worst=0

note_status() { (( $1 > worst )) && worst=$1; return 0; }

# run_scanner <label> <scanner args...>: prints findings, returns 0/1/2.
run_scanner() {
  local label=$1 out="$work/$1.jsonl" log="$work/$1.log" rc=0 errors count
  shift
  env ${scanner_env[@]+"${scanner_env[@]}"} "$TRUFFLEHOG" "$@" "${scan_flags[@]}" >"$out" 2>"$log" || rc=$?

  if [[ $rc != 0 && $rc != 183 ]]; then
    printf '::error::Secret Scanning (%s): TruffleHog exited %s. Its log is not printed (it can quote scanned content); rerun the pinned version locally to see it.\n' "$label" "$rc"
    return 2
  fi
  errors=$(jq -R -c 'fromjson? | select(type == "object" and .level == "error")' "$log" | grep -c . || true)
  if (( errors > 0 )); then
    printf '::error::Secret Scanning (%s): TruffleHog logged %s error(s), so the scan is incomplete. The log is not printed (it can quote scanned content); rerun the pinned version locally to see it.\n' "$label" "$errors"
    return 2
  fi
  if ! count=$(jq -s -e 'if all(.[]; type == "object" and has("DetectorName")) then length else error("not a finding") end' "$out" 2>/dev/null); then
    printf '::error::Secret Scanning (%s): TruffleHog printed output that is not findings JSON\n' "$label"
    return 2
  fi

  jq -r --argjson annotate "$annotate" '
    (.SourceMetadata.Data.Git // .SourceMetadata.Data.Filesystem // {}) as $src
    | (if .Verified then "verified" elif ((.VerificationError // "") | tostring) != "" then "unknown" else "unverified" end) as $status
    | ($src.file // "?") as $file | ($src.line // 1) as $line
    | (if $src.commit then " at commit \($src.commit[0:12])" else "" end) as $at
    | if $annotate == 1
      then "::error file=\($file),line=\($line)::Secret Scanning: \(.DetectorName) credential (\($status))\($at). Revoke and rotate it; removing it from the tree does not remove it from history."
      else "  flagged: \(.DetectorName) (\($status)) in \($file)\($at)"
      end' "$out"
  jq -r '.DetectorName' "$out" > "$work/$label.detectors"
  jq -r '(.SourceMetadata.Data.Git // .SourceMetadata.Data.Filesystem // {}).file // ""' "$out" > "$work/$label.files"

  if [[ $rc == 0 && $count == 0 ]]; then
    printf 'Secret Scanning (%s): clean\n' "$label"
    return 0
  fi
  if [[ $rc == 183 && $count -gt 0 ]]; then
    printf 'Secret Scanning (%s): %s finding(s)\n' "$label" "$count"
    return 1
  fi
  printf '::error::Secret Scanning (%s): TruffleHog exited %s but reported %s finding(s)\n' "$label" "$rc" "$count"
  return 2
}

# scan_history <label> <repo-dir> <base> <head>: commits in base..head.
scan_history() {
  local label=$1 repo=$2 base=$3 head=$4 ref
  for ref in "$base" "$head"; do
    if ! git -C "$repo" rev-parse --verify --quiet "$ref^{commit}" >/dev/null; then
      printf '::error::Secret Scanning (%s): %s is not a commit in %s\n' "$label" "$ref" "$repo"
      return 2
    fi
  done
  run_scanner "$label" git "file://$repo" --since-commit "$base" --branch "$head"
}

# scan_tree <label> <dir>: every file on disk under dir, except .git/.
scan_tree() {
  run_scanner "$1" filesystem "$2" --exclude-paths "$work/tree-exclude-paths"
}

cmd_scan() {
  local event=${1:?usage: secret-scan.sh scan <event> <genesis> [<push-before>]}
  local genesis=${2:?usage: secret-scan.sh scan <event> <genesis> [<push-before>]}
  local before=${3:-} base head status
  if ! base=$(bash "$repo_root/scripts/ci/boundary-history-base.sh" "$event" "$genesis" "$before"); then
    printf '::error::Secret Scanning: no history base for %s\n' "$event"
    return 2
  fi
  head=$(git rev-parse --verify HEAD) || return 2
  if [[ $base == "$head" ]]; then
    printf 'Secret Scanning (history): HEAD is the base, no commits to scan\n'
  else
    printf 'Secret Scanning (history): %s..%s\n' "$base" "$head"
    status=0; scan_history history "$PWD" "$base" "$head" || status=$?; note_status "$status"
  fi
  case $event in
    push | schedule | workflow_dispatch)
      status=0; scan_tree tree . || status=$?; note_status "$status" ;;
  esac
  return "$worst"
}

canary_files=(credentials dist/credentials build/credentials node_modules/canary-pkg/credentials)

# expect_canary <want-status> <scan function and args...>: status 1 must flag
# an AWS finding in every canary file; status 0 must flag nothing.
expect_canary() {
  local want=$1 label=$3 status=0 file missing=0
  shift
  "$@" || status=$?
  if [[ $status != "$want" ]]; then
    printf '::error::Secret Scanning canary (%s): want status %s, got %s\n' "$label" "$want" "$status"
    return 1
  fi
  [[ $want == 1 ]] || return 0
  if ! grep -qx AWS "$work/$label.detectors"; then
    printf '::error::Secret Scanning canary (%s): no AWS finding\n' "$label"
    return 1
  fi
  for file in "${canary_files[@]}"; do
    if ! grep -qE "(^|/)${file//./\\.}\$" "$work/$label.files"; then
      printf '::error::Secret Scanning canary (%s): %s was not flagged\n' "$label" "$file"
      missing=1
    fi
  done
  return "$missing"
}

# rotate_canary_alphabet <alphabet> <offset>: preserves length and entropy.
rotate_canary_alphabet() {
  local alphabet=$1 offset=$2
  printf '%s%s' "${alphabet:offset}" "${alphabet:0:offset}"
}

# write_canary <path> <ordinal>: a distinct AWS-key-shaped credential with
# entropy guaranteed above TruffleHog 3.97.9's ID (3.0) and secret (4.25)
# thresholds. The fixed unique-character alphabets make the values obviously
# synthetic; rotating them per path keeps every planted pair distinct. The
# complete credential literals never exist in git and are never printed.
write_canary() {
  local target=$1 ordinal=$2 id_alphabet secret_alphabet id_suffix secret
  id_alphabet='BCDEFGHJ''LMNPQ234'
  secret_alphabet='ABCDEFGHIJKLMNOPQRST''uvwxyz0123456789/+UV'
  id_suffix=$(rotate_canary_alphabet "$id_alphabet" "$ordinal")
  secret=$(rotate_canary_alphabet "$secret_alphabet" "$ordinal")
  mkdir -p "$(dirname "$target")"
  printf '[default]\naws_access_key_id = %s\naws_secret_access_key = %s\n' \
    "AK""IA$id_suffix" "$secret" > "$target"
}

cmd_canary() {
  local repo="$work/canary-repo" clean="$work/canary-clean" base head file ordinal=0 failed=0
  mkdir -p "$repo" "$clean"
  git -C "$repo" init -q
  git -C "$repo" config user.name "Secret Scanning canary"
  git -C "$repo" config user.email "secret-scan-canary@example.com"
  printf 'secret scanning canary\n' | tee "$repo/README" > "$clean/README"
  git -C "$repo" add README && git -C "$repo" commit -q -m base || return 2
  base=$(git -C "$repo" rev-parse HEAD)
  # One per file: a scanner may report a repeated value once.
  for file in "${canary_files[@]}"; do
    write_canary "$repo/$file" "$ordinal"
    ordinal=$((ordinal + 1))
  done
  git -C "$repo" add -A && git -C "$repo" commit -q -m canary || return 2
  head=$(git -C "$repo" rev-parse HEAD)

  # Point every verification call at a closed local port, so the canary never
  # reaches AWS and its verification cannot finish: the scanner reports it as
  # unknown, which --results=verified,unknown keeps, exactly as it would keep a
  # real credential whose provider was unreachable.
  scanner_env=(HTTPS_PROXY=http://127.0.0.1:9 https_proxy=http://127.0.0.1:9
    HTTP_PROXY=http://127.0.0.1:9 http_proxy=http://127.0.0.1:9 NO_PROXY= no_proxy=)
  annotate=0

  expect_canary 1 scan_history canary-history "$repo" "$base" "$head" || failed=1
  expect_canary 1 scan_tree canary-tree "$repo" || failed=1
  expect_canary 0 scan_tree canary-clean "$clean" || failed=1
  if (( failed )); then
    printf 'canary: FAIL (the scanner cannot be trusted to catch a leak)\n'
    return 1
  fi
  printf 'canary: PASS (all %s planted keys flagged in history and on disk; clean tree passes)\n' "${#canary_files[@]}"
}

case ${1:-} in
  scan) shift; cmd_scan "$@" ;;
  canary) cmd_canary ;;
  *) printf 'usage: secret-scan.sh scan <event> <genesis> [<push-before>] | canary\n' >&2; exit 2 ;;
esac
