#!/usr/bin/env bats

load helpers/test-helper.bash

@test "eval 1: missing-easignore-detected flags FAIL" {
  run_skill "missing-easignore"

  [ "$status" -eq 1 ]
  [[ "$output" == *"[1/9]"* ]]
  [[ "$output" == *"✗ FAIL"* ]]
  [[ "$output" == *".easignore"* ]]
  [[ "$output" == *"DO NOT run"* ]]
}

@test "eval 2: partial easignore warns and names node_modules" {
  run_skill "partial-easignore"

  [ "$status" -eq 0 ]
  [[ "$output" == *"[1/9]"* ]]
  [[ "$output" == *"⚠ WARN"* ]]
  [[ "$output" == *"node_modules"* ]]
}

@test "eval 3: suspicious bundle id is warned with app.json fix" {
  run_skill "bundle-id-default"

  [ "$status" -eq 1 ]
  [[ "$output" == *"Bundle ID consistency"* ]]
  [[ "$output" == *"⚠ WARN"* ]]
  [[ "$output" == *"suspicious"* ]]
  [[ "$output" == *"app.json"* ]]
  [[ "$output" == *"bundleIdentifier"* ]]
}

@test "eval 4: missing version fields fails loudly" {
  run_skill "no-version-fields"

  [ "$status" -eq 1 ]
  [[ "$output" == *"Version sync"* ]]
  [[ "$output" == *"✗ FAIL"* ]]
  [[ "$output" == *"ios.buildNumber"* ]]
  [[ "$output" == *"android.versionCode"* ]]
}

@test "eval 5: preview profile with no iOS devices fails check 6" {
  run_skill "no-ios-devices" --platform ios --profile preview

  [ "$status" -eq 1 ]
  [[ "$output" == *"iOS devices registered"* ]]
  [[ "$output" == *"✗ FAIL"* ]]
  [[ "$output" == *"eas device:create"* ]]
}

@test "eval 6: production profile skips device check" {
  run_skill "no-ios-devices" --platform ios --profile production

  [ "$status" -eq 0 ]
  [[ "$output" == *"iOS devices registered"* ]]
  [[ "$output" == *"⊘ SKIPPED"* ]]
  [[ "$output" == *"ad-hoc distribution not required"* ]]
}

@test "eval 7: outdated eas-cli is a warn with upgrade command" {
  run_skill "happy-path"

  [ "$status" -eq 0 ]
  [[ "$output" == *"eas-cli version up to date"* ]]
  [[ "$output" == *"⚠ WARN"* ]]
  [[ "$output" == *"npm install -g eas-cli@latest"* ]]
}

@test "eval 11: managed workflow still runs check 1 and all 9 checks" {
  run_skill "managed-workflow"

  [ "$status" -eq 0 ]
  [[ "$output" == *"[1/9]"* ]]
  [[ "$output" == *"[9/9]"* ]]
  [[ "$output" == *".easignore exists"* ]]
}

@test "check 6 counts zero devices in non-JSON eas output without an arithmetic error" {
  # Non-JSON device:list output with no UDID made `grep -c … || echo 0` print
  # "0" twice, so `[[ "0<newline>0" -ge 1 ]]` raised a syntax error.
  run bash -c '
    PROFILE=preview
    run_with_timeout() { shift; "$@"; }
    eas() {
      case "$*" in
        "device:list --json") echo "[]" ;;
        "device:list") echo "Fetching devices for account example" ;;
      esac
    }
    record_result() { printf "%s|%s|%s\n" "$1" "$2" "$3"; }
    run_check() { source "$1"; }
    run_check "$1"
  ' _ "$SKILL_DIR/scripts/checks/06-ios-devices.sh"

  [ "$status" -eq 0 ]
  grep -F -q "|FAIL|0 devices registered" <<< "$output"
  run grep -F "syntax error" <<< "$output"
  [ "$status" -ne 0 ]
}
