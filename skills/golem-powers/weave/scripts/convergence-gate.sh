#!/usr/bin/env bash
# convergence-gate.sh — the gate that keeps the weave from firing mid-flight.
#
# A multi-way deep-mining fan-out + the live Opus fleet = OOM + token contention.
# The weave must fire ONLY at convergence. This script checks the gate the way
# `/weave` (spoken "weave") arms it. "weave now" is the operator override that
# skips this gate entirely.
#
# The 4-condition gate (gen-9 blessed 2026-05-29), ALL must be true:
#   1. 0 open PRs across golems + brainlayer + voicelayer   [MECHANICAL — gh]
#   2. All workers idle/settled                             [cmux and/or T3 fleet]
#   3. No in-flight Codex                                   [cmux/pgrep, or T3 snapshot]
#   4. Etan has SEEN + APPROVED the demo                    [OPERATOR ACK — not script-checkable]
# Plus a RAM gate (same lesson as content-demo's ram-gate.sh).
#
# Exit 0 = gate PASSES (clear to weave). Exit 1 = blocked (reasons printed).
# Condition #4 cannot be auto-verified: pass --ack-demo (or WEAVE_DEMO_ACK=1) to
# assert the operator confirmed it. Without the ack the gate is BLOCKED by design —
# never auto-fire.
#
# Conditions 2/3 depend on how the fleet runs (--fleet / WEAVE_FLEET):
#   cmux  — `cmux list-status` pane idleness + a pgrep codex heuristic (warn only).
#   t3    — a JSON snapshot of T3 threads + delegated tasks (--t3-state /
#           WEAVE_T3_STATE), judged by t3-fleet-state.py against the fleet's
#           T3 projectIds (--t3-projects / WEAVE_T3_PROJECTS). The script cannot
#           call MCP; the lead captures the snapshot (references/run-lifecycle.md
#           §1.1). Passes only when convergence is proven: a missing/invalid/
#           stale snapshot, an unswept project, any working, waiting or unknown
#           state, a missing liveness field, a duplicate row, a missing child
#           thread, a pending question, or a finished-but-unsettled worker blocks.
#   both  — both checks; each must pass.
#   auto  — (default) t3 if a snapshot is given or the gate runs inside T3
#           (T3CODE_CLI_PATH set), cmux if the cmux CLI is on PATH, both if both.
#           Nothing detectable = BLOCKED, never a pass.
#
# Usage:
#   convergence-gate.sh [--ack-demo] [--min-free-gb N] [--repos "a b c"]
#                       [--fleet auto|cmux|t3|both] [--t3-state FILE]
#                       [--t3-projects "ID ..."] [--t3-max-age-min N]
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ACK_DEMO="${WEAVE_DEMO_ACK:-0}"
MIN_FREE_GB="${WEAVE_MIN_FREE_GB:-4}"
REPOS=(golems brainlayer voicelayer)
GIT_ROOT="${GITS_ROOT:-$HOME/Gits}"
FLEET="${WEAVE_FLEET:-auto}"
T3_STATE="${WEAVE_T3_STATE:-}"
T3_PROJECTS="${WEAVE_T3_PROJECTS:-}"
T3_MAX_AGE_MIN="${WEAVE_T3_MAX_AGE_MIN:-15}"

# value flags: a missing value is a usage error (64), not a set -u crash
need_value() {
  if [[ $# -lt 2 ]]; then echo "ERROR: $1 needs a value" >&2; exit 64; fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ack-demo) ACK_DEMO=1; shift ;;
    --min-free-gb) need_value "$@"; MIN_FREE_GB="$2"; shift 2 ;;
    --repos) need_value "$@"; read -r -a REPOS <<< "$2"; shift 2 ;;
    --fleet) need_value "$@"; FLEET="$2"; shift 2 ;;
    --t3-state) need_value "$@"; T3_STATE="$2"; shift 2 ;;
    --t3-projects) need_value "$@"; T3_PROJECTS="$2"; shift 2 ;;
    --t3-max-age-min) need_value "$@"; T3_MAX_AGE_MIN="$2"; shift 2 ;;
    -h|--help) sed -n '2,39p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 64 ;;
  esac
done

case "$FLEET" in
  auto|cmux|t3|both) ;;
  *) echo "ERROR: --fleet must be auto|cmux|t3|both (got '$FLEET')" >&2; exit 64 ;;
