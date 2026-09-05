#!/usr/bin/env bash
# Live behaviour proof for the INSTALLED stamp-lint hook. $1 = installed hook.
# Run by _shared/install-wired-hook.sh; a non-zero exit fails the install,
# because an installed-but-dead hook passing as "installed" is the worse outcome.
set -uo pipefail
HOOK="${1:?usage: probes.sh <installed-hook-path>}"
SRC="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCRATCH="$SRC/.probe-scratch"
trap 'rm -rf "$SCRATCH"' EXIT
mkdir -p "$SCRATCH/state"

fail=0
run() { # run <now> <content> -> stdout of hook
  local now="$1" content="$2" doc="$SCRATCH/collab/2026-06-07-probe-weave.md"
  mkdir -p "$SCRATCH/collab"
  printf '%s' "$content" > "$doc"
  printf '%s' "{\"hook_event_name\":\"PostToolUse\",\"session_id\":\"probe\",\"cwd\":\"$SCRATCH\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$doc\",\"content\":$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$content")},\"tool_response\":{\"type\":\"create\"}}" \
    | STAMP_LINT_NOW="$now" STAMP_LINT_STATE_DIR="$SCRATCH/state" python3 "$HOOK" 2>&1
}

out="$(run 18:49 '### orc — STRIKE + CORRECTION (19:05)
specimen numbers were invented.
')"
if [[ "$out" == *19:05* && "$out" == *18:49* ]]; then
  echo "  PASS  future stamp (19:05 written 18:49) WARNS"
else
  echo "  FAIL  future stamp did not warn; got: ${out:0:200}"; fail=1
fi

out="$(run 18:49 'plain prose with no stamp and no status claim
')"
if [[ -z "$out" ]]; then
  echo "  PASS  neutral write is SILENT"
else
  echo "  FAIL  neutral write warned; got: ${out:0:200}"; fail=1
fi

exit $fail
