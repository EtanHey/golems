# Prompt: Fix Job Scraper (Issue #72)

> Give this prompt to a fresh Claude session in the golems repo.

---

## Task

Fix two job scraper issues in `packages/jobs/src/scraper.ts`:

### 1. Drushim: Generic Titles (17/52 jobs)
- **Problem:** 17 out of 52 Drushim jobs have generic titles like "Job #35******" instead of actual job titles
- **Likely cause:** Scraper not waiting for dynamic JS content to render, or using a fallback title that includes the job ID
- **Fix:** Find the Drushim scraper function, check how titles are extracted, add proper selector targeting or wait for dynamic content

### 2. SecretTLV: Missing Descriptions (35/35 jobs)
- **Problem:** ALL 35 SecretTLV jobs have empty/null descriptions
- **Likely cause:** Descriptions loaded dynamically via API or in a different DOM element
- **Fix:** Investigate how SecretTLV pages structure their job descriptions, update selectors

### 3. Validation
- Add validation that logs a warning when a job has a generic "Job #" title or empty description
- Don't skip these jobs entirely — save them but mark quality as degraded

## Steps

1. Read `packages/jobs/src/scraper.ts` — find the Drushim and SecretTLV scraper functions
2. Read `packages/jobs/CLAUDE.md` for package context
3. For Drushim: check the title extraction logic, fix selector or add wait
4. For SecretTLV: inspect the description extraction, fix selector
5. Add quality validation (warn on generic titles / empty descriptions)
6. Run tests: `bun test packages/jobs/`
7. Test locally if possible: run a single scrape and verify titles/descriptions
8. Create a branch `fix/scraper-titles-descriptions`, commit, and create PR

## Data Evidence

```sql
SELECT source, COUNT(*) as total,
  COUNT(*) FILTER (WHERE title LIKE 'Job #%') as generic_titles,
  COUNT(*) FILTER (WHERE description IS NULL OR description = '') as no_desc
FROM golem_jobs GROUP BY source;
-- drushim:   52 total, 17 generic titles, 17 no desc
-- secretTLV: 35 total, 0 generic titles, 35 no desc
-- indeed:    41 total, 0 generic titles, 0 no desc
-- goozali:   28 total, 0 generic titles, 1 no desc
```

## References

- Issue: https://github.com/EtanHey/golems/issues/72
- File: `packages/jobs/src/scraper.ts` (~1162 lines)
- Package docs: `packages/jobs/CLAUDE.md`
