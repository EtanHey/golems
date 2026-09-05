#!/usr/bin/env bash
# Check 08: Android keystore ready (or EAS-managed keystore configured)
# Prevents: mid-build keystore prompt surprises

name="Android keystore ready"

creds_output="$(run_with_timeout 20 eas credentials -p android --profile "$PROFILE" --non-interactive --json 2>/dev/null || echo "")"

if [[ -z "$creds_output" ]]; then
  if [[ -f "$PROJECT_DIR/credentials.json" ]] && grep -q '"android"' "$PROJECT_DIR/credentials.json"; then
    record_result "$name" "PASS" "Local credentials.json contains Android section" ""
    return 0
  fi
  record_result "$name" "WARN" "Could not query eas credentials for Android (non-interactive mode unsupported?)" "Run: eas credentials -p android --profile $PROFILE"
  return 0
fi

# Look for keystore presence or EAS-managed indicator
has_keystore=0
is_managed=0

echo "$creds_output" | grep -qiE '"keystore"|"keyAlias"' && has_keystore=1
echo "$creds_output" | grep -qiE '"managed"|"remote"' && is_managed=1

if [[ "$has_keystore" -eq 1 ]]; then
  if [[ "$is_managed" -eq 1 ]]; then
    record_result "$name" "PASS" "EAS-managed keystore configured" ""
  else
    record_result "$name" "PASS" "Local keystore configured" ""
  fi
else
  msg="No Android keystore found for profile '$PROFILE'"
  fix="eas credentials:configure -p android --profile $PROFILE  (EAS will offer to generate and manage it)"
  record_result "$name" "FAIL" "$msg" "$fix"
fi

return 0
