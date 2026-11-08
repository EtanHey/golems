#!/usr/bin/env bash
set -euo pipefail

# live-eval-runner.sh — Extract eval data and manage worktrees for live A/B testing.
#
# This script handles the BASH-side of live evals:
#   1. Extract eval prompts from evals.json
#   2. Create/cleanup sandbox worktrees
#   3. Store and compare captured outputs
#   4. Generate scoring templates
#
# Agent spawning uses cmux MCP tools (called by the skill-creator agent, not this script).
#
# Usage:
#   live-eval-runner.sh extract --skill <name> --eval-id <N>
#   live-eval-runner.sh sandbox --skill <name> --eval-id <N> [--create|--cleanup]
#   live-eval-runner.sh store --skill <name> --eval-id <N> --variant <baseline|withskill> --output <file>
#   live-eval-runner.sh report --skill <name> --eval-id <N>
#   live-eval-runner.sh score --skill <name> --eval-id <N> --baseline-file <f> --withskill-file <f>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
SKILLS_ROOT="${SKILL_DIR}/.."
REPOS_PATH="${HOME}/Gits"

# ---------------------------------------------------------------------------
# extract — Pull eval prompt and assertions from evals.json
# ---------------------------------------------------------------------------
cmd_extract() {
  local skill="" eval_id=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --skill) skill="$2"; shift 2 ;;
      --eval-id) eval_id="$2"; shift 2 ;;
      *) echo "Unknown: $1" >&2; exit 1 ;;
    esac
  done

  [[ -z "$skill" ]] && { echo "Error: --skill required" >&2; exit 1; }
  [[ -z "$eval_id" ]] && { echo "Error: --eval-id required" >&2; exit 1; }

  local evals_file="${SKILLS_ROOT}/${skill}/evals/evals.json"
  [[ ! -f "$evals_file" ]] && { echo "Error: ${evals_file} not found" >&2; exit 1; }

  # Extract eval case
  local eval_case
  eval_case=$(jq -r ".evals[] | select(.id == ${eval_id})" "$evals_file")
  [[ -z "$eval_case" ]] && { echo "Error: eval ID ${eval_id} not found in ${skill}" >&2; exit 1; }

  echo "## Eval Case"
  echo ""
  echo "**Skill:** ${skill}"
  echo "**Eval ID:** ${eval_id}"
  echo "**Name:** $(echo "$eval_case" | jq -r '.name')"
  echo "**Category:** $(echo "$eval_case" | jq -r '.category')"
  echo "**Description:** $(echo "$eval_case" | jq -r '.description')"
  echo ""
  echo "### Prompt"
  echo ""
  echo "$eval_case" | jq -r '.prompt'
  echo ""
  echo "### Assertions ($(echo "$eval_case" | jq '.assertions | length'))"
  echo ""
  echo "$eval_case" | jq -r '.assertions[] | "- [\(.type)] **\(.name)**: \(.description)"'
  echo ""

  # Also output raw JSON for programmatic use
  echo "### Raw JSON"
  echo '```json'
  echo "$eval_case" | jq '.'
  echo '```'
}

