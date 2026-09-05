#!/usr/bin/env bash
# CLI Agent Runner - research and work modes
#
# RESEARCH mode (default): capture agent text output to a file
#   run.sh <agent> "<prompt>" [output-file]
#   run.sh --workspace ~/Gits/golems cursor "<prompt>" [output-file]
#
# WORK mode: agent modifies files in target workspace (cursor/codex only)
#   run.sh --work --workspace ~/Gits/golems cursor "<prompt>" [log-file]
#
# PROMPT FROM FILE: use @filepath to read prompt from a file
#   run.sh --workspace ~/Gits/golems cursor @/tmp/my-prompt.txt [output-file]
#
# Agents: gemini, cursor, codex, kiro, kilo
#
# SAFETY: kilo has full file access — blocked from golems/personal dirs

set -euo pipefail

# Parse flags
MODE="research"
FREE_MODE=false
WORKSPACE=""
while [[ "${1:-}" == --* ]]; do
  case "$1" in
    --work) MODE="work"; shift ;;
    --free) FREE_MODE=true; shift ;;
    --workspace) WORKSPACE="$2"; shift 2 ;;
    --workspace=*) WORKSPACE="${1#--workspace=}"; shift ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

AGENT="${1:?Usage: run.sh [--work] [--workspace <path>] <gemini|cursor|codex|kiro|kilo> \"prompt\" [output-file]}"
PROMPT_ARG="${2:?Missing prompt}"
OUTPUT="${3:-/tmp/cli-agent-${AGENT}-$(date +%s).md}"

# Change to workspace if specified
if [[ -n "$WORKSPACE" ]]; then
  if [[ ! -d "$WORKSPACE" ]]; then
    echo "Workspace not found: $WORKSPACE" >&2
    exit 1
  fi
  cd "$WORKSPACE"
fi

# Handle @filepath prompt syntax
if [[ "$PROMPT_ARG" == @* ]]; then
  PROMPT_PATH="${PROMPT_ARG#@}"
  if [[ ! -f "$PROMPT_PATH" ]]; then
    echo "Prompt file not found: $PROMPT_PATH" >&2
    exit 1
  fi
  PROMPT="$(cat "$PROMPT_PATH")"
else
  PROMPT="$PROMPT_ARG"
fi

echo "=== CLI Agent: ${AGENT} (${MODE} mode) ==="
echo "Output: ${OUTPUT}"
echo "CWD: $(pwd)"
echo "Started: $(date)"
echo "---"

case "$AGENT" in
  gemini)
    if [[ "$MODE" == "work" ]]; then
      echo "Note: Gemini is text-only, can't modify files. Running research mode." >&2
    fi
    echo "$PROMPT" | gemini 2>/dev/null > "$OUTPUT"
    ;;

  cursor)
    CURSOR_MODEL="${CURSOR_MODEL:-gpt-5.3-codex-xhigh}"
    MODEL_FLAG="--model ${CURSOR_MODEL}"
    if [[ "$FREE_MODE" == true ]]; then
      MODEL_FLAG=""  # Use cursor's default auto-routing (included in subscription)
    fi
    WORKSPACE_FLAG=""
    if [[ -n "$WORKSPACE" ]]; then
      WORKSPACE_FLAG="--workspace $WORKSPACE"
    fi
    if [[ "$MODE" == "work" ]]; then
      # Work mode: -p enables tools (write/bash), cursor modifies files directly
      cursor agent -p ${MODEL_FLAG} ${WORKSPACE_FLAG} --trust "$PROMPT" > "$OUTPUT" 2>&1
    else
      # Research mode: -p with text output format
      cursor agent -p --output-format text ${MODEL_FLAG} ${WORKSPACE_FLAG} --trust "$PROMPT" > "$OUTPUT" 2>&1
    fi
    ;;

  codex)
    CODEX_BIN="${CODEX_BIN:-npx codex}"
    if [[ "$MODE" == "work" ]]; then
      # Work mode: codex modifies files directly in CWD
      $CODEX_BIN --full-auto "$PROMPT" > "$OUTPUT" 2>&1
    else
      # Research mode: capture output to file
      $CODEX_BIN exec --full-auto -o "$OUTPUT" "$PROMPT" 2>/dev/null
    fi
    ;;

  kiro)
    if [[ "$MODE" == "work" ]]; then
      echo "Note: Kiro is text-only, can't modify files. Running research mode." >&2
    fi
    kiro-cli chat --no-interactive "$PROMPT" 2>/dev/null | sed 's/\x1b\[[0-9;]*[a-zA-Z]//g; s/\x1b\[[0-9;]*m//g; s/^> //' > "$OUTPUT"
    ;;

  kilo)
    KILO_BIN="${KILO_BIN:-$(which kilo 2>/dev/null || echo "$HOME/.nvm/versions/node/$(node -v)/bin/kilo")}"
    KILO_MODEL="${KILO_MODEL:-kilo/qwen/qwen3-coder:free}"

    # SAFETY CHECK: block kilo from accessing golems/personal directories
    CURRENT_DIR="$(pwd)"
    BLOCKED_PATTERNS="golems|\.claude|\.local/share/brainlayer|\.local/share/zikaron"
    if echo "$CURRENT_DIR" | grep -qE "$BLOCKED_PATTERNS"; then
      echo "=== SAFETY BLOCK ===" >&2
      echo "Kilo is blocked from running in: $CURRENT_DIR" >&2
      echo "Kilo sends code to external APIs — only use in non-sensitive projects" >&2
      echo "Allowed: ~/Gits/songscript, ~/Gits/taskowl, ~/Gits/union, ~/Gits/rudy" >&2
      exit 1
    fi

    echo "WARNING: Kilo sends code to external APIs. Current dir: $CURRENT_DIR" >&2

    if [[ "$MODE" == "work" ]]; then
      $KILO_BIN run -m "$KILO_MODEL" "$PROMPT" > "$OUTPUT" 2>&1
    else
      $KILO_BIN run -m "$KILO_MODEL" "$PROMPT" > "$OUTPUT" 2>&1
    fi
    ;;

  *)
    echo "Unknown agent: ${AGENT}" >&2
    echo "Available: gemini, cursor, codex, kiro, kilo" >&2
    exit 1
    ;;
esac

LINES=$(wc -l < "$OUTPUT" 2>/dev/null || echo "0")
echo "---"
echo "Done: $(date)"
echo "Output: ${OUTPUT} (${LINES} lines)"
