---
name: review
description: Review past conversation debriefs from Obsidian
---

# Review Past Debriefs

## Process

1. List debrief files:
```bash
VAULT="$OBSIDIAN_VAULT"
find "$VAULT" -type f \( -name "*Debrief*" -o -name "*Practice Notes*" \) | sort -r
```

2. Read the requested debrief
3. Summarize: key points, action items status, red flags
4. Compare with prep docs if they exist (same company name)

## Use Cases

- "What did I learn from the 6PM meeting?"
- "Show me all my debriefs"
- "What red flags have I seen across interviews?"
- "What action items am I behind on?"
