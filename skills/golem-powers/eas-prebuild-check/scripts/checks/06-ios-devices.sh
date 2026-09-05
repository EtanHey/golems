#!/usr/bin/env bash
# Check 06: iOS device registration for ad-hoc / preview builds
# Prevents: first-build failure on "no registered devices" (TaskOwl pain #3)

name="iOS devices registered (preview/ad-hoc)"

# Only relevant for preview profile — production uses App Store distribution
if [[ "$PROFILE" != "preview" && "$PROFILE" != "development" ]]; then
  record_result "$name" "SKIP" "Profile is '$PROFILE' — ad-hoc distribution not required" ""
  return 0
fi

# Check via eas device:list — timeout after 15s
devices_output="$(run_with_timeout 15 eas device:list --json 2>/dev/null || echo "[]")"

if [[ -z "$devices_output" || "$devices_output" == "[]" ]]; then
  # Fall back to non-json (older eas-cli)
  devices_output="$(run_with_timeout 15 eas device:list 2>/dev/null || echo "")"
  if echo "$devices_output" | grep -qiE "no devices|0 devices"; then
    count=0
  elif [[ -z "$devices_output" ]]; then
    # Timeout or auth error
    record_result "$name" "WARN" "Could not fetch device list (eas auth? network?)" "Run: eas whoami; eas login"
    return 0
  else
    # Non-empty non-json output — count lines that look like devices (udid-ish)
    count=$(echo "$devices_output" | grep -cE '[a-f0-9]{40}|[0-9A-Z]{8}-[0-9A-Z]{16}' || echo 0)
  fi
else
  # JSON output
  count=$(echo "$devices_output" | grep -oE '"udid"' | wc -l | tr -d ' ' || echo 0)
fi

if [[ "$count" -ge 1 ]]; then
  record_result "$name" "PASS" "$count device(s) registered for ad-hoc distribution" ""
else
  msg="0 devices registered. Preview = ad-hoc distribution; requires ≥1 UDID."
  fix="eas device:create"
  record_result "$name" "FAIL" "$msg" "$fix"
fi

return 0
