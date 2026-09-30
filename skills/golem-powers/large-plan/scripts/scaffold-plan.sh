#!/usr/bin/env bash
# Scaffold a folder-based plan structure
# Usage: scaffold-plan.sh <plan-dir> <plan-name> <phase-count>
#
# Example:
#   scaffold-plan.sh docs/plan auth-overhaul 5

set -euo pipefail

PLAN_DIR="${1:?Usage: scaffold-plan.sh <plan-dir> <plan-name> <phase-count>}"
PLAN_NAME="${2:?Missing plan name}"
PHASE_COUNT="${3:?Missing phase count}"

if [ "$PHASE_COUNT" -lt 1 ] || [ "$PHASE_COUNT" -gt 50 ]; then
  echo "Error: phase count must be between 1 and 50"
  exit 1
fi

# Create main directory
mkdir -p "$PLAN_DIR"

# Create main README
cat > "$PLAN_DIR/README.md" << MAINEOF
# ${PLAN_NAME}

---

## Progress

| # | Phase | Folder | Status | Notes |
|---|-------|--------|--------|-------|
MAINEOF

for i in $(seq 1 "$PHASE_COUNT"); do
  PHASE_DIR="$PLAN_DIR/phase-${i}"
  mkdir -p "$PHASE_DIR"

  # Add to progress table
  echo "| ${i} | Phase ${i} | [phase-${i}](phase-${i}/) | ... | |" >> "$PLAN_DIR/README.md"

  # Create phase README
  cat > "$PHASE_DIR/README.md" << PHASEEOF
# Phase ${i}: [Name]

> [Back to main plan](../README.md)

## Goal

[One sentence describing what this phase achieves]

## Tools

- **Gatherer:** \`gemini.gather.text\` (or \`gemini.gather.visual\`) → model: <resolved model> · effort: <low|medium|high|xhigh|default> · why: <one line>
- **Implementer:** \`codex.implement\` → model: <resolved model> · effort: <low|medium|high|xhigh|default> · why: <one line> (UX/UI phases: \`claude.judgment\` implements, Codex reviews; security phases: Daybreak Blue implements, \`claude.judgment\` reviews; see canon #1)
- **Reviewer / decisions:** \`claude.judgment\` (lead-routed) → model: <resolved model> · effort: <low|medium|high|xhigh|default> · why: <one line>
- **Lookup / pane mechanics / verifier:** \`claude.subagent.cheap\` → model: <resolved model> · effort: <low|medium|high|xhigh|default> · why: <one line>
- **Config:** golems \`standards/model-roles.json\`; resolve each required field with \`node scripts/model-roles.mjs <role> --field <field>\`. Candidate roles require their bench gate before use.

## Choosing effort per phase

Every role line requires a resolved model, chosen effort and one-line reason before dispatch.
Effort is not in the model-roles config; the phase declares it. For Gemini,
replace the effort placeholder with the resolved \`launcher_tier\` (no \`effort\` field/flag).
For Claude/Codex, \`default\` means omit the effort flag; do not invent a level.
Codex phases choose a concrete level for their explicit dispatch flag.
Low is only for known-output mechanical work; medium suits mechanical splits/refactors.
High/xhigh suit open-ended implementation, hard debugging or contradictory evidence;
security uses high. Evidence: skill-creator cleanup-routing R2 (2026-09-30, 48 verified runs): medium best-or-joint-best on mechanical cleanup; never default xhigh; a data point, not a ceiling.
Every Codex dispatch passes \`-E\` / \`effort:\` explicitly with the phase's reason.

## Steps

1. [Step one]
2. [Step two]

## Depends On

- [None / Phase X]

## Status

- [ ] Step one
- [ ] Step two
PHASEEOF

  # Create findings
  cat > "$PHASE_DIR/findings.md" << FINDEOF
# Phase ${i} Findings

## Decisions

## Research

## Task Board

| Task | Owner | Status |
|------|-------|--------|

## Notes
FINDEOF
done

# Finish main README
cat >> "$PLAN_DIR/README.md" << 'FOOTEREOF'

---

## Execution Rules

Each phase = one branch = one PR. See `/large-plan` skill for the full protocol.

## Cross-Phase Knowledge

Update this section as phases complete:
- Looking for X? See phase-Y/findings.md
FOOTEREOF

echo "Plan scaffolded: $PLAN_DIR"
echo "  $PHASE_COUNT phases created"
echo "  Next: fill in phase names and steps in each README.md"
