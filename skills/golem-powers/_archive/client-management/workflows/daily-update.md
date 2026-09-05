# Daily Client Update — Workflow

> Draft a structured async standup for Alon. Takes 30 seconds to review and send.

## When to Trigger

- End of work session on TaskOwl
- User says "draft Alon update", "client update", "daily update"
- Coach/orchestrator requests end-of-day update
- Proactively after completing a sprint task

## Steps

### 1. Gather Data

Pull from these sources (parallel queries):

```
# What was done today
git log --since="00:00" --oneline  (in taskowl repo)

# Today's session-end totals (for "hours today" line)
# Filter on `session-end` specifically — the time-tracking workflow stores
# both activity-block entries AND session-end summaries. Summing both would
# double-count. Session-end entries are the single source of truth for totals.
brain_search("taskowl time-log session-end", date_from=today)

# Sprint-wide time logs (for "X מתוך Z בספרינט" budget math + 80% warning)
brain_search("taskowl time-log session-end", date_from="sprint-start")

# Today's decisions
brain_search("taskowl decision", date_from=today)

# ALL pending-to-communicate decisions (NOT filtered by date)
# Previous days' "CLIENT INFORMED: No" decisions MUST surface here —
# otherwise a missed day hides uncommunicated scope/hour changes.
brain_search("taskowl decision CLIENT INFORMED: No")

# Active Linear tickets
Check current sprint tickets in Linear
```

**Rule:** The uninformed-decisions query is intentionally unfiltered by date. If a day was missed, yesterday's uncommunicated decisions still need to hit the client in today's update. Once a decision is included in a sent update, mark it `CLIENT INFORMED: Yes` so the next run skips it.

**Rule:** The sprint-wide time log query is separate from today's query. Today's total → "שעות היום". Sprint-wide total → "מתוך Z בספרינט" and drives the 80%/100% budget warnings.

### 2. Draft the Update

Use this exact structure (Hebrew, casual):

```
עדכון מהיום:

עשיתי:
- [thing 1 in user-visible terms]
- [thing 2 in user-visible terms]

ממשיך עם:
- [next thing, reference Linear ticket if relevant]

[ONLY if relevant:]
חסימות:
- [what's blocking, what you need from them]

שעות: [X] שעות היום ([Y] מתוך [Z] בספרינט)
```

### 3. Apply Voice Rules

Before outputting, run through the parent SKILL.md Hebrew Voice Rules checklist:

- [ ] No name greeting
- [ ] No branch names or technical terms
- [ ] Status in first line
- [ ] Describe what they'll SEE, not technical labels
- [ ] Max 2 options if asking something
- [ ] Collaborative framing for bugs/issues
- [ ] Correct Hebrew word choices (see table in parent)
- [ ] Group chat = plural verbs

### 4. Output

Present the draft to Etan with:

```
## Draft Update for Alon

[the Hebrew draft]

---
**Hours today:** X hrs | **Sprint total:** Y/Z hrs
**Decisions logged:** N (see decision trail)
**Send via:** WhatsApp self-chat → copy to Alon
```

## Format Rules

| Rule | Detail |
|------|--------|
| Length | Bullets under `עשיתי:` and `ממשיך עם:` are capped at 3 items each. The full structured template (header + sections + hours line) naturally runs 6-10 lines — that's fine; the cap is on bullet counts, not total template height. |
| Bugs | Never list. Say "מצאתי כמה דברים, אתעד ונעבור ביחד" |
| Hours | Always include. This is the #1 thing that caused the escalation. |
| Blockers | Only include if you genuinely need something from the client |
| Next | Reference Linear tickets by description, not ID |
| Tone | "אז ככה," / "ממשיך עם" / casual, not formal |

## Examples

### Good: Simple Day

```
עדכון מהיום:

עשיתי:
- מסך ההגנה באייפון עובד, כולל אנימציה
- תיקנתי את המספור ימים שמראה 0 לרגעים ראשונים לאחר התחברות

ממשיך עם:
- דיאלוג ההרשאה באנדרואיד

שעות: 4 שעות היום (18 מתוך 30 בספרינט)
```

### Good: Day with Blocker

```
עדכון מהיום:

עשיתי:
- העלאה ל-TestFlight, תבדקו בזמנכם
- מצאתי כמה דברים, אתעד ונעבור ביחד

חסימות:
- צריך גישה ל-RevenueCat, המפתח של הפרויקט שם

שעות: 3 שעות היום (12 מתוך 30 בספרינט)
```

### Bad: Too Technical

```
עדכון מהיום:

עשיתי:
- Merged PR #47 (meh17/fix-bidi-counter)
- Fixed race condition in notification scheduler
- Componentized the onboarding flow into 3 modules

❌ Branch names, PR numbers, technical terms, too much detail
```

## Escalation Triggers

If any of these are true, add a prominent warning to the draft:

| Condition | Action |
|-----------|--------|
| Hours > 80% of sprint budget | Add: "שים לב — נשארו [X] שעות בספרינט" |
| Scope change not communicated | Add the decision to the update |
| No update sent in 2+ days | Flag to Etan: "Last update was [N] days ago" |
| Blocker unresolved 2+ days | Escalate blocker visibility |
