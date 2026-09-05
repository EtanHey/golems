---
name: match
description: Run the job matching algorithm on recent scrapes — score new listings against your profile.
---

# Job Matching

Score recent job listings against the seeker profile.

## Process

1. Load profile from `packages/jobs/src/profile.json`
2. Fetch unscored jobs from the latest scrape batch
3. For each job, use LLM to score 1-10 based on:
   - Skill match (languages, frameworks, tools)
   - Role level match (seniority, title)
   - Location/remote compatibility
   - Salary range overlap
   - Company culture signals
4. Store scores in database
5. Report: N jobs scored, distribution (how many 8+, 5-7, below 5)
6. Trigger notification for any 8+ matches
