#!/bin/bash
# Restore n8n workflows from the workflows/ directory.
#
# Usage: bash scripts/restore-workflows.sh [n8n-url]
#
# Imports all JSON workflow files back into n8n.

set -euo pipefail

N8N_URL="${1:-http://localhost:5678}"
WORKFLOWS_DIR="$(dirname "$0")/../workflows"

echo "Restoring workflows to $N8N_URL..."

COUNT=0
for file in "$WORKFLOWS_DIR"/*.json; do
  [ -f "$file" ] || continue

  NAME=$(python3 -c "import json; print(json.load(open('$file')).get('name', 'unknown'))")
  echo "  Importing: $NAME"

  curl -s -X POST "$N8N_URL/api/v1/workflows" \
    -H "Content-Type: application/json" \
    -d "@$file" > /dev/null 2>&1

  COUNT=$((COUNT + 1))
done

echo "Restored $COUNT workflows"
