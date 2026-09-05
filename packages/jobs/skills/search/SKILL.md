---
name: search
description: Search job matches by keyword, company, or score threshold from the scraped job database.
---

# Job Search

Search through scraped and scored job listings.

**Arguments**: $ARGUMENTS — search query (keyword, company name, or "score:N" for minimum score)

## Process

1. Parse search query — detect if it's a keyword, company filter, or score threshold
2. Query job database (Supabase or local) with filters
3. Show results sorted by match score (highest first):
   - Company name, role title
   - Match score (1-10)
   - Key requirements snippet
   - Posting date, source board
4. For score 8+ matches: note that auto-outreach is available via RecruiterGolem

## Examples

- `search frontend react` — keyword search
- `search company:Google` — filter by company
- `search score:8` — only high-score matches
