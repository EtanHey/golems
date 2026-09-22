#!/usr/bin/env bats
setup() { REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"; HELPER="$REPO_ROOT/skills/golem-powers/session-handoff/scripts/context-occupancy.sh"; FIXTURES="$BATS_TEST_DIRNAME/fixtures/session-handoff-context"; }
@test "Codex occupancy uses last usage rather than cumulative session input" {
  run "$HELPER" "$FIXTURES/codex-current-context.jsonl"
  [ "$status" -eq 0 ] && [ "$output" = "36000/258400 13.9%" ]
}
@test "Codex input without last usage is rejected" {
  run "$HELPER" "$FIXTURES/codex-missing-last-usage.jsonl"
  [ "$status" -ne 0 ] && [[ "$output" == *"last_token_usage.total_tokens"* ]] && [[ "$output" == *"refusing cumulative total_token_usage"* ]]
}
