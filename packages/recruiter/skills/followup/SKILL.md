---
name: followup
description: Check overdue follow-ups in the outreach pipeline and suggest next actions.
---

# Follow-up Tracker

Check for overdue outreach follow-ups.

## Due Date Rules

| Category | Follow-up Window |
|----------|-----------------|
| interview | 3 days |
| job | 5 days |
| urgent | 1 day |
| other | 7 days |

## Process

1. Query all outreach messages past their follow-up due date
2. For each overdue item, show:
   - Contact name and company
   - Days overdue
   - Original message snippet
   - Last interaction date
3. Suggest actions: re-send, try different channel, mark as cold
4. If no overdue items: report "All follow-ups are current"
