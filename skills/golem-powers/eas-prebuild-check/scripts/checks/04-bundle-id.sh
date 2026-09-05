#!/usr/bin/env bash
# Check 04: Bundle ID sanity — not a suspicious scaffold default
# Prevents: building under wrong App Store ID, can't submit (TaskOwl pain #8)

name="Bundle ID consistency"

# Suspicious defaults that indicate a forgotten scaffold
SUSPICIOUS_PATTERNS=(
  "com\\.anonymous\\."
  "com\\.example\\."
  "com\\.yourname\\."
  "com\\.expo\\."
  "\\.fromtoday$"
  "\\.myapp$"
  "com\\.reactnative\\."
)

app_json="$PROJECT_DIR/app.json"
if [[ ! -f "$app_json" ]]; then
  # Might use app.config.js — can't static-check reliably
  record_result "$name" "SKIP" "No app.json (app.config.js/ts detected) — run 'npx expo config' to view effective config" ""
  return 0
fi

ios_id="$(json_path_get "$app_json" "expo.ios.bundleIdentifier")"
android_id="$(json_path_get "$app_json" "expo.android.package")"

if [[ -z "$ios_id" && -z "$android_id" ]]; then
  record_result "$name" "WARN" "No bundleIdentifier or package in app.json" "Add expo.ios.bundleIdentifier and expo.android.package"
  return 0
fi

suspicious_ios=""
suspicious_android=""

for pattern in "${SUSPICIOUS_PATTERNS[@]}"; do
  if [[ -n "$ios_id" ]] && echo "$ios_id" | grep -qE "$pattern"; then
    suspicious_ios="$pattern"
  fi
  if [[ -n "$android_id" ]] && echo "$android_id" | grep -qE "$pattern"; then
    suspicious_android="$pattern"
  fi
done

msg="iOS: ${ios_id:-<missing>} | Android: ${android_id:-<missing>}"

if [[ -n "$suspicious_ios" || -n "$suspicious_android" ]]; then
  record_result "$name" "WARN" "$msg — matches suspicious scaffold default" "Edit app.json: expo.ios.bundleIdentifier and expo.android.package"
elif [[ "$ios_id" != "$android_id" && -n "$ios_id" && -n "$android_id" ]]; then
  # Not strictly wrong — iOS and Android IDs can differ — but worth flagging for consistency
  record_result "$name" "INFO" "$msg — iOS and Android bundle IDs differ (intentional?)" ""
else
  record_result "$name" "PASS" "$msg" ""
fi

return 0
