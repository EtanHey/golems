#!/usr/bin/env bash
# Check 09: Concurrency awareness — free vs paid tier, parallel iOS+Android?
# Prevents: surprise serial queue times (TaskOwl pain #5)
# This is INFORMATIONAL — never FAILs, just informs expectations

name="Concurrency awareness"

# Try to parse account tier from eas whoami or eas account:view
whoami_output="$(run_with_timeout 10 eas whoami 2>/dev/null || echo "")"

if [[ -z "$whoami_output" ]]; then
  record_result "$name" "WARN" "Not logged in to EAS (eas whoami returned nothing)" "Run: eas login"
  return 0
fi

# eas account:view may not exist in older versions; try as optional
account_output="$(run_with_timeout 10 eas account:view 2>/dev/null || echo "")"

tier="unknown"
if [[ -n "$account_output" ]]; then
  if echo "$account_output" | grep -qiE "free|hobby"; then
    tier="free"
  elif echo "$account_output" | grep -qiE "production|priority|enterprise" || echo "$account_output" | grep -qiw "pro"; then
    tier="paid"
  fi
fi

case "$tier" in
  free)
    if [[ "$PLATFORM" == "both" ]]; then
      msg="Account: FREE tier (1 concurrent build). iOS + Android will queue serially. Expect ~30-60min total."
    else
      msg="Account: FREE tier (1 concurrent build)."
    fi
    record_result "$name" "INFO" "$msg" "Upgrade to Production tier for parallel builds"
    ;;
  paid)
    record_result "$name" "INFO" "Account: PAID tier (parallel builds available)" ""
    ;;
  *)
    record_result "$name" "INFO" "Account tier unknown — check expo.dev/accounts" ""
    ;;
esac

return 0
