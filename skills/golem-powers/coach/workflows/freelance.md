# Freelance Workflow

## Before Anything Else (MANDATORY — run ALL of these)

```
brain_search("user-state-current", tag="user-state-current")  # Cross-golem: what is user doing now?
brain_search("coach freelance client <name>")
brain_search("coach contract pricing")
brain_search("coach invoice recent")
```

Look for: client history, past pricing decisions, contract terms, payment status.

---

## Contract Review

When reviewing a freelance contract:

1. **brain_search** for past contracts with this client (terms, rates, issues)
2. Read the contract carefully — look for:
   - Payment terms (Net 30? Net 60? Milestone-based?)
   - IP ownership clauses
   - Non-compete / exclusivity
   - Cancellation terms
   - Scope creep protection (change request process)
3. **Hebrew contracts** — respond in Hebrew. Use professional but clear language.
4. Flag any clause that deviates from standard practice in the user's jurisdiction

### Contract Feedback Format (Hebrew)

When generating feedback on a contract, structure as:

```
## סקירת חוזה — [שם לקוח]

### סיכום
[1-2 sentences on overall assessment]

### נקודות לתשומת לב
- [Issue 1 — what it says, why it matters, suggested change]
- [Issue 2 — ...]

### המלצות
- [Specific actionable recommendations]

### הערות נוספות
[Anything else worth noting]
```

---

## Invoicing

When creating or discussing invoices:

1. **brain_search** for past invoices to this client (amounts, frequency)
2. Local invoicing requirements (check the user's registration and jurisdiction first):
   - `brain_search("osek patur registration")` — determine if user is Patur or Murshe
   - **Osek Patur:** Issues kabala (receipt), NO VAT charged, no heshbonit mas
   - **Osek Murshe:** Issues heshbonit mas (tax invoice), includes VAT
   - Both must include: business number (mispar osek), date, invoice number, buyer details, description, amount, total
   - Applicable tax rate: `brain_search("freelance tax rate current <jurisdiction>")` — rates change, don't hardcode
   - **The user is currently Osek Patur** — verify this hasn't changed before invoicing

---

## Pricing

When discussing pricing for a project:

1. **brain_search** for past pricing decisions and market rates
2. Consider: scope, timeline, client relationship, market rate
3. Local freelance market context — search memory for stored rate benchmarks
4. Always present as a range, not a single number
5. Factor in: preparation time, revisions, communication overhead

---

## Client Management

Every client interaction should be stored:

```
brain_store(
  content: "Coach client: <name> — <what happened>. Status: <active/completed/pending>. Next: <action>",
  tags: ["coach", "client", "<client-name>"],
  importance: 7
)
```

Before any client interaction: `brain_search("coach client <name>")` to recall full history.

Read the configured jurisdiction reference for current tax and legal details relevant to freelance work.
