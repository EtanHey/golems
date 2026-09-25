#!/bin/bash
# Score an existing transcript with Gemini — no re-transcription needed.
# Usage: score-transcript.sh <transcript.md> [output-gems.md]
set -euo pipefail

TRANSCRIPT="${1:?Usage: score-transcript.sh <transcript.md> [output-gems.md]}"
GEMS_FILE="${2:-$(dirname "$TRANSCRIPT")/gems.md}"

source "$HOME/Gits/golems/.env" 2>/dev/null || true
GEMINI_KEY="${GOOGLE_GENERATIVE_AI_API_KEY:-}"
if [ -z "$GEMINI_KEY" ]; then
    echo "ERROR: No GOOGLE_GENERATIVE_AI_API_KEY found"
    exit 1
fi

log() { echo "[$(date '+%H:%M:%S')] $1"; }

SCORING_PROMPT="You are scoring stream transcript segments for a developer named Etan.

What Etan cares about (flag these as HIGH):
- Job leads / hiring signals
- Tech decisions (why X over Y, architecture patterns)
- Anything about Railway, Supabase, Vercel, Convex, Bun, Next.js
- AI/LLM insights (model comparisons, prompting, agents)
- PR/contribution mentions from community
- Tool recommendations

What Etan is building:
- Golems: autonomous AI agent monorepo (Bun, TypeScript)
- BrainLayer: memory layer for Claude Code (Python, sqlite-vec)
- VoiceLayer: voice I/O for AI assistants
- TaskOwl: real estate app (Expo, Convex)

Score 1-10 for relevance to Etan. Reply with ONLY a JSON object:
{\"score\": N, \"type\": \"job|tech|tool|architecture|ai|mention|funny|filler\", \"reason\": \"one sentence\"}"

echo "# Gems: $(basename "$(dirname "$TRANSCRIPT")") " > "$GEMS_FILE"
echo "" >> "$GEMS_FILE"

CURRENT_HEADER=""
CURRENT_TEXT=""
GEM_COUNT=0

score_segment() {
    local header="$1"
    local text="$2"
    [ -z "$text" ] && return

    # Escape for JSON — handle quotes, backslashes, newlines, control chars
    local escaped_text
    escaped_text=$(echo "$text" | tr '\n' ' ' | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g' | LC_ALL=C tr -cd '[:print:] ' | cut -c1-2000)

    RESULT=$(curl -sf "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent" \
        -H "Content-Type: application/json" \
        -H "x-goog-api-key: ${GEMINI_KEY}" \
        -d "{
            \"contents\": [{\"parts\": [{\"text\": \"${SCORING_PROMPT}\n\nSegment:\n${escaped_text}\"}]}],
            \"generationConfig\": {\"maxOutputTokens\": 100}
        }" 2>/dev/null | /Library/Frameworks/Python.framework/Versions/3.13/bin/python3 -c "
import sys, json
try:
    r = json.load(sys.stdin)
    text = r['candidates'][0]['content']['parts'][0]['text'].strip()
    if '{' in text:
        text = text[text.index('{'):text.rindex('}')+1]
    d = json.loads(text)
    print(f\"{d.get('score',0)}|{d.get('type','unknown')}|{d.get('reason','')}\")
except:
    print('5|unknown|parse error')
" 2>/dev/null || echo "5|unknown|api error")

    SCORE=$(echo "$RESULT" | cut -d'|' -f1)
    TYPE=$(echo "$RESULT" | cut -d'|' -f2)
    REASON=$(echo "$RESULT" | cut -d'|' -f3-)

    log "  [$SCORE/10 $TYPE] $(echo "$header" | head -1)"

    if [ "${SCORE:-0}" -ge 7 ] 2>/dev/null; then
        GEM_COUNT=$((GEM_COUNT + 1))
        echo "### $header" >> "$GEMS_FILE"
        echo "**Score:** $SCORE/10 | **Type:** $TYPE" >> "$GEMS_FILE"
        echo "**Why:** $REASON" >> "$GEMS_FILE"
        echo "" >> "$GEMS_FILE"
        echo "$text" >> "$GEMS_FILE"
        echo "" >> "$GEMS_FILE"
        log "  ^ GEM!"
    fi

    # Rate limit: 15 req/min free tier
    sleep 5
}

log "Scoring transcript: $TRANSCRIPT"
log "Output: $GEMS_FILE"

while IFS= read -r line; do
    if [[ "$line" == "## ["* ]]; then
        [ -n "$CURRENT_TEXT" ] && score_segment "$CURRENT_HEADER" "$CURRENT_TEXT"
        CURRENT_HEADER="$line"
        CURRENT_TEXT=""
    elif [[ "$line" != "**Chat"* ]] && [[ "$line" != '```'* ]] && [[ "$line" != "# Stream"* ]] && [[ -n "$line" ]]; then
        CURRENT_TEXT="$CURRENT_TEXT $line"
    fi
done < "$TRANSCRIPT"
# Score last segment
[ -n "$CURRENT_TEXT" ] && score_segment "$CURRENT_HEADER" "$CURRENT_TEXT"

echo "" >> "$GEMS_FILE"
echo "---" >> "$GEMS_FILE"
echo "Source transcript: $TRANSCRIPT" >> "$GEMS_FILE"
echo "Gems found: $GEM_COUNT" >> "$GEMS_FILE"
echo "Scored: $(date)" >> "$GEMS_FILE"

log "Done! Found $GEM_COUNT gems."
