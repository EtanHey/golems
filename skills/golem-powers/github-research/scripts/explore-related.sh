#!/bin/bash
#
# Explore related projects in the golem ecosystem
# Usage: ./explore-related.sh [output_dir]
#
# Explores active repos:
# - $HOME/Gits/golems         (Monorepo — coach, shared, services)
# - $HOME/Gits/brainlayer     (Memory layer — BrainLayer MCP)
# - $HOME/Gits/voicelayer     (Voice I/O — VoiceBar + MCP)
# - $HOME/Gits/golem-terminal (Native macOS terminal for agents)
# - $ORCHESTRATOR_REPO   (orcClaude — cross-repo coordination)
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
OUTPUT_DIR="${1:-$REPO_ROOT/docs.local}"

echo "=== Related Projects Explorer ==="
echo "Output: $OUTPUT_DIR/"
echo ""

mkdir -p "$OUTPUT_DIR"

# Active golem ecosystem repos
declare -A REPOS
REPOS=(
    ["golems"]="$HOME/Gits/golems"
    ["brainlayer"]="$HOME/Gits/brainlayer"
    ["voicelayer"]="$HOME/Gits/voicelayer"
    ["golem-terminal"]="$HOME/Gits/golem-terminal"
    ["orchestrator"]="$HOME/Gits/orchestrator"
)

EXPLORED=()
SKIPPED=()

for name in "${!REPOS[@]}"; do
    path="${REPOS[$name]}"
    if [ -d "$path" ]; then
        echo ">>> Exploring $name ($path)..."
        "$SCRIPT_DIR/explore.sh" "$path" "$OUTPUT_DIR"
        EXPLORED+=("$name")
    else
        echo ">>> $name not found at $path, skipping"
        SKIPPED+=("$name")
    fi
done

# ─────────────────────────────────────────────────────────────
# Summary Report
# ─────────────────────────────────────────────────────────────
SUMMARY_FILE="$OUTPUT_DIR/related-projects-summary.md"
cat > "$SUMMARY_FILE" << EOF
# Related Projects Summary

Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

## Projects Explored

| Project | Path | Status |
|---------|------|--------|
EOF

for name in "${!REPOS[@]}"; do
    path="${REPOS[$name]}"
    status=$([ -d "$path" ] && echo "Explored" || echo "Not found")
    echo "| $name | $path | $status |" >> "$SUMMARY_FILE"
done

cat >> "$SUMMARY_FILE" << 'EOF'

## Output Files

```
EOF
ls -la "$OUTPUT_DIR"/*-structure.md "$OUTPUT_DIR"/*-commands.md "$OUTPUT_DIR"/*-keyfiles.md 2>/dev/null >> "$SUMMARY_FILE" || echo "No files generated" >> "$SUMMARY_FILE"
cat >> "$SUMMARY_FILE" << 'EOF'
```

## Next Steps

1. Read the generated files
2. Identify integration points across repos
3. Document cross-project dependencies
4. brain_store key findings
EOF

echo ""
echo "=== Summary ==="
cat "$SUMMARY_FILE"
