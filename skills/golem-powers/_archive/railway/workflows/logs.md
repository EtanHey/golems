---
name: logs
description: View Railway deployment logs
---

# View Railway Logs

```bash
# Recent deploy logs (last 50 lines)
railway logs --num 50

# Follow logs in real-time
railway logs --follow

# Build logs for latest deployment
railway logs --build
```

## What to Look For

- **Startup:** "Cloud worker started", health check OK
- **Email runs:** "[EmailGolem] Processing X emails" (hourly 6am-7pm)
- **Job scrapes:** "[JobGolem] Scraping..." (6am, 9am, 1pm Sun-Thu)
- **Errors:** Any `[ERROR]` or unhandled exceptions
- **Haiku usage:** Token counts and cost per call
