#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
MODULE="$SKILL_DIR/scripts/codex_workflows.py"
NAIVE_CODEX="/Users/example/.bun/bin/codex"
EVAL_TMP="$(mktemp -d)"
LOG="$EVAL_TMP/naive.log"

cleanup() {
  rm -rf "$EVAL_TMP"
}
trap cleanup EXIT

if [[ -e "$NAIVE_CODEX" ]]; then
  echo "RED setup invalid: recorded nonexistent path now exists: $NAIVE_CODEX" >&2
  exit 1
fi

/usr/bin/nohup "$NAIVE_CODEX" exec --full-auto "bounded toy task" >"$LOG" 2>&1 &
naive_pid=$!
naive_shell_exit=$?
sleep 0.2

naive_stat="$(ps -p "$naive_pid" -o stat= 2>/dev/null | tr -d '[:space:]' || true)"
naive_process_alive=false
if [[ -n "$naive_stat" && "$naive_stat" != Z* ]]; then
  naive_process_alive=true
fi

if [[ "$naive_shell_exit" -ne 0 || -z "$naive_pid" || ! -s "$LOG" ]]; then
  echo "RED setup invalid: expected shell-zero + PID + nonempty diagnostic log" >&2
  exit 1
fi
if [[ "$naive_process_alive" == true ]]; then
  echo "RED setup invalid: failed executable still appears alive" >&2
  exit 1
fi

echo "RED naive_shell_exit=$naive_shell_exit pid_captured=true process_alive_after_grace=false log_nonempty=true"

python3 - "$MODULE" "$LOG" "$naive_pid" <<'PY'
import importlib.util
from pathlib import Path
import sys

module_path = Path(sys.argv[1])
log_path = Path(sys.argv[2])
pid = int(sys.argv[3])
spec = importlib.util.spec_from_file_location("codex_workflows", module_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
verdict = module.verify_launch(
    pid=pid,
    log_path=log_path,
    initial_size=0,
    timeout=0.2,
)
print(
    "GREEN verifier_ok={} verifier_state={} diagnostic_detected={}".format(
        str(verdict["ok"]).lower(),
        verdict["state"],
        "launcher diagnostic" in verdict.get("reason", ""),
    )
)
if verdict["ok"] or verdict["state"] != "failed_launch":
    raise SystemExit(1)
PY

echo "VERDICT PASS false-green launch detected"
