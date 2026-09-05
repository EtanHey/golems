#!/usr/bin/env bats

load helpers/test-helper.bash

@test "eval 10: json mode is machine readable" {
  run_skill "happy-path" --json

  [ "$status" -eq 0 ]
  echo "$output" | jq . >/dev/null
  [ "$(echo "$output" | jq '.checks | length')" -ge 9 ]
  [ "$(echo "$output" | jq '.summary.pass')" -ge 1 ]
  [ "$(echo "$output" | jq '.summary.warn')" -ge 1 ]
  [ "$(echo "$output" | jq '.summary.fail')" -eq 0 ]
}
