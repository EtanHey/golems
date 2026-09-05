---
name: plan
description: Generate a daily or weekly plan by reading all golem statuses and Google Calendar. (Phase 6 — not yet implemented)
---

# Daily Plan

Generate a prioritized daily plan from golem states + calendar.

**Status**: Planned for Phase 6. Currently a stub.

## Planned Process

1. Read `getStatus()` from all active golems (jobs, recruiter, teller, content)
2. Read Google Calendar events for today/this week
3. Merge into prioritized task list:
   - Interviews to prep for (from RecruiterGolem)
   - Drafts to approve (from ContentGolem)
   - High-score job matches to review (from JobGolem)
   - Financial alerts (from TellerGolem)
   - Calendar meetings and deadlines
4. Generate daily schedule with time blocks
5. Send to Telegram as morning nudge
