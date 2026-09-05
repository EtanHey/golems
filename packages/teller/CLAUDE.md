# TellerGolem

> Financial tracking — subscription management, payment categorization, tax preparation, and spending alerts.

## Role

TellerGolem manages **all financial intelligence**: tracking subscriptions, categorizing payments, generating spending reports, alerting on anomalies, and preparing data for tax filing.

---

## BrainBar Stub Warnings

BrainBar Swift daemon has 4 STUB tools returning fake success:
- brain_digest, brain_update, brain_expand, brain_tags — ALL BROKEN
- Working: brain_search, brain_store, brain_recall, brain_entity
- Last successful digest: March 14, 2026

---

## Compact Instructions

When compacting this session, follow these rules strictly:

### NEVER preserve
- /loop, QUEUE-OPERATION, cron polling (3+ identical system/cron messages = keep ZERO)
- BrainLayer search injections (re-injected fresh each turn)
- Full file contents re-readable from disk (keep path + one-line summary of decision made)

### ALWAYS preserve verbatim
- User vision/goal/decision statements (if stated 3x+, note "[USER STATED Nx]")
- User repetitions in DIFFERENT places = importance signal, keep ONE with annotation
- Short user messages (approvals, frustration signals) — these carry intent
- Sprint plan with priority ratings
- All decisions with rationale (WHY not just WHAT)
- Modified file paths with one-line change summary

### Structure summary as
1. **Session Intent**: What the user wants (exact quotes)
2. **Decisions Made**: Each + rationale + who
3. **Artifact Trail**: Files, tests, commands
4. **Current State**: Working/broken/in-progress
5. **Next Steps**: Ordered by sprint plan priority

---

## Architecture

```text
packages/teller/
├── src/
│   ├── index.ts                 # getStatus() + main orchestration
│   ├── categorizer.ts           # Payment categorization (LLM-powered)
│   ├── alerts.ts                # Spending anomaly alerts
│   ├── report.ts                # Monthly/yearly spending reports
│   ├── db.ts                    # Supabase queries (subscriptions, payments)
│   └── types.ts                 # TellerGolem-specific types
├── .claude-plugin/plugin.json
├── CLAUDE.md                    # This file
└── package.json                 # @golems/teller
```

## Dependencies

- `@golems/shared` — Supabase factory, event log, LLM, email infra

## Key Patterns

### Subscription Tracking
- Detects subscriptions from email receipts (Netflix, Spotify, iCloud, etc.)
- Tracks: service name, amount, currency, frequency (monthly/yearly), status
- Yearly subscriptions converted to monthly for unified reporting

### Payment Categorization
- Uses LLM (Haiku) to categorize payments from bank statements
- Categories: housing, transport, food, subscriptions, healthcare, etc.
- Supports US tax deduction identification (Schedule C)

### Spending Reports
- Monthly summary: total spend, by category, subscription total
- Yearly summary: tax-relevant deductions, subscription cost trends
- Anomaly alerts: unusual charges, failed payments, price increases

## Supabase Tables

| Table | Purpose |
|-------|---------|
| `subscriptions` | Active service subscriptions |
| `payments` | Payment events linked to subscriptions |
| `emails` (filtered) | Subscription-category emails routed from EmailGolem |

## Email Routing

Emails categorized as `subscription` are routed to TellerGolem by the email router.
