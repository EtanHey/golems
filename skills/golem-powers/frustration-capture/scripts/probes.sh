#!/usr/bin/env bash
# Live behaviour proof for the INSTALLED frustration-capture hook.
# $1 = installed hook. Run by _shared/install-wired-hook.sh; non-zero fails
# the install, so an installed-but-dead hook cannot pass as "installed".
#
# The second probe matters more than it looks: this hook resolves its SKILL.md
# as ../SKILL.md relative to itself, so installing the .py WITHOUT the rest of
# the package would silently half-break it. The probe catches that.
set -uo pipefail
HOOK="${1:?usage: probes.sh <installed-hook-path>}"

fail=0
ask() { printf '%s' "{\"prompt\":$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$1"),\"session_id\":\"probe\",\"cwd\":\"$PWD\"}" | python3 "$HOOK" 2>&1; }

out="$(ask "no, that's wrong, I told you already to stop doing that")"
if [[ "$out" == *FRUSTRATION\ SIGNAL\ DETECTED* ]]; then
  echo "  PASS  correction prompt INJECTS guidance"
else
  echo "  FAIL  correction prompt produced no signal; got: ${out:0:200}"; fail=1
fi

out="$(ask "please add a test for the parser")"
if [[ -z "$out" ]]; then
  echo "  PASS  neutral prompt is SILENT"
else
  echo "  FAIL  neutral prompt fired; got: ${out:0:200}"; fail=1
fi

if [[ -f "$(dirname "$HOOK")/../SKILL.md" ]]; then
  echo "  PASS  SKILL.md present alongside the installed hook"
else
  echo "  FAIL  SKILL.md missing — the hook resolves it as ../SKILL.md"; fail=1
fi

exit $fail
