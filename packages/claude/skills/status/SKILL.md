---
name: status
description: Show ClaudeGolem status — bot process, notification server, event log, active sessions, Night Shift target.
---

# ClaudeGolem Status

Check the health and state of ClaudeGolem infrastructure:

1. **Bot process**: `pgrep -fl telegram-bot` — is the Telegram bot running?
2. **Notification server**: `curl -sf http://localhost:3847/health` — is port 3847 alive?
3. **Recent events**: Read last 10 entries from `~/.golems-zikaron/event-log.json`
4. **Night Shift**: Read `nightShiftTarget` and `lastNightShift` from `~/.golems-zikaron/state.json`
5. **Active sessions**: Check for running Claude CLI processes

Report in a concise table format.
