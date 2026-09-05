---
name: schedule
description: Use when planning the day, checking schedule, updating calendar events, or any scheduling task. Enforces time-awareness — always checks current time and existing calendar before changes.
execute: scripts/run.sh
---

# /schedule — Time-Aware Scheduling

**Pre-flight context was auto-loaded** — check the output above for current time, circadian phase, and today's events.

## Route to Workflow

**Planning your day or creating a full schedule?**
-> Follow `workflows/plan-day.md`

**Quick time/calendar check?**
-> Follow `workflows/check-context.md`

**Updating or modifying existing events?**
-> Follow `workflows/update-schedule.md`

## Quick Commands

```bash
bun scripts/cal.ts context            # Time + phase + today's events
bun scripts/cal.ts today              # Today's events only
bun scripts/cal.ts add "Title" 09:00 10:30 [colorId] [description]
bun scripts/cal.ts add-date YYYY-MM-DD "Title" HH:MM HH:MM [colorId] [desc]
bun scripts/cal.ts delete <eventId>
bun scripts/cal.ts clear-after HH:MM
```

## Color Reference

| Color | ID | Use |
|-------|-----|-----|
| Basil (green) | 10 | Routine — morning, night, sleep |
| Peacock (blue) | 7 | Deep work — job apps, coding, study |
| Grape (purple) | 3 | Events — meetings, workshops |
| Banana (yellow) | 5 | Breaks — meals, walks, fun |

## Rules (Non-Negotiable)

1. **ALWAYS check time context first** — never schedule without knowing the phase
2. **ALWAYS check existing calendar** — never create events blindly
3. **ZERO GAPS** — every hour from wake to sleep must be assigned
4. **Descriptions are instructions** — tell user WHAT to do, step by step
5. **Sleep is an event** — always book it
6. **Honor configured meal timing** — never infer fasting or meal preferences
7. **Protocol-driven timing** — caffeine delay, food cutoff, screen cutoff from protocol
