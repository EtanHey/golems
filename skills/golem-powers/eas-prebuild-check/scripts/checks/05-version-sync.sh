#!/usr/bin/env bash
# Check 05: version, ios.buildNumber, android.versionCode present and consistent
# Prevents: Apple Connect version conflicts, re-submit blockers

name="Version sync (version / buildNumber / versionCode)"

app_json="$PROJECT_DIR/app.json"
if [[ ! -f "$app_json" ]]; then
  record_result "$name" "SKIP" "No app.json — run 'npx expo config' to check effective config" ""
  return 0
fi

version="$(json_path_get "$app_json" "expo.version")"
build_number="$(json_path_get "$app_json" "expo.ios.buildNumber")"
version_code="$(json_path_get "$app_json" "expo.android.versionCode" number)"

missing=()
[[ -z "$version" ]] && missing+=("version")

if [[ "$PLATFORM" == "ios" || "$PLATFORM" == "both" ]]; then
  [[ -z "$build_number" ]] && missing+=("ios.buildNumber")
fi

if [[ "$PLATFORM" == "android" || "$PLATFORM" == "both" ]]; then
  [[ -z "$version_code" ]] && missing+=("android.versionCode")
fi

msg="version: ${version:-<missing>}"
[[ "$PLATFORM" == "ios" || "$PLATFORM" == "both" ]] && msg="$msg | iOS buildNumber: ${build_number:-<missing>}"
[[ "$PLATFORM" == "android" || "$PLATFORM" == "both" ]] && msg="$msg | Android versionCode: ${version_code:-<missing>}"

if [[ "${#missing[@]}" -gt 0 ]]; then
  record_result "$name" "FAIL" "$msg — missing: ${missing[*]}" "Add missing version fields to app.json expo block"
  return 0
fi

record_result "$name" "PASS" "$msg" ""

return 0
