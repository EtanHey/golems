#!/usr/bin/env bash
# Wizard skill — prerequisites check on load
set -euo pipefail

echo "=== Golems Setup Wizard ==="
echo ""

# Check prerequisites
missing=()
for cmd in brew node bun claude gh git; do
  path=$(which "$cmd" 2>/dev/null || true)
  if [ -n "$path" ]; then
    version=$("$cmd" --version 2>/dev/null | head -1 || echo "unknown")
    printf "  %-8s : %s (%s)\n" "$cmd" "$path" "$version"
  else
    printf "  %-8s : NOT FOUND\n" "$cmd"
    missing+=("$cmd")
  fi
done

echo ""

# Check config
if [ -f "$HOME/.golems/config.yaml" ]; then
  echo "Config:     ~/.golems/config.yaml (EXISTS)"
else
  echo "Config:     ~/.golems/config.yaml (NOT FOUND — will create)"
fi

# Check BrainBar
if [ -S /tmp/brainbar.sock ]; then
  echo "BrainLayer: CONNECTED (socket exists)"
else
  echo "BrainLayer: NOT RUNNING"
fi

echo ""

if [ ${#missing[@]} -gt 0 ]; then
  echo "Missing prerequisites: ${missing[*]}"
  echo "Install them before proceeding."
else
  echo "All prerequisites met. Ready to run wizard."
fi
