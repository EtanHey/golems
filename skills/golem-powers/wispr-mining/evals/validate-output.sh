#!/bin/bash
# Wispr Mining Skill — Output Validation Script
# Usage: ./validate-output.sh <vocabulary-csv> <replacements-csv> [report-md]
#
# Validates that generated files are actually importable by Wispr Flow.
# Exit code 0 = all checks pass, non-zero = failures found.

set -uo pipefail

VOCAB_FILE="${1:-}"
REPLACE_FILE="${2:-}"
REPORT_FILE="${3:-}"

FAILURES=0
PASSES=0

# Safe grep count — returns 0 when no matches (grep -c exits 1 on 0 matches)
gcount() {
  local count
  count=$(grep -c "$@" 2>/dev/null) || true
  printf '%d' "${count:-0}"
}

check_pass() {
  echo "  PASS: $1"
  ((PASSES++)) || true
}

check_fail() {
  echo "  FAIL: $1${2:+ — $2}"
  ((FAILURES++)) || true
}

echo "=== Wispr Mining Output Validation ==="
echo ""

# --- Vocabulary file checks ---
if [ -z "$VOCAB_FILE" ]; then
  echo "ERROR: No vocabulary file specified"
  exit 1
fi

if [ ! -f "$VOCAB_FILE" ]; then
  echo "FAIL: Vocabulary file not found: $VOCAB_FILE"
  exit 1
fi

echo "Vocabulary file: $VOCAB_FILE"

# V1: No comment lines
N=$(gcount '^#' "$VOCAB_FILE")
[ "$N" -eq 0 ] && check_pass "No comment lines" || check_fail "No comment lines" "$N comment lines found"

# V2: No blank lines
N=$(gcount '^$' "$VOCAB_FILE")
[ "$N" -eq 0 ] && check_pass "No blank lines" || check_fail "No blank lines" "$N blank lines found"

# V3: No header lines
N=$(gcount -iE '^(phrase|word|trigger|replacement|vocabulary|category|name|type)' "$VOCAB_FILE")
[ "$N" -eq 0 ] && check_pass "No header lines" || check_fail "No header lines" "$N header lines found"

# V4: No markdown formatting
N=$(gcount -E '^\||\*\*|^##|^- ' "$VOCAB_FILE")
[ "$N" -eq 0 ] && check_pass "No markdown formatting" || check_fail "No markdown formatting" "$N markdown lines found"

# V5: File is not empty
LINES=$(wc -l < "$VOCAB_FILE" | tr -d ' ')
[ "$LINES" -gt 0 ] && check_pass "File is not empty ($LINES lines)" || check_fail "File is empty"

# V6: No commas in vocabulary entries
N=$(gcount ',' "$VOCAB_FILE")
[ "$N" -eq 0 ] && check_pass "No commas (vocabulary only)" || check_fail "No commas (vocabulary only)" "$N lines with commas — move to replacements file"

echo ""

# --- Replacements file checks ---
if [ -z "$REPLACE_FILE" ]; then
  echo "WARNING: No replacements file specified, skipping"
else
  if [ ! -f "$REPLACE_FILE" ]; then
    echo "FAIL: Replacements file not found: $REPLACE_FILE"
    exit 1
  fi

  echo "Replacements file: $REPLACE_FILE"

  # R1: No comment lines
  N=$(gcount '^#' "$REPLACE_FILE")
  [ "$N" -eq 0 ] && check_pass "No comment lines" || check_fail "No comment lines" "$N comment lines found"

  # R2: No blank lines
  N=$(gcount '^$' "$REPLACE_FILE")
  [ "$N" -eq 0 ] && check_pass "No blank lines" || check_fail "No blank lines" "$N blank lines found"

  # R3: No header lines
  N=$(gcount -iE '^(phrase|trigger|replacement|vocabulary|category),(phrase|trigger|replacement|vocabulary|category)' "$REPLACE_FILE")
  [ "$N" -eq 0 ] && check_pass "No header lines" || check_fail "No header lines" "$N header lines found"

  # R4: Exactly one comma per line
  BAD=$(awk -F',' 'NF!=2' "$REPLACE_FILE" | wc -l | tr -d ' ')
  [ "$BAD" -eq 0 ] && check_pass "Exactly one comma per line" || check_fail "Exactly one comma per line" "$BAD malformed lines"

  # R5: No markdown formatting
  N=$(gcount -E '^\||\*\*|^##|^- ' "$REPLACE_FILE")
  [ "$N" -eq 0 ] && check_pass "No markdown formatting" || check_fail "No markdown formatting" "$N markdown lines found"

  # R6: File is not empty
  LINES=$(wc -l < "$REPLACE_FILE" | tr -d ' ')
  [ "$LINES" -gt 0 ] && check_pass "File is not empty ($LINES lines)" || check_fail "File is empty"

  # R7: Both sides of comma are non-empty
  EMPTY=$(awk -F',' '($1=="" || $2=="") {count++} END {print count+0}' "$REPLACE_FILE")
  [ "$EMPTY" -eq 0 ] && check_pass "No empty trigger/replacement" || check_fail "No empty trigger/replacement" "$EMPTY lines with empty side"
fi

echo ""

# --- Report file checks ---
if [ -n "$REPORT_FILE" ]; then
  if [ ! -f "$REPORT_FILE" ]; then
    echo "FAIL: Report file not found: $REPORT_FILE"
    ((FAILURES++)) || true
  else
    echo "Report file: $REPORT_FILE"
    REPORT_LINES=$(wc -l < "$REPORT_FILE" | tr -d ' ')
    [ "$REPORT_LINES" -gt 10 ] && check_pass "Report has content ($REPORT_LINES lines)" || check_fail "Report too short" "$REPORT_LINES lines"
  fi
fi

echo ""
echo "=== Results: $PASSES passed, $FAILURES failed ==="

if [ "$FAILURES" -gt 0 ]; then
  echo "STATUS: FAIL — files are NOT safe to import"
  exit 1
else
  echo "STATUS: PASS — files are safe to import into Wispr Flow"
  exit 0
fi
