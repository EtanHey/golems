---
name: example-client
description: "ExampleClient freelance client management — daily updates, decision tracking, time logging. Use when drafting Client Contact updates, logging scope changes, tracking hours, or any ExampleClient client communication. Triggers: 'draft Client Contact update', 'client update', 'daily update', 'log decision', 'track time', 'example-client'."
---

# ExampleClient Client Management

> Three interconnected workflows for managing the ExampleClient freelance engagement with Client Contact.

## Why This Exists

April 13, 2026: Client Contact escalated — checkpoints not delivered, hours burned without warning, code pushed without discussion. Nearly ended the relationship. Root cause: no daily updates, no proactive hour tracking, no decision trail. These workflows prevent that from happening again.

## Client Profile

| Field | Value |
|-------|-------|
| Client | Client Contact, partner Partner Contact |
| App | ExampleClient — anti-porn addiction, 8K+ downloads |
| Language | Hebrew, casual, non-technical |
| Rate | [RATE] (30hr blocks), overage [RATE] |
| Tools | Linear (tickets), TestFlight/EAS (builds), WhatsApp (comms) |
| Priority | SPEED above everything |

## Workflows

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| [daily-update](workflows/daily-update.md) | "draft Client Contact update", "client update", end of work day | Draft structured async standup in Hebrew |
| [decision-tracking](workflows/decision-tracking.md) | Scope change, hour overrun, feature pivot, "log decision" | Store WHO/WHAT/WHY/WHEN immediately |
| [time-tracking](workflows/time-tracking.md) | Start/stop work, "track time", "log hours" | Log human vs agent vs wall-clock time |

## How They Connect

```
Time Tracking ──feeds──> Daily Update (hours worked today)
Decision Tracking ──feeds──> Daily Update (scope changes to mention)
Daily Update ──references──> both (pulls data for standup)
```

## Hebrew Voice Rules (from 6 rounds of corrections)

These rules apply to ALL client-facing Hebrew output:

### NEVER
- Start with name greeting on WhatsApp ("אלון," — just start with content)
- Include branch names, PR numbers, or git terminology
- Ask "should I...?" questions — state what you need
- List bugs in the message — defer: "מצאתי כמה באגים, אתעד ונעבור ביחד"
- Use technical jargon — "componentization" = "סידור וצמצום הקוד"
- Offer options that make the client work
- Use "מונה" when "מספור" is more natural
- Label bugs with technical terms — describe what the user will SEE

### ALWAYS
- Status in first line (what's done)
- Collaborative framing: "ונעבור על זה ביחד"
- Max 2 options, never 3
- Casual tone: "אז ככה," to start explanations
- Explain WHY you waited: "חיכיתי תביקורת מכם"
- Reference their tools: "הטיקטים בלינאר" not "features"
- "ראיתי ש..." to show proactive tracking
- Specific ask > open question
- Group chat = plural verbs ("תבדוקו" not "תבדוק")
- For issues: [what client will see] + [what we'll do about it]
- "מעולה." alone is enough acknowledgment
- Comma not dash: "עוד דבר שמצאתי, המפתח..." not "עוד דבר שמצאתי - מפתח..."

### Word Choices
| Wrong | Right | Why |
|-------|-------|-----|
| חילצתי | הוצאתי | More natural |
| מונה | מספור | More natural for counter |
| שמהבהב | שמראה | Describe what it DOES not how it LOOKS |
| לשנייה | לרגעים ראשונים | Less precise, more natural |
| בכניסה | לאחר התחברות | More formal/correct for "after login" |
| מסיים עד סוף השבוע | ממשיך היום | Signal active work NOW |

## Data Sources

- Voice corrections: BrainLayer `brain_search("user-correction hebrew voice-calibration alon")`
- Entity: `brain_entity("Client Contact")`
- Files: Obsidian `Clients/ExampleClient/`
- Contract: Obsidian `Clients/ExampleClient/sprint2-approval.md`

## Critical Rule

**Updates go to Operator's self-chat first, NEVER directly to the client.** The draft is for Operator to review, edit, and send himself.
