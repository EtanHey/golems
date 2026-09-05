# Daily Plan

Generate a daily plan based on golem states and calendar.

1. Read getStatus() from all active golems (jobs, recruiter, teller, content)
2. Read Google Calendar events for today (if configured)
3. Check pending items: drafts to approve, follow-ups due, interviews scheduled
4. Generate prioritized daily plan considering energy levels and time blocks
5. Send summary to Telegram as morning nudge

Note: CoachGolem reads state only — never invokes other golems.
