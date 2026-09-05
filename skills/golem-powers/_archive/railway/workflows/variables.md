---
name: variables
description: Manage Railway environment variables
---

# Manage Environment Variables

```bash
# List all variables
railway variables

# Set a variable
railway variables set KEY=value

# Set multiple
railway variables set KEY1=value1 KEY2=value2

# Delete a variable
railway variables delete KEY
```

## Required Variables

| Variable | Purpose |
|----------|---------|
| `LLM_BACKEND` | `haiku` (use Anthropic API) |
| `STATE_BACKEND` | `supabase` (use Supabase for state) |
| `TELEGRAM_MODE` | `direct` (send via Bot API) |
| `ANTHROPIC_API_KEY` | Haiku API key |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon key |
| `GMAIL_CLIENT_ID` | Gmail OAuth |
| `GMAIL_CLIENT_SECRET` | Gmail OAuth |
| `GMAIL_REFRESH_TOKEN` | Gmail OAuth |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `TELEGRAM_CHAT_ID` | Group chat ID |
| `TELEGRAM_TOPIC_*` | Topic thread IDs |
