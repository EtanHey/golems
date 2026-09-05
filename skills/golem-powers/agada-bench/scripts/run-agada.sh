#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
AGADA_ARTIFACT_ROOT="${AGADA_ARTIFACT_ROOT:-${HOME}/.local/share/golems/agada}"

# ────────────────────────────────────────────────────────────────────────
# Default: bench mode. Subcommand: `build` invokes the corpus-build pipeline.
#
#   /agada-bench                            → bench-mode against frozen 4-domain gold
#   /agada-bench --domains techgym,...      → bench-mode subsetted
#   /agada-bench --baseline X.json          → bench-mode with regression diff
#   /agada-bench build --session X --domain Y  → build new-domain pipeline
# ────────────────────────────────────────────────────────────────────────

STANDING_GOLDS=(
  "techgym:${AGADA_ARTIFACT_ROOT}/gold/techgym.jsonl"
  "freelance:${AGADA_ARTIFACT_ROOT}/gold/freelance.jsonl"
  "recruiting:${AGADA_ARTIFACT_ROOT}/gold/recruiting.jsonl"
  "architecture:${AGADA_ARTIFACT_ROOT}/gold/architecture.jsonl"
)

usage() {
  cat <<EOF
usage:
  run-agada.sh                                       # default: bench mode
  run-agada.sh [--domains a,b,c]
               [--baseline <prior-summary.json>]
               [--output-dir <dir>]
               [--k 1,3,5,10,20,50]
               [--include-low-power]
               [--dry-run]

  run-agada.sh build --session <jsonl> --domain <label> --output <dir> [build-flags]

  See workflows/run-bench.md (default) or workflows/build-new-domain.md (build).
EOF
}

run_or_print() {
  if [[ "${DRY_RUN:-false}" == "true" ]]; then
    printf 'DRY-RUN:'
    for arg in "$@"; do printf ' %q' "$arg"; done
    printf '\n'
  else
    "$@"
  fi
}

bench_mode() {
  local DOMAINS=""
  local BASELINE=""
  local OUTPUT_DIR="${AGADA_ARTIFACT_ROOT}/audits"
  local K="1,3,5,10,20,50"
  local INCLUDE_LOW_POWER="false"
  DRY_RUN="${DRY_RUN:-false}"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --domains) DOMAINS="$2"; shift 2 ;;
      --baseline) BASELINE="$2"; shift 2 ;;
      --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
      --k) K="$2"; shift 2 ;;
      --include-low-power) INCLUDE_LOW_POWER="true"; shift ;;
      --dry-run) DRY_RUN="true"; shift ;;
      -h|--help) usage; exit 0 ;;
      *) printf 'run-agada.sh: ERROR unknown bench flag: %s\n' "$1" >&2; usage; exit 1 ;;
    esac
  done

  local RUN_DATE; RUN_DATE="$(date -u +%Y-%m-%d)"
  local QUERIES="${OUTPUT_DIR}/${RUN_DATE}-bench-queries.jsonl"
  local RESULTS="${OUTPUT_DIR}/${RUN_DATE}-bench-results.jsonl"
  local REPORT="${OUTPUT_DIR}/${RUN_DATE}-brainlayer-quality-bench-results.md"
  local SUMMARY="${OUTPUT_DIR}/${RUN_DATE}-bench-summary.json"

  run_or_print mkdir -p "${OUTPUT_DIR}"

  # Build --gold args from STANDING_GOLDS, optionally subsetted by --domains
  local GOLD_ARGS=()
  if [[ -z "${DOMAINS}" ]]; then
    for spec in "${STANDING_GOLDS[@]}"; do
      GOLD_ARGS+=(--gold "${spec}")
    done
  else
    IFS=',' read -r -a WANTED <<< "${DOMAINS}"
    for w in "${WANTED[@]}"; do
      local matched=""
      for spec in "${STANDING_GOLDS[@]}"; do
        if [[ "${spec%%:*}" == "${w}" ]]; then
          GOLD_ARGS+=(--gold "${spec}"); matched="1"; break
        fi
      done
      [[ -z "${matched}" ]] && { printf 'run-agada.sh: ERROR unknown domain: %s\n' "$w" >&2; exit 1; }
    done
  fi

  run_or_print python3 "${SCRIPT_DIR}/run-bench.py" prepare "${GOLD_ARGS[@]}" --output "${QUERIES}"

  cat <<EOF

