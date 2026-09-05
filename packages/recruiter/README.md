# @golems/recruiter

RecruiterGolem — contact finding, style-adapted outreach, interview practice with Elo tracking, and LinkedIn connection matching.

## What It Does

- Finds hiring managers at target companies via web search
- Drafts personalized outreach messages adapted to recipient style
- Tracks conversations and follow-ups in dual storage (local SQLite + cloud Supabase)
- Runs interview practice sessions with Elo ratings across 7 modes
- Matches job listings against 823 LinkedIn connections for warm intros

## Quick Start

```bash
cd packages/recruiter
bun src/index.ts       # Check status
```

## Outreach Pipeline (E1-E6)

```
E1: Contact Finder → E2: Outreach DB → E3: Style Adapter
→ E4: Auto-Outreach → E5: Company Research → E6: Obsidian Export
```

1. **Contact Finder** — web search for hiring managers at target companies
2. **Outreach DB** — track contacts, messages, response status
3. **Style Adapter** — match tone/formality to recipient profile
4. **Auto-Outreach** — automated pipeline for high-score (8+) job matches
5. **Company Research** — enrich outreach with company context
6. **Obsidian Export** — export pipeline data for review

## Interview Practice

7 modes with Elo-rated skill tracking:

- Behavioral, Technical, System Design, Code Review, Optimization, Debugging, Mixed

Practice sessions are stored in Supabase for cross-device continuity. Elo ratings persist per category.

## Dual Storage

| Backend | When | Config |
|---------|------|--------|
| SQLite | Local development | `STATE_BACKEND=file` |
| Supabase | Hosted/successor runtime | `STATE_BACKEND=supabase` |

## Architecture

```
packages/recruiter/
├── src/
│   ├── index.ts               # getStatus() for CoachGolem reads
│   ├── contact-finder.ts      # Find hiring managers via web search
│   ├── draft-outreach.ts      # Style-adapted outreach messages
│   ├── style-adapter.ts       # Communication style matching
│   ├── auto-outreach.ts       # Automated outreach pipeline
│   ├── outreach-db.ts         # SQLite storage (local)
│   ├── outreach-db-cloud.ts   # Supabase storage (cloud)
│   ├── practice-db.ts         # SQLite practice storage
│   ├── practice-db-cloud.ts   # Supabase practice storage
│   ├── elo.ts                 # Elo rating system
│   ├── company-research.ts    # Company context enrichment
│   └── obsidian-export.ts     # Export to Obsidian vault
└── CLAUDE.md
```

## Dependencies

- `@golems/shared` — Supabase, event log, LLM, state store
