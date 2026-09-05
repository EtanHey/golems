#!/bin/bash
# Backup n8n workflows to the workflows/ directory.
#
# Usage: bash scripts/backup-workflows.sh [n8n-url]
#
# Exports all workflows from n8n via REST API and saves them
# as individual JSON files named by workflow ID + name.

set -euo pipefail

N8N_URL="${1:-http://localhost:5678}"
WORKFLOWS_DIR="$(dirname "$0")/../workflows"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$WORKFLOWS_DIR"

echo "Backing up workflows from $N8N_URL..."

# Get all workflows
WORKFLOWS=$(curl -s "$N8N_URL/api/v1/workflows" \
  -H "Content-Type: application/json" 2>/dev/null)

if [ -z "$WORKFLOWS" ]; then
  echo "Error: Could not connect to n8n at $N8N_URL"
  exit 1
fi

# Parse and save each workflow
echo "$WORKFLOWS" | python3 -c "
import json, sys, re

data = json.load(sys.stdin)
workflows = data.get('data', [])

for wf in workflows:
    wf_id = wf.get('id', 'unknown')
    name = wf.get('name', 'untitled')
    # Sanitize name for filename
    safe_name = re.sub(r'[^a-zA-Z0-9_-]', '_', name.lower())
    filename = f'{wf_id}_{safe_name}.json'

    with open('$WORKFLOWS_DIR/' + filename, 'w') as f:
        json.dump(wf, f, indent=2)

    print(f'  Saved: {filename}')

print(f'\nBacked up {len(workflows)} workflows to $WORKFLOWS_DIR/')
"

echo "Backup complete at $TIMESTAMP"