===============================================================
BENCH MODE — manual step (Claude/Codex session w/ BrainLayer MCP)
===============================================================
Queries planned: ${QUERIES}

Read workflows/run-bench.md, then for each query row in ${QUERIES}:
  1. brain_search(query=row.query_text, **row.query_filters, num_results=50)
  2. Classify each returned chunk for provenance (true_hit / echo_fm11 / downstream / uncertain / metadata_gap)
  3. Append one row per returned chunk to ${RESULTS}

When done, press Enter to score the results.
EOF

  if [[ "${DRY_RUN}" == "true" ]]; then
    printf 'DRY-RUN: skipping pause and remaining phases.\n'
    printf 'run-agada.sh: dry_run=true mode=bench queries=%s\n' "${QUERIES}"
    exit 0
  fi

  read -r _

  local SCORE_ARGS=(
    python3 "${SCRIPT_DIR}/run-bench.py" score
    --queries "${QUERIES}"
    --results "${RESULTS}"
    --output "${REPORT}"
    --json-out "${SUMMARY}"
    --k "${K}"
  )
  [[ -n "${BASELINE}" ]] && SCORE_ARGS+=(--baseline "${BASELINE}")
  [[ "${INCLUDE_LOW_POWER}" == "true" ]] && SCORE_ARGS+=(--include-low-power)

  "${SCORE_ARGS[@]}"

  printf '\nrun-agada.sh: mode=bench report=%s summary=%s\n' "${REPORT}" "${SUMMARY}"
}

build_mode() {
  # Identical to v1's build pipeline. Pre-existing flags preserved.
  local SESSION="" DOMAIN="" OUTPUT=""
  local JUDGES="claude,codex,gemini"
  local RUBRIC_VERSION="v1.1"
  local LIVENESS_CHECK="strict"
  local PENDING_RT_CASCADE="opus-4-7"
  local ROW_TOLERANCE="0.05"
  local SCHEMA="v1.1-3p"
  local PRIMARY_JUDGES=""
  local SHADOW_JUDGE=""
  DRY_RUN="${DRY_RUN:-false}"
  local FORCE="false"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --session) SESSION="$2"; shift 2 ;;
      --domain) DOMAIN="$2"; shift 2 ;;
      --output) OUTPUT="$2"; shift 2 ;;
      --judges) JUDGES="$2"; shift 2 ;;
      --rubric-version) RUBRIC_VERSION="$2"; shift 2 ;;
      --liveness-check) LIVENESS_CHECK="$2"; shift 2 ;;
      --pending-rt-cascade) PENDING_RT_CASCADE="$2"; shift 2 ;;
      --row-tolerance) ROW_TOLERANCE="$2"; shift 2 ;;
      --schema) SCHEMA="$2"; shift 2 ;;
      --primary-judges) PRIMARY_JUDGES="$2"; shift 2 ;;
      --shadow-judge) SHADOW_JUDGE="$2"; shift 2 ;;
      --dry-run) DRY_RUN="true"; shift ;;
      --force) FORCE="true"; shift ;;
      -h|--help) usage; exit 0 ;;
      *) printf 'run-agada.sh build: ERROR unknown flag: %s\n' "$1" >&2; usage; exit 1 ;;
    esac
  done
  if [[ -z "${SESSION}" || -z "${DOMAIN}" || -z "${OUTPUT}" ]]; then
    printf 'run-agada.sh build: --session --domain --output are required\n' >&2; usage; exit 1
  fi
  [[ -f "${SESSION}" ]] || { printf 'session not found: %s\n' "${SESSION}" >&2; exit 1; }
  if [[ "${FORCE}" != "true" && -f "${OUTPUT}/phase-3-gold/gold.jsonl" ]]; then
    printf 'gold already exists; pass --force to rerun: %s/phase-3-gold/gold.jsonl\n' "${OUTPUT}" >&2; exit 1
  fi

  local RUN_ID; RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
  local RUBRIC_SRC="${SKILL_DIR}/references/grading-rubric.md"
  local RUBRIC_DIR="${OUTPUT}/phase-0a-rubric"
  local CORPUS_DIR="${OUTPUT}/phase-0b-corpus"
  local PHASE1_DIR="${OUTPUT}/phase-1-judgments"
  local PHASE2_DIR="${OUTPUT}/phase-2-crossref"
  local PHASE3_DIR="${OUTPUT}/phase-3-gold"

  if [[ "${DRY_RUN}" == "true" ]]; then
    printf 'run-agada.sh build: dry_run=true run_id=%s domain=%s output=%s judges=%s schema=%s\n' \
      "${RUN_ID}" "${DOMAIN}" "${OUTPUT}" "${JUDGES}" "${SCHEMA}"
  else
    mkdir -p "${RUBRIC_DIR}" "${CORPUS_DIR}" "${PHASE1_DIR}" "${PHASE2_DIR}" "${PHASE3_DIR}"
  fi
  run_or_print cp "${RUBRIC_SRC}" "${RUBRIC_DIR}/grading-rubric.md"
  run_or_print python3 "${SCRIPT_DIR}/extract-corpus.py" --session "${SESSION}" --output "${CORPUS_DIR}"
  run_or_print python3 "${SCRIPT_DIR}/dispatch-judges.py" \
    --corpus "${CORPUS_DIR}/corpus.jsonl" \
    --rubric "${RUBRIC_DIR}/grading-rubric.md" \
    --judges "${JUDGES}" \
    --output-dir "${PHASE1_DIR}"

  cat <<EOF

