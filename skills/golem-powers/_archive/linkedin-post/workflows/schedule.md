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

## Huberman Learning Protocols

Each practice session follows neuroscience-backed learning principles (Andrew Huberman):

### Session Structure

1. **90-min ultradian cycles** — the brain's natural focus bout. One full writing session = one cycle max.
2. **Gap effects during practice** — pause 5-30 seconds between exercises (e.g., between writing each hook). During pauses, the hippocampus replays what you just did 20-30x faster, accelerating pattern formation.
3. **Self-test immediately** — after writing a draft, score it yourself against the 11 rules BEFORE running `/linkedin-post review`. Self-testing within minutes of learning doubles retention vs. just re-reading.
4. **NSDR after sessions** — 10-20 min Non-Sleep Deep Rest (eyes closed, body scan, or Yoga Nidra) after each writing session. Accelerates consolidation by 50%.
5. **Consistent daily time** — practice at the same time each day. The brain anticipates and primes for the activity.
6. **Sleep consolidates** — 80% of skill consolidation happens during the first night's sleep after practice. Don't skip sleep after a writing session.

### How to Apply to Weekly Schedule

| Day | Huberman Protocol Applied |
|-----|--------------------------|
| Mon (hooks) | Write 5 hooks with 10-30s pause between each. Self-score before checking rules. 10 min NSDR after. |
| Tue (meat) | Single 90-min focus bout. No phone. Gap pauses between sections. NSDR after. |
| Wed (CTA) | Short session — still pause between each CTA attempt. |
| Thu (full draft) | Self-review first (score yourself), THEN run `/linkedin-post review`. Compare your score vs AI score. |
| Fri (publish) | Golden Hour engagement is its own learning loop — observe what gets reactions. |

### RecruiterGolem Integration

When generating the weekly calendar, RecruiterGolem should:
- Schedule writing sessions during Flow Block slots (from Obsidian daily schedule)
- Add "10 min NSDR" reminders after each writing session
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
2. **Obsidian daily schedule awareness** — read `daily-schedule-draft.md` to fit writing into Flow Blocks
3. **Bedtime planning routine** — Claude sends tomorrow's plan via Telegram before the "STOP CODING" alarm, so automations can prepare overnight and you wake up knowing exactly what to do
4. **Dynamic rescheduling** — if a meeting gets added, shift the writing session automatically
5. **Progress dashboard** — weekly engagement trends, self-score improvement curve

These require: Google Calendar API access, Obsidian vault read, Telegram scheduling, and coordination with RecruiterGolem's existing briefing system.
