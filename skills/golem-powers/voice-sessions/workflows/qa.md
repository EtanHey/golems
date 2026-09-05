---
name: qa
description: Voice-powered QA testing — uses VoiceLayer schemas (qa-categories.ts, checklist.ts)
---

# QA Workflow

> Stub — delegates to VoiceLayer's built-in QA session flow.

## How to Use

This workflow uses the VoiceLayer MCP's QA infrastructure:
- `voicelayer/src/schemas/qa-categories.ts` — 31 checks across 6 categories
- `voicelayer/src/schemas/checklist.ts` — checklist tracking
- `voicelayer/src/report.ts` — report generation

See VoiceLayer's CLAUDE.md for full QA session documentation.

## Quick Start

1. Navigate to the site in Playwright
2. Use voice_ask for each check category
3. Generate report with VoiceLayer report tools
