# Recruiting & Job Hunt Workflow

## Before Anything Else (MANDATORY — run ALL of these)

```
brain_search("user-state-current", tag="user-state-current")  # Cross-golem: what is user doing now?
brain_search("coach job search status")
brain_search("coach interview <company>")
brain_search("coach outreach recent")
```

Look for: active job applications, interview prep notes, outreach history, networking contacts.

---

## Job Search Tracking

Every job-related event gets stored:

```
brain_store(
  content: "Coach job: <company> — <role>. Status: <applied/interview/offer/rejected>. Notes: <details>",
  tags: ["coach", "job", "<company-name>"],
  importance: 7
)
```

Before discussing any company: `brain_search("coach job <company>")` to recall full history.

---

## Outreach Emails

When drafting outreach emails:

1. **brain_search** for past outreach to this person/company
2. **brain_search** for the user's outreach style preferences
3. Check Obsidian for any notes about this contact
4. Draft should be:
   - Personal (reference a shared connection, their work, or a specific reason for reaching out)
   - Brief (3-5 sentences max for cold outreach)
   - Clear ask (what you want: coffee chat, referral, intro)
   - Professional but warm tone

### Outreach Template

```
Subject: [Specific, not generic]

Hi [Name],

[1 sentence — how you found them / connection point]

[1-2 sentences — why you're reaching out, what caught your attention]

[1 sentence — clear, low-pressure ask]

Best,
Etan
```

After sending, store:
```
brain_store(
  content: "Coach outreach: Sent email to <name> at <company> re: <topic>. Channel: <email/LinkedIn>. Status: sent, awaiting response.",
  tags: ["coach", "outreach", "<person-name>"],
  importance: 6
)
```

---

## Interview Prep

When preparing for an interview:

1. **brain_search** for everything about this company and role
2. **brain_search** for past interview experiences and learnings
3. Research the company (use web search if needed)
4. Structure prep:
   - Company background & recent news
   - Role requirements vs. user's experience (gaps and strengths)
   - Likely questions + prepared answers
   - Questions to ask them
   - Logistics (time, platform, interviewer name)

After each interview, prompt the user to debrief and store:
```
brain_store(
  content: "Coach interview debrief: <company> <role>. How it went: <assessment>. Questions asked: <key questions>. Learnings: <what to do differently>. Next steps: <action>",
  tags: ["coach", "interview", "<company-name>"],
  importance: 8
)
```

---

## Networking & Contact Management

Every meaningful contact gets stored:

```
brain_store(
  content: "Coach contact: <name> — <role> at <company>. Met via: <context>. Relationship: <warm/cold/referral>. Notes: <relevant details>",
  tags: ["coach", "contact", "<person-name>"],
  importance: 6
)
```

Before reaching out to anyone: `brain_search("coach contact <name>")` — you may have context from a previous session.
