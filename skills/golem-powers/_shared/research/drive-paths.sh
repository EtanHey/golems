#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PYTHON_BIN="${PYTHON_BIN:-python3}"
HELPER="$SCRIPT_DIR/drive-paths.py"

resolve_project_folder() {
  "$PYTHON_BIN" "$HELPER" resolve-project-folder "$1"
}

ensure_project_folders() {
  "$PYTHON_BIN" "$HELPER" ensure-project-folders "$1"
}

list_context_files() {
  "$PYTHON_BIN" "$HELPER" list-context-files "$1"
}

list_prompts() {
  "$PYTHON_BIN" "$HELPER" list-prompts "$1"
}

list_results() {
  "$PYTHON_BIN" "$HELPER" list-results "$1"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  "$PYTHON_BIN" "$HELPER" "$@"
fi
