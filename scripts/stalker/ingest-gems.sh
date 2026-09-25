#!/bin/bash
# Ingest gems from gems-manifest.json into BrainLayer for searchability.
# Usage: ingest-gems.sh <gems-dir>
#
# Each gem becomes a brain_store entry with:
#   - Content: title + transcript snippet
#   - Type: bookmark
#   - Tags: gem, streamer name, gem type
#   - Importance: based on gem score (7→5, 8→6, 9→8, 10→10)
#
# Also stores a session summary with all gems for the stream.
#
# Requires: brainlayer-mcp installed (pip install brainlayer)

set -euo pipefail

GEMS_DIR="${1:?Usage: ingest-gems.sh <gems-dir>}"
PYTHON313="/Library/Frameworks/Python.framework/Versions/3.13/bin/python3"

[ ! -d "$GEMS_DIR" ] && { echo "Error: Directory not found: $GEMS_DIR"; exit 1; }

MANIFEST="$GEMS_DIR/gems-manifest.json"
[ ! -f "$MANIFEST" ] && { echo "Error: No gems-manifest.json in $GEMS_DIR"; exit 1; }

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
CHECKOUT_ROOT=$(git -C "$SCRIPT_DIR/.." rev-parse --show-toplevel)
COMMON_GIT_DIR=$(git -C "$CHECKOUT_ROOT" rev-parse --git-common-dir)
if [[ $COMMON_GIT_DIR != /* ]]; then
    COMMON_GIT_DIR="$CHECKOUT_ROOT/$COMMON_GIT_DIR"
fi
DEFAULT_PROJECT_PATH=$(cd "$(dirname "$COMMON_GIT_DIR")" && pwd -P)
DEFAULT_PROJECT_SLUG="-${DEFAULT_PROJECT_PATH#/}"
DEFAULT_PROJECT_SLUG="${DEFAULT_PROJECT_SLUG//\//-}"
BRAINLAYER_PROJECT="${BRAINLAYER_PROJECT:-$DEFAULT_PROJECT_SLUG}"

INGESTED_MARKER="$GEMS_DIR/.brainlayer-ingested"
if [ -f "$INGESTED_MARKER" ]; then
    echo "Already ingested into BrainLayer. Delete $INGESTED_MARKER to re-ingest."
    exit 0
fi

log() { echo "[$(date '+%H:%M:%S')] [ingest] $1"; }

log "Reading manifest..."

export MANIFEST GEMS_DIR BRAINLAYER_PROJECT

"$PYTHON313" << 'PYEOF'
import json
import subprocess
import os
import sys

manifest_path = os.environ.get("MANIFEST", "")
if not manifest_path:
    gems_dir = os.environ.get("GEMS_DIR", ".")
    manifest_path = os.path.join(gems_dir, "gems-manifest.json")

with open(manifest_path) as f:
    manifest = json.load(f)

streamer = manifest.get("streamer", "unknown")
date = manifest.get("date", "unknown")
vod_url = manifest.get("vod_url", "")
gems = manifest.get("gems", [])

if not gems:
    print("No gems to ingest")
    sys.exit(0)

print(f"Ingesting {len(gems)} gems from {streamer} ({date})...")

# Map gem score to importance (7→5, 8→6, 9→8, 10→10)
def score_to_importance(score):
    return min(10, max(1, {7: 5, 8: 6, 9: 8, 10: 10}.get(score, score - 2)))

ingested = 0
failed = 0
for gem in gems:
    score = gem.get("score", 0)
    if score < 7:
        continue

    title = gem.get("title", "untitled")
    gem_type = gem.get("type", "other")
    timestamp = gem.get("timestamp", "00:00")
    transcript = gem.get("transcript", "")[:500]

    content = f"Stream gem: {title}\n"
    content += f"Streamer: {streamer} | Date: {date} | Timestamp: {timestamp}\n"
    content += f"Score: {score}/10 | Type: {gem_type}\n"
    if vod_url:
        content += f"VOD: {vod_url}\n"
    if transcript:
        content += f"Transcript: {transcript}\n"

    importance = score_to_importance(score)
    tags = json.dumps(["gem", streamer, gem_type, f"score-{score}"])

    # Use brainlayer CLI to store
    try:
        result = subprocess.run(
            [
                "brainlayer", "store",
                "--content", content,
                "--type", "bookmark",
                "--tags", tags,
                "--importance", str(importance),
                "--project", os.environ["BRAINLAYER_PROJECT"],
            ],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0:
            ingested += 1
            print(f"  [{score}/10] {title}")
        else:
            failed += 1
            print(f"  WARN: Failed to store gem: {result.stderr[:100]}")
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        failed += 1
        print(f"  WARN: brainlayer CLI error: {e}")
        # Fallback: write to a file for manual ingestion
        fallback_path = os.path.join(os.path.dirname(manifest_path), "gems-for-brainlayer.jsonl")
        with open(fallback_path, "a") as f:
            entry = {"content": content, "type": "bookmark", "tags": ["gem", streamer, gem_type], "importance": importance}
            f.write(json.dumps(entry) + "\n")
        print(f"  Fallback: written to gems-for-brainlayer.jsonl")

# Store a session summary
summary = f"Stream gems summary: {streamer} ({date})\n"
summary += f"Total gems: {len([g for g in gems if g.get('score', 0) >= 7])}\n"
summary += f"Top gems:\n"
for gem in sorted(gems, key=lambda g: -g.get("score", 0))[:5]:
    summary += f"  [{gem.get('score')}/10] {gem.get('title', 'untitled')} @ {gem.get('timestamp', '?')}\n"
if vod_url:
    summary += f"VOD: {vod_url}\n"

try:
    subprocess.run(
        [
            "brainlayer", "store",
            "--content", summary,
            "--type", "note",
            "--tags", json.dumps(["gem-summary", streamer]),
            "--importance", "6",
            "--project", os.environ["BRAINLAYER_PROJECT"],
        ],
        capture_output=True, text=True, timeout=10
    )
except:
    pass

print(f"\nIngested {ingested} gems into BrainLayer ({failed} failed)")

# Only write marker if all gems succeeded (allow retries on partial failure)
if failed == 0 and ingested > 0:
    marker_path = os.path.join(os.path.dirname(manifest_path), ".brainlayer-ingested")
    with open(marker_path, "w") as f:
        f.write(f"{ingested} gems ingested at {date}\n")
elif failed > 0:
    print(f"WARNING: {failed} gems failed — marker NOT written (re-run to retry)")
    sys.exit(1)
PYEOF

log "Done!"
