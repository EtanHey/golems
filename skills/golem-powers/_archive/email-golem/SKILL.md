---
name: email-golem
description: "Email triage system using Gmail + MLX local inference for scoring and prioritization. Use when: checking emails, running email triage, viewing urgency scores, checking if email scheduler is running, debugging missing email notifications, or managing the launchd email-golem daemon. Scores emails 1-10 and sends Telegram alerts for urgent ones. NOT for: general Gmail search without triage context."
---

# EmailGolem - Email Triage Control

Check status, run manual triage, view recent scores, and manage the email system.

## Commands

### Check Status

```bash
# View scheduler status
launchctl list | grep email-golem

# View recent logs
tail -20 /tmp/golems-email-golem.log

# View offline queue
cat ~/.local/share/brainlayer/offline-queue.json 2>/dev/null || echo "Queue empty"
```

### Manual Run

```bash
# Dry run (safe - no DB writes, no notifications)
cd ~/Gits/golems && bun run packages/shared/src/email/index.ts --dry-run

# Full run (will score, save, and notify if urgent)
cd ~/Gits/golems && bun run packages/shared/src/email/index.ts

# Check specific number of emails
cd ~/Gits/golems && bun run packages/shared/src/email/index.ts --dry-run --max=5
```

### Scheduler Control

```bash
# Enable (runs every 10 minutes)
launchctl load ~/Library/LaunchAgents/com.golems.email-golem.plist

# Disable
launchctl unload ~/Library/LaunchAgents/com.golems.email-golem.plist

# Reload (after changes)
launchctl unload ~/Library/LaunchAgents/com.golems.email-golem.plist
launchctl load ~/Library/LaunchAgents/com.golems.email-golem.plist
```

## When To Use

- **"Check my emails"** → Run dry-run to see what would be scored
- **"Any urgent emails?"** → Run dry-run and check for score 10
- **"Is email checker running?"** → Check launchctl status
- **"Why no email notifications?"** → Check logs for errors

## Scoring Reference

| Score | Category | Action |
|-------|----------|--------|
| 10 | interview, urgent | Telegram alert NOW |
| 7-9 | job | Morning briefing |
| 5-6 | subscription | Monthly tracking |
| 1-4 | newsletter, promo | Ignore |

## Troubleshooting

### No emails scoring

1. Check Gmail credentials in `.env`
2. Check MLX backend is available: `which mlx_lm.generate`
3. Check logs: `tail -50 /tmp/golems-email-golem.log`

### Notifications not working

1. Check telegram-bot is running: `pgrep -fl telegram-bot`
2. Check port 3847: `curl http://localhost:3847/health`

### Items stuck in queue

```bash
# View queue
cat ~/.local/share/brainlayer/offline-queue.json

# Clear queue (if corrupt)
rm ~/.local/share/brainlayer/offline-queue.json
```

## Related Files

- `~/Gits/golems/packages/shared/src/email/` - Source code
- `~/Gits/golems/packages/shared/src/email/index.ts` - Entry point
- `~/.local/share/brainlayer/state.json` - State (lastEmailCheck, processedIds)

## Requirements

- Telegram bot running on port 3847 (for notifications)
- MLX backend for local inference
- Gmail OAuth configured
- Supabase tables created