esac
if ! [[ "$T3_MAX_AGE_MIN" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
  echo "ERROR: --t3-max-age-min must be a positive number (got '$T3_MAX_AGE_MIN')" >&2
  exit 64
fi

if [[ ${#REPOS[@]} -eq 0 ]]; then
  echo "ERROR: --repos produced an empty list; nothing to check" >&2
  exit 64
fi

blocked=0
note() { printf '  %s\n' "$1"; }
fail() { printf '  ❌ %s\n' "$1"; blocked=1; }
pass() { printf '  ✅ %s\n' "$1"; }
warn() { printf '  ⚠️  %s\n' "$1"; }

echo "== weave convergence gate =="

# ---- 1. 0 open PRs across the 3 repos (MECHANICAL) -------------------------
echo "[1] open PRs across ${REPOS[*]}"
if command -v gh >/dev/null 2>&1; then
  total_open=0
  for r in "${REPOS[@]}"; do
    dir="$GIT_ROOT/$r"
    if [[ ! -d "$dir" ]]; then
      fail "$r: repo dir not found ($dir) — cannot confirm 0 open PRs (fail-safe)"
      continue
    fi
    n=$(cd "$dir" && gh pr list --state open --json number --jq 'length' 2>/dev/null)
    if [[ -z "$n" ]]; then
      fail "$r: gh pr list failed (auth/network?) — cannot confirm 0 open"
      continue
    fi
    if ! [[ "$n" =~ ^[0-9]+$ ]]; then
      fail "$r: non-numeric PR count '$n' — cannot confirm 0 open"
      continue
    fi
    if [[ "$n" -eq 0 ]]; then pass "$r: 0 open PRs"; else fail "$r: $n open PR(s)"; fi
    total_open=$((total_open + n))
  done
  [[ "$total_open" -eq 0 ]] && note "→ total open PRs: 0" || note "→ total open PRs: $total_open (must be 0)"
else
  fail "gh CLI not installed — cannot check open PRs"
fi

# ---- 2/3. workers idle/settled + no in-flight Codex (per fleet) ------------
check_cmux=0
check_t3=0
case "$FLEET" in
  cmux) check_cmux=1 ;;
  t3) check_t3=1 ;;
  both) check_cmux=1; check_t3=1 ;;
  auto)
    if [[ -n "$T3_STATE" || -n "${T3CODE_CLI_PATH:-}" ]]; then check_t3=1; fi
    if command -v cmux >/dev/null 2>&1; then check_cmux=1; fi
    ;;
esac
selected=()
[[ "$check_cmux" -eq 1 ]] && selected+=(cmux)
[[ "$check_t3" -eq 1 ]] && selected+=(t3)
echo "[2/3] workers idle/settled + no in-flight Codex (fleet: ${selected[*]:-none})"

if [[ "$check_cmux" -eq 0 && "$check_t3" -eq 0 ]]; then
  fail "no fleet detected (no --t3-state, not inside T3, no cmux CLI) — cannot confirm workers idle (fail-safe: BLOCKED; pass --fleet and its input)"
fi

# cmux fleet: pane idleness + codex-process heuristic
if [[ "$check_cmux" -eq 1 ]]; then
  if command -v cmux >/dev/null 2>&1; then
    status_out=$(cmux list-status 2>/dev/null); rc=$?
    if [[ $rc -ne 0 || -z "$status_out" ]]; then
      fail "cmux list-status failed (rc=$rc) — cannot confirm panes idle (fail-safe: BLOCKED)"
    else
      # list-status lines look like:  agent-surface:4=idle icon=circle color=...
      surfaces=$(printf '%s\n' "$status_out" | grep -c '=' || true)
      busy=$(printf '%s\n' "$status_out" | grep -cE '=(working|busy|running|active)' || true)
      if [[ "$busy" -eq 0 ]]; then
        pass "cmux: $surfaces agent surface(s), 0 working/busy"
      else
        fail "cmux: $busy of $surfaces surface(s) working/busy — not converged"
      fi
    fi
  else
    fail "cmux CLI not on PATH — cannot confirm pane idleness (fail-safe: BLOCKED; verify manually or use 'weave now')"
  fi
  # independent codex-process heuristic (in-cmux codex workers are already covered above)
  if pgrep -fl 'codex' >/dev/null 2>&1; then
    warn "codex-matching process(es) present (pgrep) — confirm none is an in-flight worker"
  else
    pass "no codex processes found via pgrep"
  fi
fi

# T3 fleet: threads + delegated tasks from the lead's snapshot (Codex delegates included)
if [[ "$check_t3" -eq 1 ]]; then
  if [[ -z "$T3_STATE" ]]; then
    fail "T3 fleet selected but no snapshot — capture one (references/run-lifecycle.md §1.1) and pass --t3-state FILE"
  elif ! command -v python3 >/dev/null 2>&1; then
    fail "T3: python3 not on PATH — cannot judge the snapshot (fail-safe: BLOCKED)"
  else
    t3_out=$(python3 "$SCRIPT_DIR/t3-fleet-state.py" "$T3_STATE" --max-age-min "$T3_MAX_AGE_MIN" \
      --expect-projects "$T3_PROJECTS" 2>&1); t3_rc=$?
    t3_pass=0
    t3_fail=0
    while IFS= read -r line; do
      case "$line" in
        "PASS "*) pass "T3: ${line#PASS }"; t3_pass=$((t3_pass + 1)) ;;
        "FAIL "*) fail "T3: ${line#FAIL }"; t3_fail=$((t3_fail + 1)) ;;
        "") ;;
        *) note "T3: $line" ;;
      esac
    done <<< "$t3_out"
    # a pass needs exit 0 AND a PASS line; anything else without a FAIL line is a crash
    if [[ "$t3_fail" -eq 0 && ( "$t3_rc" -ne 0 || "$t3_pass" -eq 0 ) ]]; then
      fail "T3: snapshot judge exited $t3_rc without a verdict (fail-safe: BLOCKED)"
    fi
  fi
