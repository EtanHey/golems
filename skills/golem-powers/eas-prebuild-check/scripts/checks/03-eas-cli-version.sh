#!/usr/bin/env bash
# Check 03: eas-cli installed version matches npm latest
# Prevents: warnings during build, potential compat bugs

name="eas-cli version up to date"

# `eas --version` format: "eas-cli/18.1.0 darwin-arm64 node-v22.22.0"
# Parse: extract "18.1.0" from between "eas-cli/" and the next space.
installed=$(eas --version 2>/dev/null | head -1 | sed -n 's|^eas-cli/\([^ ]*\).*|\1|p' || echo "unknown")
[[ -z "$installed" ]] && installed="unknown"

if [[ "$installed" == "unknown" || -z "$installed" ]]; then
  record_result "$name" "FAIL" "eas-cli installed but version couldn't be parsed" "Reinstall: npm install -g eas-cli@latest"
  return 0
fi

# Query npm latest — with short timeout, soft-fail
latest=""
if command -v npm >/dev/null 2>&1; then
  latest="$(run_with_timeout 5 npm view eas-cli version 2>/dev/null || echo "")"
fi

if [[ -z "$latest" ]]; then
  record_result "$name" "INFO" "eas-cli installed: $installed (couldn't check npm latest — offline?)" ""
  return 0
fi

if [[ "$installed" == "$latest" ]]; then
  record_result "$name" "PASS" "eas-cli $installed is latest" ""
else
  msg="Installed: $installed | Latest: $latest"
  fix="npm install -g eas-cli@latest"

  if [[ "${FIX_MODE:-0}" -eq 1 ]]; then
    record_result "$name" "WARN" "$msg — auto-upgrade requested, needs user confirmation" "$fix"
  else
    record_result "$name" "WARN" "$msg" "$fix"
  fi
fi

return 0
