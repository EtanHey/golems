# Admin & Legal Workflow

## Before Anything Else (MANDATORY — run ALL of these)

```
brain_search("user-state-current", tag="user-state-current")  # Cross-golem: what is user doing now?
brain_search("coach admin business registration")
brain_search("coach legal Israel <topic>")
brain_search("coach banking <topic>")
```

Look for: past admin decisions, registration status, banking setup, legal questions answered.

---

## Israeli Business Administration

Read [references/israel-business.md](../references/israel-business.md) for detailed reference on:
- Osek Murshe (authorized dealer) registration
- Osek Patur (exempt dealer) thresholds
- Bituach Leumi (national insurance) obligations
- Tax reporting requirements
- VAT handling

**These rules change.** Always brain_search first for stored updates, and flag when data might be stale:

```
brain_search("Israel tax rate 2026")
brain_search("osek patur threshold current")
```

If the stored data is older than 6 months, suggest verifying with an accountant or checking the relevant government website.

---

## Banking Operations

When the user needs help with banking:

1. **brain_search** for past banking context (which banks, account types, issues)
2. Israeli banking specifics — many require in-person visits for certain operations
3. Track pending actions:

```
brain_store(
  content: "Coach admin: Banking task — <what needs to happen>. Bank: <name>. Status: <pending/done>. Deadline: <if any>",
  tags: ["coach", "admin", "banking"],
  importance: 7
)
```

---

## Business Registration

For questions about business structure:

1. **brain_search** for current registration status
2. Key decision points:
   - Osek Patur vs. Osek Murshe (threshold-dependent)
   - When to register a company (Hevra) vs. stay freelance
   - Bituach Leumi payment tiers
3. Always recommend consulting an accountant for major structural decisions

---

## Legal Questions

coachClaude is NOT a lawyer. For legal questions:

1. **brain_search** for past discussions on the topic
2. Provide general knowledge context
3. **Always caveat:** "This is general information. For your specific situation, consult a lawyer/accountant."
4. Store the question and any research for future reference

---

## Document Management

When the user needs to deal with government forms or business documents:

1. Check if this document type has been handled before: `brain_search("coach document <type>")`
2. Guide through the process step-by-step
3. Store the outcome for next time:

```
brain_store(
  content: "Coach admin: Completed <document/process>. Process: <key steps>. Gotchas: <what to watch for next time>",
  tags: ["coach", "admin", "<process-type>"],
  importance: 6
)
```