# ---------------------------------------------------------------------------
# sandbox — Create or cleanup a worktree sandbox
# ---------------------------------------------------------------------------
cmd_sandbox() {
  local skill="" eval_id="" action="create"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --skill) skill="$2"; shift 2 ;;
      --eval-id) eval_id="$2"; shift 2 ;;
      --create) action="create"; shift ;;
      --cleanup) action="cleanup"; shift ;;
      *) echo "Unknown: $1" >&2; exit 1 ;;
    esac
  done

  [[ -z "$skill" ]] && { echo "Error: --skill required" >&2; exit 1; }
  [[ -z "$eval_id" ]] && { echo "Error: --eval-id required" >&2; exit 1; }

  local sandbox_name="sandbox-eval-${skill}-${eval_id}"
  local sandbox_path="${REPOS_PATH}/${sandbox_name}"

  if [[ "$action" == "create" ]]; then
    if [[ -d "$sandbox_path" ]]; then
      echo "Sandbox already exists: ${sandbox_path}"
      echo "Use --cleanup first to remove it"
      exit 1
    fi

    cd "${REPOS_PATH}/golems" || { echo "Sandbox creation refused: repository unavailable" >&2; return 1; }
    python3 "${REPOS_PATH}/golems/scripts/repogolem/worktree-disk-floor.py" "$sandbox_path" || { local floor_rc=$?; echo "Sandbox creation refused: disk-floor check failed" >&2; return "$floor_rc"; }
    git worktree add -b "${sandbox_name}" "${sandbox_path}" HEAD || {
      echo "Sandbox creation refused: could not create a fresh branch; inspect any retained branch: ${sandbox_name}" >&2
      return 1
    }
    echo "Sandbox created: ${sandbox_path}"
    echo "Branch: ${sandbox_name}"

  elif [[ "$action" == "cleanup" ]]; then
    if [[ ! -d "$sandbox_path" ]]; then
      echo "No sandbox at: ${sandbox_path}"
      exit 0
    fi

    case "$(pwd -P)/" in
      "$sandbox_path/"*) echo "Sandbox retained: caller is inside ${sandbox_path}" >&2; return 1 ;;
    esac
    cd "${REPOS_PATH}/golems" || { echo "Sandbox retained: repository unavailable" >&2; return 1; }
    local common sandbox_common branch head status index base_ref listed remove_rc=0 branch_outcome=deleted
    common=$(git rev-parse --path-format=absolute --git-common-dir) || { echo "Sandbox retained: repository identity unavailable" >&2; return 1; }
    sandbox_common=$(git -C "$sandbox_path" rev-parse --path-format=absolute --git-common-dir) || { echo "Sandbox retained: worktree identity unavailable" >&2; return 1; }
    branch=$(git -C "$sandbox_path" symbolic-ref --short HEAD) || { echo "Sandbox retained: branch unavailable or HEAD detached" >&2; return 1; }
    if [[ -L "$sandbox_path" || "$sandbox_common" != "$common" || "$branch" != "$sandbox_name" ]]; then
      echo "Sandbox retained: worktree identity mismatch: ${sandbox_path}" >&2
      return 1
    fi
    status=$(git -C "$sandbox_path" status --porcelain --untracked-files=all --ignored) || { echo "Sandbox retained: status unavailable" >&2; return 1; }
    [[ -z "$status" ]] || { echo "Sandbox retained: tracked, untracked or ignored changes: ${sandbox_path}" >&2; return 1; }
    index=$(git -C "$sandbox_path" ls-files -v) || { echo "Sandbox retained: index unavailable" >&2; return 1; }
    if grep -Eq '^[a-zS] ' <<<"$index"; then
      echo "Sandbox retained: index flags can hide tracked changes: ${sandbox_path}" >&2
      return 1
    fi
    base_ref=$(git symbolic-ref refs/remotes/origin/HEAD) || { echo "Sandbox retained: origin default branch unavailable" >&2; return 1; }
    git fetch --quiet origin "refs/heads/${base_ref#refs/remotes/origin/}:${base_ref}" || { echo "Sandbox retained: fresh remote coverage unavailable" >&2; return 1; }
    head=$(git -C "$sandbox_path" rev-parse HEAD) || { echo "Sandbox retained: HEAD unavailable" >&2; return 1; }
    if ! git merge-base --is-ancestor "$head" "$base_ref"; then
      echo "Sandbox retained: HEAD is not merged into ${base_ref}: ${sandbox_path}" >&2
      printf 'Inspect and preserve work before explicitly discarding it: git worktree remove --force %q\n' "$sandbox_path" >&2
      return 1
    fi
    git worktree remove "$sandbox_path" || remove_rc=$?
    if [[ "$remove_rc" -ne 0 ]]; then
      echo "Sandbox retained: removal failed (rc=${remove_rc}): ${sandbox_path}" >&2
      return "$remove_rc"
    fi
    listed=$(git worktree list --porcelain) || { echo "Cleanup unverified: worktree list unavailable" >&2; return 1; }
    if grep -Fxq -- "worktree $sandbox_path" <<<"$listed"; then
      echo "Cleanup unverified: sandbox is still registered: ${sandbox_path}" >&2
      return 1
    fi
    python3 - "$sandbox_path" <<'PY_ABSENT' || { echo "Cleanup unverified: physical absence check failed" >&2; return 1; }