fi

# ---- RAM gate (macOS) ------------------------------------------------------
echo "[RAM] free memory >= ${MIN_FREE_GB} GB"
free_gb=""
if command -v vm_stat >/dev/null 2>&1; then
  # pages free+inactive+speculative ≈ reclaimable; page size 16384 on Apple Silicon, 4096 on Intel
  page_size=$(vm_stat | sed -n 's/.*page size of \([0-9]*\) bytes.*/\1/p')
  page_size="${page_size:-4096}"
  reclaimable_pages=$(vm_stat | awk -v ps="$page_size" '
    /Pages free/        {gsub(/\./,"",$3); f=$3}
    /Pages inactive/    {gsub(/\./,"",$3); i=$3}
    /Pages speculative/ {gsub(/\./,"",$3); s=$3}
    END {print (f+i+s)}')
  if [[ -n "$reclaimable_pages" ]]; then
    free_gb=$(awk -v p="$reclaimable_pages" -v ps="$page_size" 'BEGIN{printf "%.1f", p*ps/1073741824}')
  fi
fi
if [[ -n "$free_gb" ]]; then
  if awk -v f="$free_gb" -v m="$MIN_FREE_GB" 'BEGIN{exit !(f+0 >= m+0)}'; then
    pass "~${free_gb} GB free (>= ${MIN_FREE_GB} GB)"
  else
    fail "~${free_gb} GB free (< ${MIN_FREE_GB} GB) — quiesce the fleet before a fan-out"
  fi
else
  warn "could not read free memory (non-macOS or vm_stat unavailable) — verify manually"
fi

# ---- 4. demo approval (OPERATOR ACK) ---------------------------------------
echo "[4] Etan has SEEN + APPROVED the demo"
if [[ "$ACK_DEMO" -eq 1 ]]; then
  pass "operator asserted demo approval (--ack-demo / WEAVE_DEMO_ACK=1)"
else
  fail "demo approval NOT asserted — this gate never auto-fires. Re-run with --ack-demo once Etan has confirmed, or use 'weave now' to override the whole gate."
fi

echo "== result =="
if [[ "$blocked" -eq 0 ]]; then
  echo "✅ CONVERGENCE GATE PASSED — clear to run the weave."
  exit 0
else
  echo "❌ CONVERGENCE GATE BLOCKED — do NOT weave yet (reasons above)."
  echo "   Operator override: run the weave anyway only on an explicit 'weave now'."
  exit 1
fi
