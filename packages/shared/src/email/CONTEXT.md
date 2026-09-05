# EmailGolem - Agent Context

> For Claude agents working on this codebase.

---

## What Is This?

EmailGolem is an automated email triage system that:
1. Polls Gmail every 10 minutes via launchd
2. Scores emails using Ollama (qwen2.5-coder:32b)
3. Stores results in Supabase with offline resilience
4. Sends immediate Telegram alerts for urgent emails (score 10)
5. Provides 24h email digest in morning briefing
6. Tracks subscriptions for monthly spend reports

---

## Architecture

```
Gmail API (poll every 10 min)
           ↓
    gmail-client.ts  ← OAuth2 with refresh token
           ↓
      scorer.ts      ← Ollama JSON scoring
           ↓
    db-client.ts     ← Supabase with offline queue
           ↓
  ┌────────┴────────┐
  │                 │
Score >= 10      Score 5-9
  │                 │
Telegram NOW    briefing.ts
(port 3847)     (morning digest)
```

---

## Files

| File | Purpose | Key Functions |
|------|---------|---------------|
| `index.ts` | Main entry point, CLI | `processEmails()`, `processEmail()` |
| `gmail-client.ts` | Gmail API wrapper | `fetchRecentEmails()`, `fetchEmailsSince()` |
| `scorer.ts` | Ollama scoring + categories | `scoreEmail()`, `extractSubscriptionInfo()` |
| `db-client.ts` | Supabase + offline queue | `saveEmail()`, `trackSubscription()`, `syncOfflineQueue()` |
| `types.ts` | TypeScript interfaces | `Email`, `Subscription`, `Payment` |

---

## Scoring Criteria

| Score | Action | Examples |
|-------|--------|----------|
| **10** | Telegram NOW | Interview invite, payment failed, urgent deadline |
| **7-9** | Morning briefing | Job status update, recruiter message |
| **5-6** | Track for monthly | Subscription receipts, renewal confirmations |
| **3-4** | Log only | Job digests, rejections, confirmations |
| **1-2** | Ignore | Newsletters, promos, spam |

**Category enum:** `interview`, `urgent`, `job`, `subscription`, `newsletter`, `promo`, `other`

---

## Database Schema (Supabase)

```sql
-- emails: Scored emails with categories
create table emails (
  id uuid primary key default gen_random_uuid(),
  gmail_id text unique not null,
  subject text,
  from_address text,
  snippet text,
  score int,
  category text,
  received_at timestamptz,
  scored_at timestamptz default now(),
  notified boolean default false
);

-- subscriptions: Tracked services
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  service_name text not null,
  amount decimal(10,2),
  currency text default 'USD',
  frequency text,  -- 'monthly', 'yearly', 'one-time'
  status text default 'active',
  first_seen timestamptz default now(),
  last_payment timestamptz,
  created_at timestamptz default now()
);

-- payments: Payment events
create table payments (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references subscriptions(id),
  email_id uuid references emails(id),
  amount decimal(10,2),
  currency text default 'USD',
  paid_at timestamptz,
  created_at timestamptz default now()
);
```

---

## State Management

State stored in `~/.golems-zikaron/state.json`:

```json
{
  "lastEmailCheck": "2026-02-02T10:00:00.000Z",
  "processedEmailIds": ["msg-abc123", "msg-def456", ...]
}
```

- `lastEmailCheck` - timestamp of last successful poll
- `processedEmailIds` - deduplication (capped at 500)

---

## Offline Resilience

All Supabase operations use `safeInsert()` / `safeUpsert()`:

1. Try Supabase operation
2. On failure → queue to `~/.golems-zikaron/offline-queue.json`
3. On startup → `syncOfflineQueue()` retries queued items

**Never lose data** - if Supabase is down, items are queued locally.

---

## Integration Points

### Notifications (port 3847)
```typescript
await fetch("http://localhost:3847/notify", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    title: "📅 Urgent Email",
    body: "Interview: Microsoft...",
    source: "email-golem",
    priority: "high"
  })
});
```

Requires `telegram-bot.ts` running.

### Morning Briefing
`briefing.ts` imports from this module:
- `getRecentEmails(client, 24, 5)` - 24h, score >= 5
- `getSubscriptionSummary(client)` - monthly report

---

## Key Patterns

### Ollama JSON Scoring
```typescript
const result = await runOllamaJSON<OllamaScoreResult>(prompt, "email-golem");
// Returns: { score: 10, category: "interview", reason: "...", subscription: null }
```

Fallback on Ollama failure: score=5, category="unknown", use local regex extraction.

### Subscription Extraction
`extractSubscriptionInfo()` does quick regex before/instead of Ollama:
- Known services map (Netflix, Spotify, etc.)
- Amount: `$X.XX` pattern
- Frequency: monthly/yearly/one-time keywords

### Deduplication
```typescript
const processedIds = new Set(state.processedEmailIds || []);
const newEmails = emails.filter((e) => !processedIds.has(e.id));
```

---

## Testing

```bash
# Run all email-golem tests
bun test email-golem

# Dry run (no DB writes, no notifications)
bun run src/email-golem/index.ts --dry-run

# With max emails
bun run src/email-golem/index.ts --dry-run --max=5
```

Tests mock `googleapis` and Supabase - no real API calls.

---

## Common Modifications

### Add a new email category
1. Add to `EmailCategory` type in `types.ts`
2. Update `buildScoringPrompt()` in `scorer.ts`
3. Add emoji to `CATEGORY_EMOJIS` in `index.ts`
4. Update briefing formatting if needed

### Add a new subscription service
Add to `KNOWN_SERVICES` map in `scorer.ts`:
```typescript
"newservice.com": "New Service",
```

### Change scoring thresholds
Edit `SCORE_THRESHOLDS` in `scorer.ts`:
```typescript
export const SCORE_THRESHOLDS = {
  IMMEDIATE: 10,
  BRIEFING_MIN: 7,
  TRACK_MIN: 5,
  IGNORE_MAX: 4,
};
```

---

## Known Limitations

1. **Gmail API quotas** - No retry with backoff (stay under 50 emails/poll)
2. **Ollama latency** - 300ms delay between emails (~25s for 50 emails)
3. **Subscription detection** - Regex-based, may miss new services
4. **Payment extraction** - Simple `$X.XX` regex, limited formats
5. **Payment linkage** - `subscription_id` is null (manual lookup by service_name)

---

## Environment Variables Required

```bash
# Gmail OAuth
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...

# Supabase
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
```

---

## Related Files

- `../briefing.ts` - Morning briefing integration
- `@golems/shared/lib/llm` (`../lib/llm.ts`) - Unified LLM facade and JSON helper
- `../../launchd/com.golemszikaron.email-golem.plist` - Scheduler
- `../../supabase/migrations/001_email_golem_tables.sql` - Schema
