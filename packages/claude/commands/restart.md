# Restart ClaudeGolem

Restart the Telegram bot and notification server:

1. Stop existing bot: `pkill -f "bun.*telegram-bot"`
2. Wait 2 seconds for port 3847 to release
3. Start bot from the claude package: `bun run bot` (from `packages/claude/`)
4. Verify: check port 3847 is listening and bot responds to /status
