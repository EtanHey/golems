# ClaudeGolem Status

Show current ClaudeGolem status:

1. Check if Telegram bot is running (`pgrep -fl telegram-bot`)
2. Check notification server on port 3847 (`curl -s http://localhost:3847/health`)
3. Show recent event log entries from `~/.golems-zikaron/event-log.json`
4. Show active Claude sessions and queue depth
