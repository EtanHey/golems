#!/usr/bin/env bash
# live-hooks-status row (lead-run, post-merge): the LIVE install's --status exits 0 with drift=0,
# i.e. hooks-live == origin/master, clean, every gate registered. Specimen: hooks-live left at
# 3ba352ed while master moved (2026-10-06). Read-only.
set -euo pipefail
repo="$HOME/Gits/golems"
git -C "$repo" fetch -q origin master
set +e
out="$("$repo/scripts/hooks/install-hooks.sh" --host mbp --status 2>&1)"
rc=$?
set -e
printf '%s\n' "$out"
drift="$(sed -nE 's/^hooks-live=.* drift=([0-9]+)$/\1/p' <<<"$out")"
echo "status exit=$rc drift=${drift:-unknown}"
[ "$rc" = 0 ] && [ "$drift" = 0 ]
