#!/usr/bin/env bash
# Entry point for scripts/hooks/install-hooks.mjs; see its header for the contract.
set -euo pipefail
exec node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/install-hooks.mjs" "$@"
