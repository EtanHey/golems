#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
REPO="$(git -C "$SKILL_DIR/../../.." rev-parse --show-toplevel)"
HARNESS="$SKILL_DIR/scripts/codex-workflows.sh"
FIXTURE="$SCRIPT_DIR/fixtures/parallel-toy.json"
BRIEF_A="$SCRIPT_DIR/fixtures/toy-a-brief.md"
BRIEF_B="$SCRIPT_DIR/fixtures/toy-b-brief.md"
RUN_BASE="$REPO/.worktrees/codex-workflows-evals"
RUN_ID="cw-live-$(date '+%Y%m%d')-$$"
RUN_ROOT="$RUN_BASE/$RUN_ID"
SPEC="$RUN_ROOT/parallel.json"
RESULT="${CODEX_WORKFLOWS_RESULT_PATH:-$RUN_ROOT/live-result.json}"

mkdir -p "$RUN_ROOT"

python3 - "$FIXTURE" "$SPEC" "$REPO" "$BRIEF_A" "$BRIEF_B" <<'PY'
import json
from pathlib import Path
import sys

fixture, output, repo, brief_a, brief_b = map(Path, sys.argv[1:])
data = json.loads(fixture.read_text(encoding="utf-8"))
data["repo"] = str(repo.resolve())
data["workers"][0]["brief"] = str(brief_a.resolve())
data["workers"][1]["brief"] = str(brief_b.resolve())
output.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
PY

if ! "$HARNESS" parallel \
  --spec "$SPEC" \
  --run-id "$RUN_ID" \
  --run-dir "$RUN_BASE" \
  --watch \
  --watch-timeout 900 \
  >"$RUN_ROOT/parallel-output.json"; then
  echo "LIVE FANOUT FAILED; preserved run: $RUN_ROOT" >&2
  sed -n '1,240p' "$RUN_ROOT/parallel-output.json" >&2 || true
  exit 1
fi

MANIFEST="$RUN_ROOT/manifest.json"
python3 - "$MANIFEST" "$SPEC" "$RESULT" <<'PY'
import json
from pathlib import Path
import sys

manifest_path, spec_path, result_path = map(Path, sys.argv[1:])
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
spec = json.loads(spec_path.read_text(encoding="utf-8"))
expected_degraded = [
    "lead-reachable-only",
    "no-pane",
    "no-listen-name",
    "no-self-monitor",
]
expected_workers = {worker["name"]: worker for worker in spec["workers"]}
if set(manifest["workers"]) != set(expected_workers):
    raise SystemExit("manifest worker mapping mismatch")
if manifest.get("degraded_mode") != expected_degraded:
    raise SystemExit("run degraded-mode contract mismatch")

worktrees = set()
branches = set()
logs = set()
result_workers = {}
for name, expected in expected_workers.items():
    worker = manifest["workers"][name]
    expected_message = expected["expected_result"] + "\nTASK_DONE"
    checks = {
        "status_completed": worker.get("status") == "completed",
        "task_done_exact": worker.get("task_done") is True,
        "assistant_result_exact": worker.get("assistant_result", "").strip() == expected_message,
        "output_tokens_positive": isinstance(worker.get("output_tokens"), int)
        and worker["output_tokens"] > 0,
        "wall_seconds_positive": isinstance(worker.get("wall_seconds"), (int, float))
        and worker["wall_seconds"] > 0,
        "model_luna": worker.get("model") == "gpt-5.6-luna",
        "effort_xhigh": worker.get("effort") == "xhigh",
        "degraded_mode_exact": worker.get("degraded_mode") == expected_degraded,
        "log_exists": Path(worker["log"]).is_file(),
        "worktree_exists": Path(worker["worktree"]).is_dir(),
    }
    failed = [key for key, value in checks.items() if not value]
    if failed:
        raise SystemExit(f"{name} failed checks: {failed}")
    worktrees.add(worker["worktree"])
    branches.add(worker["branch"])
    logs.add(worker["log"])
    result_workers[name] = {
        "expected_result": expected["expected_result"],
        "assistant_result": worker["assistant_result"].strip(),
        "status": worker["status"],
        "task_done": worker["task_done"],
        "output_tokens": worker["output_tokens"],
        "wall_seconds": worker["wall_seconds"],
        "model": worker["model"],
        "effort": worker["effort"],
        "branch": worker["branch"],
        "worktree_name": Path(worker["worktree"]).name,
        "log_name": Path(worker["log"]).name,
        "checks": checks,
    }

if len(worktrees) != 2 or len(branches) != 2 or len(logs) != 2:
    raise SystemExit("workers did not receive distinct worktree/branch/log mappings")

result = {
    "date": "2026-08-02",
    "skill": "codex-workflows",
    "eval": "live-two-worker-fanout",
    "agent_type": "codex",
    "run_id": manifest["run_id"],
    "mode": manifest["mode"],
    "degraded_mode": manifest["degraded_mode"],
    "manifest_mapping_distinct": True,
    "workers": result_workers,
    "verdict": "PASS",
}
result_path.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY

"$HARNESS" harvest \
  --manifest "$MANIFEST" \
  --output-dir "$RUN_ROOT/harvest" \
  >"$RUN_ROOT/harvest-output.json"

"$HARNESS" cleanup --manifest "$MANIFEST" --delete-branches \
  >"$RUN_ROOT/cleanup-output.json"

echo "LIVE FANOUT PASS"
echo "RUN_ROOT=$RUN_ROOT"
echo "MANIFEST=$MANIFEST"
echo "RESULT=$RESULT"
echo "HARVEST=$RUN_ROOT/harvest"
