#!/usr/bin/env bash
# private-gate-count row: the candidate install's real private regression gate PASSED with exactly
# the manifest's expectedCases (the 579-vs-550 class: subTest rows inflated the XML total).
set -euo pipefail
: "${RATCHET_RUN:?run from scripts/ratchet/local-run.sh}"
expected="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["expectedCases"])' \
  "$RATCHET_CLONE/docs.local/private-guard-suites/manifest.json")"
grep -E 'private regression gate: (PASS|REFUSED)' "$RATCHET_RUN/install.log" || echo "no private gate verdict in install.log"
passed="$(sed -nE 's/^private regression gate: PASS ([0-9]+) private cases.*/\1/p' "$RATCHET_RUN/install.log" | tail -1)"
echo "expectedCases=$expected passed=${passed:-none}"
[ -n "$passed" ] && [ "$passed" = "$expected" ]
