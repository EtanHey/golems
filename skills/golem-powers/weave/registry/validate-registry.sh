#!/usr/bin/env bash
# validate-registry.sh — Fix-7 GREEN assertions for the weave rule registry.
# RED baseline (2026-06-07, pre-registry): no registry dir existed; E09 had three
# per-run referents (W06 [192] topology-drift / W06E [28] pr-loop-6-clause /
# W07 [34] qa-video routing) with no stable resolution (A1 header).
# Fails CLOSED with a diagnostic on every path (review round: codex P2 column-anchored
# state check; macroscope Low x2 silent-abort-under-set-e on empty greps).
set -euo pipefail
cd "$(dirname "$0")"
# The registry lives in the PRIVATE records repo (retros + registry contain
# operator comms): $ORCHESTRATOR_REPO/weave-records/registry/RULES.md.
# Pass an explicit path as $1 to validate a different copy.
RULES="${1:-$HOME/Gits/orchestrator/weave-records/registry/RULES.md}"
fail() { echo "FAIL: $1" >&2; exit 1; }

[ -f "$RULES" ] || fail "registry file $RULES does not exist (relocated to the private records repo — see SKILL.md §7)"

# 1. ZERO per-run E-number row keys — every registry row key is R-###.
if grep -qE '^\| E[0-9]+ +\| \*\*' "$RULES"; then
  fail "a per-run E-number is used as a registry row key"
fi
n_rows=$(grep -cE '^\| R-[0-9]{3} \|' "$RULES" || true)
[ "$n_rows" -ge 30 ] && [ "$n_rows" -le 60 ] || fail "expected 30-60 R-### rows, got ${n_rows:-0}"

# 2. E09 resolves to exactly ONE stable ID across the whole alias map.
e09_ids=$( (grep -E '^\| E09' "$RULES" || true) | (grep -oE 'R-[0-9]{3}' || true) | sort -u)
[ -n "$e09_ids" ] || fail "no E09 alias row resolves to a registry ID (alias map missing or broken)"
[ "$(echo "$e09_ids" | grep -c .)" -eq 1 ] || fail "E09 resolves to multiple registry IDs: $(echo "$e09_ids" | tr '\n' ' ')"
[ "$e09_ids" = "R-001" ] || fail "E09 resolved to $e09_ids, expected R-001"

# 3. The E35 row demonstrates the retire path: RETIRED state + the 2-clean-weave evidence.
e35_row=$(grep -E '^\| R-006 \|' "$RULES" || true)
[ -n "$e35_row" ] || fail "R-006 (pane-churn/E35) row missing"
echo "$e35_row" | grep -q 'RETIRED' || fail "R-006 does not show RETIRED state"
echo "$e35_row" | grep -qi '2nd clean weave\|two consecutive weaves' || fail "R-006 lacks the 2-clean-weave retire evidence"
(grep -E '^\| E35' "$RULES" || true) | grep -q 'R-006' || fail "E35 alias does not resolve to R-006"

# 4. Every row's STATE COLUMN (field 7 in both row layouts) starts with a recognized
#    lifecycle state token — column-anchored, not match-anywhere-in-row.
bad_states=$(awk -F'|' '$2 ~ /^ R-[0-9]{3} $/ {
  s = $7; gsub(/^[ *]+/, "", s); gsub(/[ *]+$/, "", s);
  if (s !~ /^(HELD|BROKEN-OPEN|ENCODED-UNTESTED|RETIRED|SUPERSEDED-UNRESOLVED|SUPERSEDED|LOST)/)
    print $2 "-> [" s "]"
}' "$RULES")
[ -z "$bad_states" ] || fail "rows whose State column carries no recognized state: $bad_states"
n_state_rows=$(awk -F'|' '$2 ~ /^ R-[0-9]{3} $/ {n++} END {print n+0}' "$RULES")
[ "$n_state_rows" -eq "$n_rows" ] || fail "state-column scan saw $n_state_rows rows but $n_rows R-### rows exist (table layout drifted)"

# 5. Supersession contract: a resolved SUPERSEDED row must cite a raw type:user turn;
#    R-010 must remain flagged UNRESOLVED until an operator ruling lands.
(grep -E '^\| R-009 \|' "$RULES" || true) | grep -q 'raw 77631d2e \[1924\]' || fail "R-009 supersession lacks its cited raw operator turn"
(grep -E '^\| R-010 \|' "$RULES" || true) | grep -q 'SUPERSEDED-UNRESOLVED' || fail "R-010 must be SUPERSEDED-UNRESOLVED pending Etan ruling"

echo "REGISTRY-VALIDATE GREEN: $n_rows rows; E09 -> R-001 (single stable ID); R-006 shows the retire path; zero per-run E-number keys; state column valid on all $n_state_rows rows."
