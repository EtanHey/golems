# EmailGolem

Smart email triage for Gmail. Scores and routes emails in memory.

---

## What It Does

- **Polls Gmail** every 10 minutes
- **Scores emails** 1-10 using Ollama AI

---

## Quick Start

### 1. Prerequisites

- Bun runtime
- Ollama running locally with `qwen2.5-coder:32b`
- Gmail API credentials (OAuth2)

### 2. Environment Setup

Add to `.env`:
```bash
# Gmail OAuth (from Google Cloud Console)
GMAIL_CLIENT_ID=your-client-id
GMAIL_CLIENT_SECRET=your-client-secret
GMAIL_REFRESH_TOKEN=your-refresh-token

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

### 5. Test Run

```bash
# Dry run - no writes, no notifications
bun packages/shared/src/email/index.ts --dry-run

# With specific count
bun packages/shared/src/email/index.ts --dry-run --max=5
```

### 6. Enable Scheduler

EmailGolem has no LaunchAgent of its own. The cloud worker
(`packages/services/src/cloud-worker.ts`) runs it hourly from 6am to 7pm
(skipping noon), once at 10pm, and not overnight:

```bash
cd packages/services && bun run cloud-worker
```

---

## Usage

### CLI Options

```bash
bun packages/shared/src/email/index.ts [options]

Options:
  --dry-run, -n    Skip routing and state writes
  --max=N          Maximum emails to fetch (default: 20)
  --help, -h       Show help
```

### Manual Trigger

```bash
# Full run
bun packages/shared/src/email/index.ts

# Check specific number of emails
bun packages/shared/src/email/index.ts --max=50
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
| 10 | `interview`, `urgent` | Route in memory | Interview invite, payment failed |
| 7-9 | `job` | Route in memory | Application status, recruiter message |
| 5-6 | `subscription` | Classify in memory | Netflix receipt, renewal notice |
| 3-4 | `other` | Log only | Job digests, rejections |
| 1-2 | `newsletter`, `promo` | Ignore | Marketing, spam |

---

## Storage retirement

Scoring and routing use the current in-memory batch. Local state retains processed IDs.
The dropped-table storage, retry queue, and email/subscription briefing sections are retired.
MCP tools provide Gmail search and reply drafts. No notification delivery is configured.

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

### Scheduler Issues

**Not running**
- Check the cloud worker is running (`pgrep -fl cloud-worker`) and read its
  output for `EmailGolem` lines.
- Run one pass by hand: `bun packages/shared/src/email/index.ts --dry-run`

---

## File Structure

```
email-golem/
├── index.ts           # Main entry point
├── gmail-client.ts    # Gmail API wrapper
├── scorer.ts          # Ollama scoring
├── types.ts           # TypeScript interfaces
├── CONTEXT.md         # Agent documentation
└── README.md          # This file
```

---

## State Files

| Path | Purpose |
|------|---------|
| `~/.golems-zikaron/state.json` | Last check time, processed IDs |

---

## Disable/Remove

```bash
# Disable: stop the cloud worker, or remove EmailGolem from its schedule

# Clear state (start fresh)
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
