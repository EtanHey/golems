#!/usr/bin/env bash
# Tests scripts/ci/boundary-history-base.sh: which commit the publish-boundary
# ratchet starts from for each workflow event.
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
repo_root=$(cd "$script_dir/../.." && pwd -P)
helper=${BOUNDARY_BASE_HELPER:-"$repo_root/scripts/ci/boundary-history-base.sh"}
tmp_parent=${TMPDIR:-/tmp}
suite_root=$(mktemp -d "$tmp_parent/boundary-history-base-test.XXXXXX")
pass_count=0
fail_count=0

cleanup() {
  case "$suite_root" in
    "$tmp_parent"/boundary-history-base-test.*) rm -rf -- "$suite_root" ;;
    *) printf 'REFUSING unsafe cleanup path: %s\n' "$suite_root" >&2 ;;
  esac
}
trap cleanup EXIT

# genesis -> pushed_before -> pr_base -> head, plus a side commit off genesis.
fixture="$suite_root/repo"
mkdir -p "$fixture"
git -C "$fixture" init -q
git -C "$fixture" config user.name "Base Fixture"
git -C "$fixture" config user.email "base-fixture@example.com"
commit() { git -C "$fixture" commit -q --allow-empty -m "$1"; git -C "$fixture" rev-parse HEAD; }
genesis=$(commit genesis)
pushed_before=$(commit before)
pr_base=$(commit pr-base)
head=$(commit head)
git -C "$fixture" update-ref refs/remotes/origin/master "$pr_base"
git -C "$fixture" switch -q --detach "$genesis"
side=$(commit side)
git -C "$fixture" switch -q --detach "$head"

expect_base() {
  local label=$1 want=$2
  shift 2
  local got
  if got=$(cd "$fixture" && bash "$helper" "$@" 2>/dev/null) && [[ $got == "$want" ]]; then
    pass_count=$((pass_count + 1))
    printf 'PASS %s\n' "$label"
  else
    fail_count=$((fail_count + 1))
    printf 'FAIL %s: want %s, got %s\n' "$label" "$want" "${got:-<error>}"
  fi
}

expect_base "push ratchets only before..HEAD" "$pushed_before" push "$genesis" "$pushed_before"
expect_base "push with all-zeros before (new branch) falls back to genesis" "$genesis" \
  push "$genesis" 0000000000000000000000000000000000000000
expect_base "push with empty before falls back to genesis" "$genesis" push "$genesis" ""
expect_base "push whose before is not an ancestor (force push) falls back to genesis" "$genesis" \
  push "$genesis" "$side"
expect_base "push whose before is missing from the clone falls back to genesis" "$genesis" \
  push "$genesis" 1234567890abcdef1234567890abcdef12345678
expect_base "pull_request ratchets from its merge base with origin/master" "$pr_base" \
  pull_request "$genesis" "$pushed_before"
expect_base "schedule ratchets from genesis" "$genesis" schedule "$genesis" "$pushed_before"
expect_base "workflow_dispatch ratchets from genesis" "$genesis" workflow_dispatch "$genesis"

# Workflow shape: superseded runs cancel, and no job can hang for the 6-hour default.
workflow=${BOUNDARY_WORKFLOW:-"$repo_root/.github/workflows/security.yml"}
if shape=$(ruby -ryaml -e '
  wf = YAML.safe_load(File.read(ARGV[0]), aliases: false)
  c = wf["concurrency"] || {}
  abort "no concurrency group" unless c["group"].to_s.include?("github.ref")
  abort "cancel-in-progress is not set" unless c.key?("cancel-in-progress")
  missing = wf["jobs"].reject { |_, j| j.key?("timeout-minutes") }.keys
  abort "jobs without timeout-minutes: #{missing.join(", ")}" unless missing.empty?
' "$workflow" 2>&1); then
  pass_count=$((pass_count + 1))
  printf 'PASS workflow cancels superseded runs and bounds every job\n'
else
  fail_count=$((fail_count + 1))
  printf 'FAIL workflow shape: %s\n' "$shape"
fi

printf 'summary: %d passed, %d failed\n' "$pass_count" "$fail_count"
(( fail_count == 0 ))
