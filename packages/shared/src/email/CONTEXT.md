# EmailGolem - Agent Context

> For Claude agents working on this codebase.

---

## What Is This?

EmailGolem is an automated email triage system that:
1. Polls Gmail hourly in the daytime, via the cloud worker (`packages/services/src/cloud-worker.ts`)
2. Scores emails using Ollama (qwen2.5-coder:32b)
3. Routes scored emails in memory and saves local deduplication state

---

## Architecture

```
Gmail API (poll every 10 min)
           ↓
    gmail-client.ts  ← OAuth2 with refresh token
           ↓
      scorer.ts      ← Ollama JSON scoring
           ↓
    router.ts        ← In-memory routing

```

---

## Files

| File | Purpose | Key Functions |
|------|---------|---------------|
| `index.ts` | Main entry point, CLI | `processEmails()`, `processEmail()` |
| `gmail-client.ts` | Gmail API wrapper | `fetchRecentEmails()`, `fetchEmailsSince()` |
| `scorer.ts` | Ollama scoring + categories | `scoreEmail()`, `extractSubscriptionInfo()` |
| `types.ts` | TypeScript interfaces | `Email`, `Subscription`, `Payment` |

---

## Scoring Criteria

| Score | Action | Examples |
|-------|--------|----------|
| **10** | Route in memory | Interview invite, payment failed, urgent deadline |
| **7-9** | Route in memory | Job status update, recruiter message |
| **5-6** | Classify in memory | Subscription receipts, renewal confirmations |
| **3-4** | Log only | Job digests, rejections, confirmations |
| **1-2** | Ignore | Newsletters, promos, spam |

**Category enum:** `interview`, `urgent`, `job`, `subscription`, `newsletter`, `promo`, `other`

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

## MCP Tools

Gmail search and reply drafting remain available. Database query tools and briefing sections are retired.

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
bun packages/shared/src/email/index.ts --dry-run

# With max emails
bun packages/shared/src/email/index.ts --dry-run --max=5
```

Tests mock Gmail and scoring - no real API calls.

---

## Common Modifications

### Add a new email category
1. Add to `EmailCategory` type in `types.ts`
2. Update `buildScoringPrompt()` in `scorer.ts`
3. Update briefing formatting if needed

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

---

## Environment Variables Required

```bash
# Gmail OAuth
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...

```

---

## Related Files

- `packages/shared/src/lib/llm.ts` (`@golems/shared/lib/llm`) - Unified LLM facade and JSON helper
- `packages/services/src/cloud-worker.ts` - Scheduler
