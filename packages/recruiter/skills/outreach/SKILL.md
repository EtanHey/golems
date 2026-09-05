---
name: outreach
description: Manage the job outreach pipeline — list, draft, track, and review outreach messages.
---

# Outreach Pipeline

Manage outreach messages to hiring contacts.

**Arguments**: $ARGUMENTS — action (list | draft | stats)

## Actions

### list (default)
Show pending outreach messages with status:
- **draft** — not yet sent
- **sent** — delivered, awaiting response
- **replied** — contact responded
- **no-response** — past follow-up window

### draft
Generate a new outreach message for a company/contact:
1. Research company context (`@golems/recruiter/company-research`)
2. Adapt style to recipient profile (`@golems/recruiter/style-adapter`)
3. Draft personalized message
4. Present for review and editing

### stats
Show outreach funnel metrics:
- Total contacts found
- Messages sent
- Reply rate
- Interviews scheduled
- Time-to-response averages
