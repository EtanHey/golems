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

    cd "${REPOS_PATH}/golems"
    git worktree add -b "${sandbox_name}" "${sandbox_path}" HEAD 2>/dev/null || {
      # Branch may already exist
      git worktree add "${sandbox_path}" "${sandbox_name}" 2>/dev/null || {
        echo "Error: Could not create worktree" >&2
        exit 1
      }
    }
    echo "Sandbox created: ${sandbox_path}"
    echo "Branch: ${sandbox_name}"

  elif [[ "$action" == "cleanup" ]]; then
    if [[ ! -d "$sandbox_path" ]]; then
      echo "No sandbox at: ${sandbox_path}"
      exit 0
    fi

    cd "${REPOS_PATH}/golems"
    git worktree remove "${sandbox_path}" --force 2>/dev/null || true
    git branch -D "${sandbox_name}" 2>/dev/null || true
    echo "Sandbox cleaned up: ${sandbox_path}"
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
