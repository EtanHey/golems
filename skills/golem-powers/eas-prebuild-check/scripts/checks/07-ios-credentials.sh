#!/usr/bin/env bash
# Check 07: iOS credentials (cert + provisioning profile) pre-synced
# Prevents: mid-build Apple 2FA surprises, credentials fetch failures (TaskOwl pain #7, #9)

name="iOS credentials synced"

# `eas credentials -p ios --profile <p>` is interactive by default
# Newer eas-cli supports --non-interactive + --json
creds_output="$(run_with_timeout 20 eas credentials -p ios --profile "$PROFILE" --non-interactive --json 2>/dev/null || echo "")"

if [[ -z "$creds_output" ]]; then
  # Fallback: inspect credentials.json in the project root (EAS can be configured to read from there)
  if [[ -f "$PROJECT_DIR/credentials.json" ]] && grep -q '"ios"' "$PROJECT_DIR/credentials.json"; then
    record_result "$name" "PASS" "Local credentials.json contains iOS section" ""
    return 0
  fi
  record_result "$name" "WARN" "Could not query eas credentials (non-interactive mode unsupported in this eas-cli?)" "Run: eas credentials -p ios --profile $PROFILE"
  return 0
fi

# Parse — look for distribution certificate and provisioning profile presence
has_cert=0
has_profile=0
has_push_key=0

echo "$creds_output" | grep -qiE '"distributionCertificate"|"certificate".*"type".*"DISTRIBUTION"' && has_cert=1
echo "$creds_output" | grep -qiE '"provisioningProfile"' && has_profile=1
echo "$creds_output" | grep -qiE '"pushKey"|"apns"' && has_push_key=1

if [[ "$has_cert" -eq 1 && "$has_profile" -eq 1 ]]; then
  msg="Distribution cert: ✓ | Provisioning profile: ✓"
  [[ "$has_push_key" -eq 1 ]] && msg="$msg | APNs P8 key: ✓"
  record_result "$name" "PASS" "$msg" ""
else
  missing=()
  [[ "$has_cert" -eq 0 ]] && missing+=("distribution certificate")
  [[ "$has_profile" -eq 0 ]] && missing+=("provisioning profile")
  msg="Missing: ${missing[*]}"
  fix="eas credentials:configure -p ios --profile $PROFILE"
  record_result "$name" "FAIL" "$msg" "$fix"
fi

return 0
