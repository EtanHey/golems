#!/usr/bin/env bash
# check-naming-distinction.sh — deterministic guard for the cmux vs cmuxlayer distinction.
#
# Canonical rule (Etan, 2026-06-28):
#   cmux       = the terminal app / CLI / terminal surfaces (panes, splits, browser).
#   cmuxlayer  = the MCP / managed-agent / orchestration layer.
#
# In the two teaching skills (cmux, cmux-agents) the *layer* must be spelled `cmuxlayer`.
# It must NOT be called "cmux MCP", "cmux.layer", or "cmux layer".
#
# Allowed and NOT flagged:
#   - literal MCP tool names `mcp__cmuxlayer__*` (current registered namespace, back-compat)
#   - raw `cmux <verb>` CLI commands (terminal app)
#   - lines explicitly marked with the sentinel `naming-lint:allow` (negative examples
#     in the naming-rule docs themselves)
#
# Exit 0 = clean, exit 1 = a forbidden conflation form was reintroduced.

set -euo pipefail

# Resolve the golem-powers skills root relative to this script (…/cmux-agents/scripts/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

FILES=(
  "$SKILLS_ROOT/cmux/SKILL.md"
  "$SKILLS_ROOT/cmux-agents/SKILL.md"
)

# Forbidden ways to name the MCP/orchestration layer.
#   cmux MCP   — the layer mis-named after the terminal app
#   cmux.layer — wrong separator
#   cmux layer — wrong separator (space). "cmuxlayer" (no space) is the correct form.
FORBIDDEN='cmux MCP|cmux\.layer|cmux layer'

violations=0
for f in "${FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo "WARN: missing $f" >&2
    continue
  fi
  # grep with line numbers; drop intentional negative-example lines (naming-lint:allow).
  while IFS= read -r hit; do
    case "$hit" in
      *naming-lint:allow*) continue ;;
    esac
    if [ "$violations" -eq 0 ]; then
      echo "NAMING VIOLATION(S) — the orchestration layer must be 'cmuxlayer', not 'cmux MCP/.layer/ layer':"
    fi
    echo "  $f:$hit"
    violations=$((violations + 1))
  done < <(grep -nE "$FORBIDDEN" "$f" || true)
done

if [ "$violations" -gt 0 ]; then
  echo
  echo "FAIL: $violations line(s) call the orchestration layer by a forbidden name." >&2
  echo "      Keep literal mcp__cmuxlayer__* tool names, but spell the layer 'cmuxlayer' in prose." >&2
  exit 1
fi

echo "OK: cmux vs cmuxlayer distinction intact in cmux/ and cmux-agents/ SKILL.md"
