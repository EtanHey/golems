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

source "$script_dir/check-publish-boundary.test-parts/part-01.bash"
source "$script_dir/check-publish-boundary.test-parts/part-02.bash"
