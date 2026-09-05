# EmailGolem

Smart email triage for Gmail. Scores emails, alerts on urgent, tracks subscriptions.

---

## What It Does

- **Polls Gmail** every 10 minutes
- **Scores emails** 1-10 using Ollama AI
- **Alerts immediately** on score 10 (interviews, payment failures)
- **Morning digest** of job updates and payments
- **Monthly report** of subscription spending

---

## Quick Start

### 1. Prerequisites

- Bun runtime
- Ollama running locally with `qwen2.5-coder:32b`
- Gmail API credentials (OAuth2)
- Supabase project with tables created

### 2. Environment Setup

Add to `.env`:
```bash
# Gmail OAuth (from Google Cloud Console)
GMAIL_CLIENT_ID=your-client-id
GMAIL_CLIENT_SECRET=your-client-secret
GMAIL_REFRESH_TOKEN=your-refresh-token

# Supabase (from project settings)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
```

### 3. Gmail OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create project or select existing
3. Enable Gmail API
4. Create OAuth 2.0 credentials (Desktop app)
5. Run first-time auth:
   ```bash
   bun run scripts/gmail-auth.ts
   ```
6. Copy the refresh token to `.env`

### 4. Database Setup

Run the migration in Supabase SQL editor:
```sql
-- See supabase/migrations/001_email_golem_tables.sql
```

### 5. Test Run

```bash
# Dry run - no writes, no notifications
bun run src/email-golem/index.ts --dry-run

# With specific count
bun run src/email-golem/index.ts --dry-run --max=5
```

### 6. Enable Scheduler

```bash
# Copy plist to LaunchAgents
cp launchd/com.golemszikaron.email-golem.plist ~/Library/LaunchAgents/

# Enable (runs every 10 minutes)
launchctl load ~/Library/LaunchAgents/com.golemszikaron.email-golem.plist

# Check status
launchctl list | grep email-golem
```

---

## Usage

### CLI Options

```bash
bun run src/email-golem/index.ts [options]

Options:
  --dry-run, -n    Don't save to DB or send notifications
  --max=N          Maximum emails to fetch (default: 20)
  --help, -h       Show help
```

### Manual Trigger

```bash
# Full run
bun run src/email-golem/index.ts

# Check specific number of emails
bun run src/email-golem/index.ts --max=50
```

### View Logs

```bash
# Live logs
tail -f /tmp/golemszikaron-email-golem.log

# Recent entries
tail -100 /tmp/golemszikaron-email-golem.log
```

---

## Scoring System

| Score | Category | Action | Examples |
|-------|----------|--------|----------|
| 10 | `interview`, `urgent` | Telegram alert NOW | Interview invite, payment failed |
| 7-9 | `job` | Morning briefing | Application status, recruiter message |
| 5-6 | `subscription` | Track for monthly | Netflix receipt, renewal notice |
| 3-4 | `other` | Log only | Job digests, rejections |
| 1-2 | `newsletter`, `promo` | Ignore | Marketing, spam |

---

## Notifications

Urgent emails (score 10) trigger immediate Telegram notifications.

**Requires:** Telegram bot running on port 3847
```bash
cd ~/Gits/golems/packages/autonomous && bun run bot
```

Notification format:
```
📅 Urgent Email
interview: Interview Scheduled: Senior SWE at Microsoft
```

---

## Morning Briefing Integration

EmailGolem adds these sections to `/morning`:

### 24-Hour Email Digest
```
📧 *Emails (24h)*

🔴 *Urgent* (already notified):
   → Microsoft Interview - tomorrow 2pm

💼 *Job Updates:*
   → Meta - Application received

💳 *Payments:*
   → Netflix charged $15.99

_3 job updates • 1 alert • 2 payments_
```

### Monthly Subscription Report (1st of month)
```
💳 *Subscriptions Report - February 2026*

*Active Services:*
   → Netflix: $15.99
   → Spotify: $10.99
   → Claude Pro: $20.00

*Total:* `$46.98/month`

*Changes this month:*
✅ Added: Cursor Pro
```

---

## Troubleshooting

### Gmail Auth Errors

**"Missing Gmail credentials"**
- Check `.env` has all three: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`

**"invalid_grant"**
- Refresh token expired. Re-run `bun run scripts/gmail-auth.ts`

### Ollama Errors

**"Could not connect to Ollama"**
- Start Ollama: `ollama serve`
- Check model exists: `ollama list` (should show `qwen2.5-coder:32b`)

**Low scores on everything**
- Ollama may be failing silently. Check logs for "Scoring unavailable"
- Fallback uses score=5, category="unknown"

### Supabase Errors

**"Missing SUPABASE_URL"**
- Check `.env` has `SUPABASE_URL` and `SUPABASE_ANON_KEY`

**Items queuing but not syncing**
- Check offline queue: `cat ~/.golems-zikaron/offline-queue.json`
- Verify Supabase is accessible
- Run manual sync: email-golem syncs on each startup

### Notifications Not Working

**No Telegram messages**
- Check bot is running: `pgrep -fl telegram-bot`
- Check port 3847: `curl http://localhost:3847/health`
- Check logs for notification errors

### Scheduler Issues

**Not running**
```bash
# Check if loaded
launchctl list | grep email-golem

# Check for errors
cat /tmp/golemszikaron-email-golem.log

# Reload
launchctl unload ~/Library/LaunchAgents/com.golemszikaron.email-golem.plist
launchctl load ~/Library/LaunchAgents/com.golemszikaron.email-golem.plist
```

---

## File Structure

```
email-golem/
├── index.ts           # Main entry point
├── gmail-client.ts    # Gmail API wrapper
├── scorer.ts          # Ollama scoring
├── db-client.ts       # Supabase + offline queue
├── types.ts           # TypeScript interfaces
├── CONTEXT.md         # Agent documentation
└── README.md          # This file
```

---

## State Files

| Path | Purpose |
|------|---------|
| `~/.golems-zikaron/state.json` | Last check time, processed IDs |
| `~/.golems-zikaron/offline-queue.json` | Queued items when offline |
| `/tmp/golemszikaron-email-golem.log` | Runtime logs |

---

## Disable/Remove

```bash
# Disable scheduler
launchctl unload ~/Library/LaunchAgents/com.golemszikaron.email-golem.plist

# Remove scheduler
rm ~/Library/LaunchAgents/com.golemszikaron.email-golem.plist

# Clear state (start fresh)
rm ~/.golems-zikaron/offline-queue.json
# Edit state.json to remove lastEmailCheck and processedEmailIds
```

---

## Development

### Run Tests

```bash
bun test email-golem
```

### Test Fixtures

See `src/__tests__/email-golem/` for test fixtures covering:
- Interview detection (score 10)
- Payment failed (score 10)
- Job updates (score 7)
- Subscription receipts (score 5)
- Newsletter/promo (score 1-2)
- Offline queue resilience
