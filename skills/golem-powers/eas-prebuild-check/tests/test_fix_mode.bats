#!/usr/bin/env bats

load helpers/test-helper.bash

@test "eval 8: --fix writes canonical easignore and touches nothing else" {
  run_skill "missing-easignore" --fix

  [ "$status" -eq 0 ]
  [[ "$output" == *".easignore exists"* ]]
  [[ "$output" == *"✓ PASS"* ]]
  [ -f "$PROJECT_DIR/.easignore" ]
  grep -q "node_modules" "$PROJECT_DIR/.easignore"
  assert_file_unchanged "missing-easignore" "app.json"
  assert_file_unchanged "missing-easignore" "package.json"
  assert_file_unchanged "missing-easignore" "App.tsx"
  assert_file_unchanged "missing-easignore" ".eas-prebuild-check.mocks"
}

@test "eval 9: --fix refuses destructive bundle-id changes" {
  original_app_json="$(cat "$FIXTURE_DIR/bundle-id-default/app.json")"

  run_skill "bundle-id-default" --fix

  [ "$status" -eq 1 ]
  [[ "$output" == *"Bundle ID consistency"* ]]
  [[ "$output" == *"user judgment"* || "$output" == *"user action"* ]]
  [ "$(cat "$PROJECT_DIR/app.json")" = "$original_app_json" ]
}
