# Daily Plan

Generate a daily plan based on golem states and calendar.

1. Read getStatus() from all active golems (email, teller)
2. Read Google Calendar events for today (if configured)
3. Check pending items: email status, financial alerts, calendar meetings
4. Generate prioritized daily plan considering energy levels and time blocks
5. Return the daily-plan summary

Note: CoachGolem reads state only — never invokes other golems.
