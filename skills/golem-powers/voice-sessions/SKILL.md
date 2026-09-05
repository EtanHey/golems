---
name: voice-sessions
description: "VoiceLayer sessions for debriefs, practice, QA, capture, KG review. Triggers: meeting debrief, voice drilling."
---

# Voice Sessions

> Structured voice-powered sessions using VoiceLayer MCP.

## Workflows

| What you want to do | Workflow |
|---------------------|---------|
| Debrief a conversation | [workflows/debrief.md](workflows/debrief.md) |
| Practice a presentation/pitch | [workflows/practice.md](workflows/practice.md) |
| QA test a site with voice | [workflows/qa.md](workflows/qa.md) |
| Quick text-only capture | [workflows/quick.md](workflows/quick.md) |
| Review past sessions | [workflows/review.md](workflows/review.md) |
| KG flag-batch review by voice | [workflows/kg-review.md](workflows/kg-review.md) |

## How It Works

Typical flow: Context → Walk-through → Drill → Capture → Output (Obsidian note).

Voice tools: `voice_speak` (non-blocking TTS) + `voice_ask` (blocking Q&A). Mode is auto-detected from message content.

## Requirements

- VoiceLayer MCP connected
- Obsidian vault configured
- Text fallback available if voice isn't connected
