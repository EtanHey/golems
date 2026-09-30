#!/usr/bin/env bash
# Run on the target Mac. Dry-run unless --apply; --check never writes.
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$script_dir/install-gemini-context.py" "$@"
