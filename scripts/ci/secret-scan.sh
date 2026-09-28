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
#       Self-test. Plants a runtime-generated AWS-key-shaped canary in a
#       throwaway repo and asserts the same scan functions, with the same
#       flags, flag it in history and on disk, and that a clean tree passes.
#       A missing, broken or mis-invoked scanner fails here.
#
# Exit status: 0 clean, 1 findings, 2 tool error. A tool error is an exit
# status other than 0 or 183 (TruffleHog's --fail code), any error-level log
# line (a bad ref or an unreadable chunk still exits 0), unparseable output, or
# an exit status that disagrees with the findings printed.
#
# Findings print as GitHub annotations naming detector, file, line and commit,
# never the value: this is a public repo, and its Actions logs are public. The
# scanner's raw JSON stays in a private temp dir removed on exit.
set -uo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
repo_root=$(cd "$script_dir/../.." && pwd -P)
TRUFFLEHOG=${TRUFFLEHOG:-trufflehog}

work=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/secret-scan.XXXXXX") || exit 2
trap 'rm -rf -- "$work"' EXIT

# Paths never scanned, one regex per line (TruffleHog treats a blank line as a
# pattern that excludes everything, so this list is written here, not kept as a
# committed file someone could add a blank line to).
#   .git/          filesystem mode would walk git internals; history has its own scan
#   node_modules/, dist/, build/
#                  vendored or generated, carried over from the old job; none is tracked
printf '%s\n' '(^|/)\.git/' '(^|/)node_modules/' '(^|/)dist/' '(^|/)build/' > "$work/exclude-paths"

# --results=verified,unknown: fail on a credential the provider confirmed live,
# and on one whose verification could not finish (fail closed). A match the
# provider rejected (unverified) is not reported: test fixtures and dead keys.
scan_flags=(--no-update --fail --json --results=verified,unknown --exclude-paths "$work/exclude-paths")
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
    printf '::error::Secret Scanning (%s): TruffleHog exited %s\n' "$label" "$rc"
    jq -R -r 'fromjson? // . | if type == "object" then "  \(.level // "?"): \(.msg // "")" else "  \(.)" end' "$log" | tail -n 20
    return 2
  fi
  errors=$(jq -R -r 'fromjson? | select(type == "object" and .level == "error")
    | "  \(.msg // "") \(.error // "" | tostring | .[0:300])"' "$log")
  if [[ -n $errors ]]; then
    printf '::error::Secret Scanning (%s): TruffleHog logged errors, so the scan is incomplete\n%s\n' "$label" "$errors"
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

# scan_tree <label> <dir>: every file on disk under dir.
scan_tree() {
  run_scanner "$1" filesystem "$2"
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

# random_chars <tr-set> <n>
random_chars() {
  local pool
  pool=$(head -c 4096 /dev/urandom | LC_ALL=C tr -dc "$1")
  printf '%s' "${pool:0:$2}"
}

# expect_canary <want-status> <want-detector|-> <scan function and args...>
expect_canary() {
  local want=$1 detector=$2 label=$4 status=0
  shift 2
  "$@" || status=$?
  if [[ $status != "$want" ]]; then
    printf '::error::Secret Scanning canary (%s): want status %s, got %s\n' "$label" "$want" "$status"
    return 1
  fi
  if [[ $detector != - ]] && ! grep -qx "$detector" "$work/$label.detectors"; then
    printf '::error::Secret Scanning canary (%s): no %s finding\n' "$label" "$detector"
    return 1
  fi
}

cmd_canary() {
  local repo="$work/canary-repo" clean="$work/canary-clean" base head failed=0
  mkdir -p "$repo" "$clean"
  git -C "$repo" init -q
  git -C "$repo" config user.name "Secret Scanning canary"
  git -C "$repo" config user.email "secret-scan-canary@example.com"
  printf 'secret scanning canary\n' | tee "$repo/README" > "$clean/README"
  git -C "$repo" add README && git -C "$repo" commit -q -m base || return 2
  base=$(git -C "$repo" rev-parse HEAD)
  # Generated here and never printed; the literal never exists in git.
  printf '[default]\naws_access_key_id = %s\naws_secret_access_key = %s\n' \
    "AK""IA$(random_chars 'A-Z2-7' 16)" "$(random_chars 'A-Za-z0-9/+' 40)" > "$repo/credentials"
  git -C "$repo" add credentials && git -C "$repo" commit -q -m canary || return 2
  head=$(git -C "$repo" rev-parse HEAD)

  # Point every verification call at a closed local port, so the canary never
  # reaches AWS and its verification cannot finish: the scanner reports it as
  # unknown, which --results=verified,unknown keeps, exactly as it would keep a
  # real credential whose provider was unreachable.
  scanner_env=(HTTPS_PROXY=http://127.0.0.1:9 https_proxy=http://127.0.0.1:9
    HTTP_PROXY=http://127.0.0.1:9 http_proxy=http://127.0.0.1:9 NO_PROXY= no_proxy=)
  annotate=0

  expect_canary 1 AWS scan_history canary-history "$repo" "$base" "$head" || failed=1
  expect_canary 1 AWS scan_tree canary-tree "$repo" || failed=1
  expect_canary 0 - scan_tree canary-clean "$clean" || failed=1
  if (( failed )); then
    printf 'canary: FAIL (the scanner cannot be trusted to catch a leak)\n'
    return 1
  fi
  printf 'canary: PASS (flagged in history and on disk; clean tree passes)\n'
}

case ${1:-} in
  scan) shift; cmd_scan "$@" ;;
  canary) cmd_canary ;;
  *) printf 'usage: secret-scan.sh scan <event> <genesis> [<push-before>] | canary\n' >&2; exit 2 ;;
esac
