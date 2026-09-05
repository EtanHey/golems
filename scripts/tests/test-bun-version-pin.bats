#!/usr/bin/env bats

# One bun version for the repo. `.bun-version` is the source of truth; every
# workflow resolves it through setup-bun's `bun-version-file`. A literal
# `bun-version:` anywhere in .github/workflows/ is the drift this suite exists
# to stop -- three of them disagreed (1.0.25, 1.3.14, latest) while a bats test
# asserted the committed Twitch chat bundle was byte-identical to a fresh build,
# an assertion no repo can hold across three bun versions.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  WORKFLOWS="$REPO_ROOT/.github/workflows"
  PIN_FILE="$REPO_ROOT/.bun-version"
}

@test "repo pins one bun version in .bun-version" {
  [ -f "$PIN_FILE" ]

  pinned="$(tr -d '[:space:]' < "$PIN_FILE")"
  [[ "$pinned" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]

  # A trailing newline and nothing else -- setup-bun feeds this file verbatim.
  [ "$(wc -l < "$PIN_FILE" | tr -d ' ')" -eq 1 ]
}

@test "package.json packageManager agrees with .bun-version" {
  pinned="$(tr -d '[:space:]' < "$PIN_FILE")"

  run grep -F "\"packageManager\": \"bun@$pinned\"" "$REPO_ROOT/package.json"
  [ "$status" -eq 0 ]
}

@test "no workflow carries a literal bun version" {
  run grep -rn --include='*.yml' --include='*.yaml' -E '^[[:space:]]*bun-version:' "$WORKFLOWS"
  [ "$status" -ne 0 ]
}

@test "every setup-bun step resolves the pin through bun-version-file" {
  run bash -c 'grep -rl --include="*.yml" --include="*.yaml" -F "oven-sh/setup-bun" "$1"' _ "$WORKFLOWS"
  [ "$status" -eq 0 ]
  [ -n "$output" ]

  while IFS= read -r workflow; do
    setup_steps="$(grep -c -F 'oven-sh/setup-bun' "$workflow")"
    pin_reads="$(grep -c -E '^[[:space:]]*bun-version-file:[[:space:]]*\.bun-version$' "$workflow")"
    [ "$setup_steps" -eq "$pin_reads" ]
  done <<< "$output"
}

@test "setup-bun stays on its pinned action SHA" {
  run bash -c 'grep -rhn --include="*.yml" --include="*.yaml" -E "uses:[[:space:]]*oven-sh/setup-bun" "$1" | grep -cvE "oven-sh/setup-bun@[0-9a-f]{40}"' _ "$WORKFLOWS"
  [ "$output" = "0" ]
}
