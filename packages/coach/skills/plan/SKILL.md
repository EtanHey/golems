---
name: plan
description: Generate a daily or weekly plan by reading all golem statuses and Google Calendar. (Phase 6 — not yet implemented)
---

# Daily Plan

Generate a prioritized daily plan from golem states + calendar.

**Status**: Planned for Phase 6. Currently a stub.

## Planned Process

1. Read `getStatus()` from all active golems (email, teller)
2. Read Google Calendar events for today/this week
3. Merge into prioritized task list:
   - Email to review (from EmailGolem)
   - Financial alerts (from TellerGolem)
   - Calendar meetings and deadlines
4. Generate daily schedule with time blocks
5. Return the daily-plan summary