import os, sys
try:
    os.lstat(sys.argv[1])
except FileNotFoundError:
    sys.exit(0)
print("Cleanup unverified: sandbox path still exists", file=sys.stderr)
sys.exit(1)
PY_ABSENT
    git update-ref -d "refs/heads/${sandbox_name}" "$head" || { branch_outcome='retained: tip changed or deletion failed'; echo "Sandbox branch ${branch_outcome}: ${sandbox_name}" >&2; }
    echo "Sandbox cleaned up: ${sandbox_path}"
    echo "Cleanup receipt: remove_rc=0; registered=false; physical=false; branch=${branch_outcome}"
  fi
}

# ---------------------------------------------------------------------------
# store — Save captured agent output to results directory
# ---------------------------------------------------------------------------
cmd_store() {
  local skill="" eval_id="" variant="" output_file=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --skill) skill="$2"; shift 2 ;;
      --eval-id) eval_id="$2"; shift 2 ;;
      --variant) variant="$2"; shift 2 ;;
      --output) output_file="$2"; shift 2 ;;
      *) echo "Unknown: $1" >&2; exit 1 ;;
    esac
  done

  [[ -z "$skill" ]] && { echo "Error: --skill required" >&2; exit 1; }
  [[ -z "$eval_id" ]] && { echo "Error: --eval-id required" >&2; exit 1; }
  [[ -z "$variant" ]] && { echo "Error: --variant (baseline|withskill) required" >&2; exit 1; }
  [[ -z "$output_file" ]] && { echo "Error: --output required" >&2; exit 1; }

  local results_dir="${SKILLS_ROOT}/${skill}/evals/results"
  mkdir -p "$results_dir"

  local date_str
  date_str=$(date +%Y-%m-%d)
  local dest="${results_dir}/live-${date_str}-eval${eval_id}-${variant}.txt"

  cp "$output_file" "$dest"
  echo "Stored: ${dest}"
}

# ---------------------------------------------------------------------------
# report — Generate a scoring template for an eval
# ---------------------------------------------------------------------------
cmd_report() {
  local skill="" eval_id=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --skill) skill="$2"; shift 2 ;;
      --eval-id) eval_id="$2"; shift 2 ;;
      *) echo "Unknown: $1" >&2; exit 1 ;;
    esac
  done

  [[ -z "$skill" ]] && { echo "Error: --skill required" >&2; exit 1; }
  [[ -z "$eval_id" ]] && { echo "Error: --eval-id required" >&2; exit 1; }

  local evals_file="${SKILLS_ROOT}/${skill}/evals/evals.json"
  [[ ! -f "$evals_file" ]] && { echo "Error: ${evals_file} not found" >&2; exit 1; }

  local eval_case
  eval_case=$(jq -r ".evals[] | select(.id == ${eval_id})" "$evals_file")

  local date_str
  date_str=$(date +%Y-%m-%d)

  echo "## Live Eval Report: ${skill} / eval-${eval_id}"
  echo ""
  echo "**Date:** ${date_str}"
  echo "**Eval:** $(echo "$eval_case" | jq -r '.name')"
  echo "**Description:** $(echo "$eval_case" | jq -r '.description')"
  echo ""
  echo "### Assertion Scoring"
  echo ""
  echo "| # | Assertion | Type | Baseline | With Skill |"
  echo "|---|-----------|------|----------|------------|"

  local i=1
  while IFS= read -r assertion; do
    local name type
    name=$(echo "$assertion" | jq -r '.name')
    type=$(echo "$assertion" | jq -r '.type')
    echo "| ${i} | ${name} | ${type} | ☐ 0/1 | ☐ 0/1 |"
    ((i++))
  done < <(echo "$eval_case" | jq -c '.assertions[]')

  echo ""
  echo "### Scores"
  echo ""
  echo "- **Baseline:** ___ / $(echo "$eval_case" | jq '.assertions | length') = ___%"
  echo "- **With Skill:** ___ / $(echo "$eval_case" | jq '.assertions | length') = ___%"
  echo "- **Delta:** +___%"
  echo ""
  echo "### Verdict"
  echo ""
  echo "☐ SHIP (delta >30%)  ☐ ITERATE (delta 10-30%)  ☐ FLAG (delta <10%)  ☐ RETIRE (baseline >70%)"
}

