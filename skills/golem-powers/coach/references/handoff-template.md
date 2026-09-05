# Coach Handoff Template

> Canonical structure for handoff files written when Cardinal Rule 5 fires. Reference exemplar: `$COACH_ROOT/docs.local/handoffs/handoff-2026-04-26-coach-taskowl-interview-prep.md`.

Path convention: `$COACH_ROOT/docs.local/handoffs/handoff-{YYYY-MM-DD}-coach-{topic-slug}.md`

After writing the file, also store the handoff in BrainLayer with date-anchored tags so Cardinal Rule 0 can find it from a fresh session:

```text
brain_store(
  content: "SESSION HANDOFF {YYYY-MM-DD} (coach session): {one-paragraph summary of all active fires + decisions + next steps}. File: {handoff-file-path}.",
  tags: ["handoff", "session-end", "coach", "{YYYY-MM-DD}"],
  importance: 9
)
```

---

## Template (copy below this line into the new handoff file)

```markdown
# Session Handoff — {YYYY-MM-DD} (Coach)

## Outgoing Agent
- Agent: coachClaude (this session)
- Duration: ~{X} hours (started {start time}, continuous through {end time})
- Counter at handoff: {N}
- Topic span: {one-line: what this session covered}

---

## Session Intent (verbatim user quotes)

- **{date HH:MM TZ}:** *"{exact quote}"* — {one-line context}
- ... (one bullet per major intent shift, verbatim user quotes only)

---

## Decisions Made

| Decision | Why | Who |
|----------|-----|-----|
| **{decision}** | {why — the constraint, the data, the tradeoff} | {Etan / coach / sub-agent / external party} |

---

## User Corrections (already in BrainLayer)

| Correction | Category | Importance | Quote |
|-----------|----------|------------|-------|
| {what was wrong → what's right} | {identity / fabrication / scope / wording / calibration} | {1-9} | *"{exact user quote}"* |

**All stored in BrainLayer with tags `user-correction` + this session's date. Use `brain_search('user-correction {YYYY-MM-DD}')` to retrieve.**

---

## Current State

### 🔴 ACTIVE FIRE — {one-line description}

| Item | Status |
|---|---|
| {item} | {status — what's blocking, what we're waiting on, what's blocked} |

**THE NEW AGENT MUST NOT:**
- {hard prohibitions specific to this fire — e.g. "Reply to Alon until Dana's doc lands"}

### ✅ DONE TODAY — {category}

- {what shipped, with paths/IDs/links}

### 🟡 IN PROGRESS — {category}

- Last status: {where it stopped}
- Next checkpoint: {what to look for}

---

## Key Contacts (saved)

| Person | Role | Channel | JID/Email |
|---|---|---|---|
| **{name}** | {role} | {WA Business / Email / LinkedIn} | `{JID or email}` |

---

## Next Steps (ordered by priority)

1. **🔴 PRIORITY 1: {action}** — {how to do it, what data source}
2. **⏳ {action}** — {dependency / wait condition}
3. **🟡 {action}** — {context}
4. **📤 {action}** — {trigger condition}

---

## Anti-Patterns to Avoid (lessons from this session)

- ❌ **Don't {anti-pattern}** — {why it failed in this session}

---

## What the New Agent Should Do First

1. `brain_search("handoff {YYYY-MM-DD}")` — verify this handoff exists in BrainLayer
2. Read this file in full
3. {Concrete first check — Gmail filter, WA chat, etc.}
4. Resume from Next Steps #1
```
