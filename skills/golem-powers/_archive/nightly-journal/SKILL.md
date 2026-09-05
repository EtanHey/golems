---
name: nightly-journal
description: "Use when ending the day, checking what happened professionally, or capturing client and job pipeline activity. Triggers on: 'nightly journal', 'daily sweep', 'check my comms', 'what happened today', 'update my diary', end-of-day routines, or proactively during evening coach tasks."
---

# Nightly Professional Journal

Autonomous sweep of WhatsApp (Business + Personal), Gmail, and BrainLayer for professional activity. Writes a structured daily log to Obsidian.

## Scope

**Include:** Client chats, job pipeline (recruiters, interviews, applications), professional-community activity, and outreach responses.

**Exclude:** Personal chats, group spam, newsletters, GitHub notifications, marketing, status broadcasts.

## Sources

1. **WhatsApp Business** — client JIDs from BrainLayer (`brain_search("whatsapp jids known contacts")`). Query each with `mcp__whatsapp__list_messages(chat_jid=JID, limit=30)`. Also scan `mcp__whatsapp__list_chats(limit=20, sort_by="last_active")` for new contacts.
2. **WhatsApp Personal** — project JIDs from BrainLayer. Same query pattern via `mcp__whatsapp__list_messages`.
3. **Gmail** — `gmail_search_messages(q="after:<today> -category:promotions -category:social")`. Keep only recruiter/client/interview emails.
4. **BrainLayer** — `brain_search("owner-state career", date_from=today)` for pipeline context.

## Output

Write to: `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/personal/Personal/<YYYY-MM-DD> Daily Log.md`

If file exists, append `## Evening Sweep` — don't overwrite.

Sections: Clients, Job Pipeline (active conversations + applications + interviews), Networking, Email Highlights, Tomorrow (what needs attention first). Skip empty sections.

Summarize Hebrew content in English (RTL breaks some editors). End with `brain_store` tagged `["daily-journal", "agent:coachClaude"]`.

## Data Integrity

- **WhatsApp MCP returns empty for valid JIDs** — known issue. Log "MCP sync issue, check phone" rather than "no activity."
- **Parallel queries** — run all WhatsApp + Gmail queries in parallel (independent data sources).
- **Cross-validate** — if BrainLayer has an owner-state connection entry but WhatsApp shows no messages, note the gap. The absence of data is data.
- **Never fabricate** — if a source didn't return data, say so. Don't infer activity from BrainLayer alone.

## Urgency Detection

If an unanswered client ask is found (message from a client with no reply from the operator), flag it in the journal output and mention it prominently at the top.

This skill is read-only — it reads sources and writes to Obsidian journal only. It never sends WhatsApp messages, emails, or takes external actions.