===============================================================
BUILD MODE — PHASE 1 dispatch (manual step)
===============================================================
Spawn the following judges in cmux panes:
EOF
  IFS=',' read -r -a JUDGE_ARRAY <<< "${JUDGES}"
  for j in "${JUDGE_ARRAY[@]}"; do
    printf '  - %sJudge -> read brief under %s/spawn-briefs/\n' "${j}" "${PHASE1_DIR}"
  done
  printf '\nWait for each judge JSONL to land in %s, then press Enter.\n' "${PHASE1_DIR}"

  if [[ "${DRY_RUN}" == "true" ]]; then
    printf 'DRY-RUN: skipping pause and remaining phase execution.\n'
    printf 'run-agada.sh: dry_run=true mode=build phases_planned=8 output=%s\n' "${OUTPUT}"
    exit 0
  fi
  read -r _

  local LIVENESS_ARGS=(
    python3 "${SCRIPT_DIR}/liveness-check.py"
    --phase1-dir "${PHASE1_DIR}"
    --corpus "${CORPUS_DIR}/corpus.jsonl"
    --expected-judges "${JUDGES}"
    --tolerance "${ROW_TOLERANCE}"
  )
  [[ "${LIVENESS_CHECK}" == "strict" ]] && LIVENESS_ARGS+=(--strict)
  "${LIVENESS_ARGS[@]}"

  python3 "${SCRIPT_DIR}/build-crossref.py" --run-dir "${OUTPUT}" --judges "${JUDGES}"
  python3 "${SCRIPT_DIR}/kappa-matrix.py" \
    --from-phase1 "${PHASE1_DIR}" \
    --judges "${JUDGES}" \
    --out "${PHASE2_DIR}/kappa-matrix.md" \
    --corpus "${CORPUS_DIR}/corpus.jsonl"

  local GOLD_ARGS=(
    python3 "${SCRIPT_DIR}/build-gold.py"
    --run-dir "${OUTPUT}"
    --judges "${JUDGES}"
    --tiebreaker claude
    --schema "${SCHEMA}"
  )
  [[ -n "${PRIMARY_JUDGES}" ]] && GOLD_ARGS+=(--primary-judges "${PRIMARY_JUDGES}")
  [[ -n "${SHADOW_JUDGE}" ]] && GOLD_ARGS+=(--shadow-judge "${SHADOW_JUDGE}")
  set +e
  "${GOLD_ARGS[@]}"
  local GOLD_STATUS=$?
  set -e
  if [[ "${GOLD_STATUS}" -ne 0 && "${GOLD_STATUS}" -ne 2 ]]; then exit "${GOLD_STATUS}"; fi

  python3 "${SCRIPT_DIR}/route-pending-rt.py" \
    --gold "${PHASE3_DIR}/gold.jsonl" \
    --consensus "${PHASE2_DIR}/consensus-draft.jsonl" \
    --cascade "${PENDING_RT_CASCADE}" \
    --out "${PHASE3_DIR}/pending-rt-routing.md"

  printf '\nrun-agada.sh: mode=build phases=8 output=%s\n' "${OUTPUT}"
}

# ────────────────────────────────────────────────────────────────────────
# Top-level dispatch — bench is default, `build` is a subcommand
# ────────────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "build" ]]; then
  shift
  build_mode "$@"
else
  bench_mode "$@"
fi
