#!/usr/bin/env bash
set -euo pipefail

# Find coach package root (walk up from skill/scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COACH_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$COACH_DIR"

echo "=== Schedule Context ==="
bun run scripts/cal.ts context 2>/dev/null || bun run scripts/cal.ts today 2>/dev/null || echo "(calendar unavailable)"
echo "========================"
