# @golems/teller

TellerGolem — financial tracking, subscription management, payment categorization, and tax preparation.

## What It Does

- Detects subscriptions from email receipts (Netflix, Spotify, iCloud, etc.)
- Categorizes payments using LLM (Haiku) into spending categories
- Generates monthly and yearly spending reports
- Identifies US tax deductions (Schedule C)
- Alerts on spending anomalies (unusual charges, failed payments, price increases)
- Converts yearly subscriptions to monthly for unified reporting

## Quick Start

```bash
cd packages/teller
bun src/index.ts       # Check status
```

## Payment Categories

LLM-powered categorization into: housing, transport, food, subscriptions, healthcare, entertainment, business, utilities, and more.

## Reports

| Report | Content |
|--------|---------|
| Monthly | Total spend, breakdown by category, subscription total |
| Yearly | Tax-relevant deductions, subscription trends, anomalies |

## Architecture

```
packages/teller/
├── src/
│   ├── index.ts           # getStatus() + orchestration
│   ├── categorizer.ts     # LLM payment categorization
│   ├── alerts.ts          # Spending anomaly detection
│   ├── report.ts          # Monthly/yearly report generation
│   ├── db.ts              # Supabase queries
│   └── types.ts           # TellerGolem types
└── CLAUDE.md
```

## Supabase Tables

| Table | Purpose |
|-------|---------|
| `subscriptions` | Active service subscriptions |
| `payments` | Payment events linked to subscriptions |

## Email Routing

Emails categorized as `subscription` by the email scorer are automatically routed to TellerGolem.

## Dependencies

- `@golems/shared` — Supabase, event log, LLM, email infrastructure
