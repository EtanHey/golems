# Weekly Content Schedule

RecruiterGolem integration: automatically suggests a weekly writing practice schedule based on your recent git activity.

## How It Works

Once a week (Sunday morning, with the morning briefing), RecruiterGolem:

1. **Scans last week's work** — git log across repos, PRs merged, features built
2. **Identifies post-worthy topics** — using `/linkedin-post topic` logic
3. **Creates a practice calendar** for the week:
   - Which days to write (Mon-Fri, 5 posts/week target)
   - Topic suggestions for each day
   - Which module to practice (rotating through learn.md modules)
   - Reminder to engage during Golden Hour

## Weekly Calendar Template

RecruiterGolem generates something like:

```
## Week of [date] — LinkedIn Content Plan

### Topics from your work:
1. "Greenhouse/Lever ATS scraping — 238 jobs, zero API keys" (from PR #79)
2. "Building a feedback loop for AI job matching" (from Phase 5 work)
3. "Zikaron: giving your AI assistant a memory" (ongoing project)

### Schedule:

| Day | Type | Topic | Practice Module |
|-----|------|-------|----------------|
| Mon | Hook practice | Write 5 hooks for topic #1 | Module 1 |
| Tue | Full draft | Draft topic #1 | Module 2 |
| Wed | Deconstruct | Analyze 1 top performer post | Module 5 |
| Thu | Full draft | Draft topic #2 | Module 2+3 |
| Fri | Publish + engage | Publish best draft, 90-min engagement | Module 4 |

### Engagement reminders:
- After publishing: comment on 5 posts in your feed (gives algorithm signal you're active)
- Reply to ALL comments within 90 min
- Save posts you admire (builds your taste)
```

## Integration with RecruiterGolem

### How to wire this into the weekly briefing:

In `packages/services/src/briefing.ts`, add a content planning section:

```typescript
// After job market summary, add content planning
const contentPlan = await generateWeeklyContentPlan();
briefing += `\n## Content Calendar\n${contentPlan}`;
```

The `generateWeeklyContentPlan()` function:
1. Reads git log (last 7 days) across configured repos
2. Uses the topic identification patterns from `topic.md`
3. Rotates through learning modules (Module 1 this week, Module 2 next week, etc.)
4. Formats as the calendar template above

### Telegram notification:

Every Sunday at 9am (after morning briefing):
```
Content Plan for this week:
- Mon: Hook practice (topic: ATS scraping)
- Tue: Draft (ATS scraping post)
- Thu: Draft (AI job matching)
- Fri: Publish best one

Topic suggestions based on PRs #78, #79
```

## Manual trigger

```bash
# Generate this week's content plan now
/linkedin-post schedule
```

## Deliberate-Practice Schedule

Each practice session uses a small set of configurable learning habits:

### Session Structure

1. Use a time box that fits the user's calendar.
2. Pause briefly between exercises.
3. Self-score a draft before running `/linkedin-post review`.
4. Add a configured break after the session.
5. Prefer a consistent practice slot when requested.
6. Respect the user's configured rest constraints.

### How to Apply to Weekly Schedule

| Day | Huberman Protocol Applied |
|-----|--------------------------|
| Mon (hooks) | Write 5 hooks with a brief pause between each. Self-score before checking rules. |
| Tue (meat) | Use one configured focus block and pause between sections. |
| Wed (CTA) | Short session — still pause between each CTA attempt. |
| Thu (full draft) | Self-review first (score yourself), THEN run `/linkedin-post review`. Compare your score vs AI score. |
| Fri (publish) | Golden Hour engagement is its own learning loop — observe what gets reactions. |

### RecruiterGolem Integration

When generating the weekly calendar, RecruiterGolem should:
- Schedule writing sessions during configured focus blocks
- Add the user's configured recovery break after each writing session
- Rotate practice modules across weeks (not same module every week)
- Track self-score vs AI-score gap as a progress metric

## Tracking

Each week, compare:
- Target: 5 writing sessions/week, 1 published post
- Actual: how many sessions done, posts published
- Engagement: impressions, comments, saves trend
- Self-score accuracy: how close your self-review was to `/linkedin-post review`

After 4 weeks, review and adjust the plan based on what resonated.

---

## Future: Smart Scheduling (Needs Own Plan)

The following features need a dedicated planning phase:

1. **Calendar integration** — check Google Calendar for conflicts before scheduling writing sessions
2. **Daily schedule awareness** — read the configured schedule source to fit writing into focus blocks
3. **Planning routine** — send tomorrow's plan through the configured notification channel
4. **Dynamic rescheduling** — if a meeting gets added, shift the writing session automatically
5. **Progress dashboard** — weekly engagement trends, self-score improvement curve

These require configured calendar, notes, and notification integrations plus coordination with RecruiterGolem's existing briefing system.