# ---------------------------------------------------------------------------
# score — Auto-generate JSON results from scored assertion files
# ---------------------------------------------------------------------------
cmd_score() {
  local skill="" eval_id="" baseline_file="" withskill_file=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --skill) skill="$2"; shift 2 ;;
      --eval-id) eval_id="$2"; shift 2 ;;
      --baseline-file) baseline_file="$2"; shift 2 ;;
      --withskill-file) withskill_file="$2"; shift 2 ;;
      *) echo "Unknown: $1" >&2; exit 1 ;;
    esac
  done

  [[ -z "$skill" ]] && { echo "Error: --skill required" >&2; exit 1; }
  [[ -z "$eval_id" ]] && { echo "Error: --eval-id required" >&2; exit 1; }

  local results_dir="${SKILLS_ROOT}/${skill}/evals/results"
  mkdir -p "$results_dir"

  local date_str
  date_str=$(date +%Y-%m-%d)

  # Generate results JSON
  cat > "${results_dir}/live-${date_str}-eval${eval_id}.json" << EOF
{
  "date": "${date_str}",
  "skill": "${skill}",
  "eval_id": ${eval_id},
  "baseline_output": "${baseline_file:-not_provided}",
  "withskill_output": "${withskill_file:-not_provided}",
  "scoring": "PENDING — skill-creator agent scores assertions against captured output",
  "baseline_score": null,
  "withskill_score": null,
  "delta": null,
  "verdict": null
}
EOF

  echo "Results template created: ${results_dir}/live-${date_str}-eval${eval_id}.json"
  echo "Score the assertions and update the JSON with actual scores."
}

# ---------------------------------------------------------------------------
# Main dispatch
# ---------------------------------------------------------------------------
case "${1:-help}" in
  extract) shift; cmd_extract "$@" ;;
  sandbox) shift; cmd_sandbox "$@" ;;
  store)   shift; cmd_store "$@" ;;
  report)  shift; cmd_report "$@" ;;
  score)   shift; cmd_score "$@" ;;
  help|--help|-h)
    echo "live-eval-runner.sh — Live A/B eval helper for skill-creator"
    echo ""
    echo "Commands:"
    echo "  extract  --skill <name> --eval-id <N>           Extract eval prompt + assertions"
    echo "  sandbox  --skill <name> --eval-id <N> [--create|--cleanup]  Manage worktrees"
    echo "  store    --skill <name> --eval-id <N> --variant <baseline|withskill> --output <file>"
    echo "  report   --skill <name> --eval-id <N>           Generate scoring template"
    echo "  score    --skill <name> --eval-id <N>           Create results JSON"
    echo ""
    echo "Agent spawning is done via cmux MCP tools by the skill-creator agent."
    echo "This script handles data extraction, worktrees, and result storage."
    ;;
  *)
    echo "Unknown command: $1" >&2
    echo "Run with --help for usage" >&2
    exit 1
    ;;
esac
