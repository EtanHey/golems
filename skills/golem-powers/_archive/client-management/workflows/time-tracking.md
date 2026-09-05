# Time Tracking — Workflow

> Log start/stop times, distinguish human vs agent vs wall-clock. Feed totals into daily updates.

## When to Trigger

- Start of any ExampleClient work session
- End of any ExampleClient work session
- User says "track time", "log hours", "start example-client", "stop example-client"
- Proactively when projectAgent detects work beginning/ending
- When daily-update workflow requests hour totals

## Concepts

| Term | Meaning | Example |
|------|---------|---------|
| **Human time** | Operator actively working (coding, reviewing, testing) | 2 hours writing code |
| **Agent time** | Claude/agents working autonomously | 1 hour agent running PR loop |
| **Wall-clock time** | Total elapsed from start to stop | 4 hours (includes breaks) |
| **Billable time** | What goes on the invoice | Human + agent time (NOT wall-clock) |

**Rule:** Bill for value delivered, not wall-clock. If Operator takes a 30-min break, that's not billable. If Claude runs tests for 20 min while Operator does other work, the agent time IS billable (value was produced).

## Steps

### 1. Start Session

When ExampleClient work begins:

```
brain_store(
  content: "[2026-04-14 09:15] TASKOWL TIME: Session started. Sprint 3, task: [Linear ticket description].",
  tags: ["example-client", "time-log", "session-start", "agent:projectAgent"],
  importance: 4,
  project: "example-client"
)
```

### 2. Log Activity Blocks

During the session, log significant blocks:

```
brain_store(
  content: "[2026-04-14 09:15-10:45] TASKOWL TIME: 1.5h human — implemented protection screen UI. Task: MEH-23.",
  tags: ["example-client", "time-log", "human", "agent:projectAgent"],
  importance: 4,
  project: "example-client"
)
```

For agent work:
```
brain_store(
  content: "[2026-04-14 10:45-11:15] TASKOWL TIME: 0.5h agent — PR loop (branch, test, review, merge). Task: MEH-23.",
  tags: ["example-client", "time-log", "agent", "agent:projectAgent"],
  importance: 4,
  project: "example-client"
)
```

### 3. End Session

```
brain_store(
  content: "[2026-04-14 09:15-12:00] TASKOWL TIME: Session ended. Human: 2h, Agent: 0.5h, Billable: 2.5h, Wall-clock: 2.75h. Tasks: MEH-23 (done), MEH-24 (started).",
  tags: ["example-client", "time-log", "session-end", "agent:projectAgent"],
  importance: 5,
  project: "example-client"
)
```

### 4. Sprint Totals

When daily-update or user asks for totals:

```bash
# Query all time logs this sprint
brain_search("example-client time-log session-end", date_from="sprint-start")
```

Compile into:

```
Sprint 3 Time Summary:
  Human:    12.5h
  Agent:     3.0h
  Billable: 15.5h / 30h budget
  Remaining: 14.5h
  Burn rate: 3.1h/day (on track for 30h sprint)
```

## Budget Alerts

| Condition | Action |
|-----------|--------|
| Billable >= 50% of budget | Info: "Halfway through sprint budget" |
| Billable >= 80% of budget | Warning: "שים לב — נשארו [X] שעות בספרינט" in daily update |
| Billable >= 100% of budget | Alert: "Sprint budget exceeded. Overage rate: [RATE]. Need written approval." |
| Daily burn > budget/sprint-days | Warning: "Burning faster than planned — [X]h/day vs [Y]h/day target" |

## Granularity Rules

| Don't | Do |
|-------|-----|
| Log every 15-minute block | Log meaningful activity blocks (30min+) |
| Track bathroom breaks | Track work sessions start-to-stop |
| Guess times | Use actual timestamps |
| Mix projects | Each time entry is ExampleClient-specific |
| Log overhead (standup, planning) | Only log time producing deliverables |

## Invoice Integration

At sprint end, compile for invoice:

```
Sprint 3 Invoice Summary:
  Period: April 14-28, 2026
  Hours: 28.5h at [RATE] = [AMOUNT]
  Overage: 2h at [RATE] = [AMOUNT] (approved April 22)
  Total: [TOTAL + TAX]
  
  Breakdown:
  - MEH-23: Protection screen (8h)
  - MEH-24: Content blocking (12h)
  - MEH-25: Creator onboarding (6.5h)
  - Bug fixes: 4h
```

Evidence trail: git history + BrainLayer time logs.
