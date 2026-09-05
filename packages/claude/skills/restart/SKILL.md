---
name: restart
description: Restart the Telegram bot and notification server. Use when bot is unresponsive or after code changes.
---

# Restart ClaudeGolem

Restart the Telegram bot and notification server:

1. Stop existing bot: `pkill -f "bun.*telegram-bot"`
2. Wait 3 seconds for port 3847 to release (SIGTERM handler needs time)
3. Verify port is free: `lsof -i :3847` should return nothing
4. Start bot from the claude package directory: `bun run bot &`
5. Wait 2 seconds, then verify:
   - Process running: `pgrep -fl telegram-bot`
   - Port listening: `curl -sf http://localhost:3847/health`

If port 3847 is still in use after step 3, the old process didn't shut down cleanly. Kill it forcefully with `kill -9` on the PID from `lsof -i :3847`.
