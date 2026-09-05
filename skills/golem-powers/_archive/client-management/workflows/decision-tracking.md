# Decision Tracking — Workflow

> Store WHO/WHAT/WHY/WHEN on every scope or hour change IMMEDIATELY. Don't wait for end of day.

## When to Trigger

- Scope changes (feature added/removed/modified from original ticket)
- Hours exceed original estimate
- Feature pivot or technical approach change
- Client requests something not in the sprint plan
- User says "log decision", "scope change", "hours exceeded"
- Proactively when projectAgent detects scope drift

## Steps

### 1. Capture the Decision

Immediately when the event happens, gather:

| Field | What | Example |
|-------|------|---------|
| **WHEN** | ISO date + time | 2026-04-14 14:30 |
| **WHO** | Who made or requested it | "Client Contact asked" / "Operator decided" / "projectAgent chose" |
| **WHAT** | What changed | "Added creator onboarding flow — not in Sprint 3 scope" |
| **WHY** | Reason | "Client Contact said creators need onboarding before content blocking" |
| **IMPACT** | Hours/scope effect | "+6 hours estimated, pushes sprint to 36/30 hours" |
| **CLIENT INFORMED** | Yes or No | "No — needs to be in today's update" |

### 2. Store in BrainLayer

```
brain_store(
  content: "[2026-04-14 14:30] DECISION: Added creator onboarding flow (not in Sprint 3 scope). WHO: Client Contact requested. WHY: Creators need onboarding before content blocking. IMPACT: +6 hours (sprint now 36/30). CLIENT INFORMED: No — include in today's update.",
  tags: ["example-client", "decision", "scope-change", "agent:projectAgent", "source:session-2026-04-14"],
  importance: 8,
  project: "example-client"
)
```

### 3. Check Budget Impact

After storing, run the budget check:

```
Current sprint hours: [used] / [budget]
This decision adds: [estimated hours]
New total: [new total] / [budget]

If new total > budget:
  → Flag as OVERAGE
  → Remind: overage rate is [RATE] (vs 140 base)
  → Written approval needed before proceeding
```

### 4. Feed to Daily Update

Mark `CLIENT INFORMED: No` decisions as requiring inclusion in the next daily update. The daily-update workflow pulls these automatically. Only two states are allowed — `Yes` or `No`. Do NOT introduce a third state like `Pending`; that splits the inclusion rule and causes decisions to be missed.

After a decision is mentioned in a sent update, update the stored entry with `brain_update` (or store a follow-up chunk) flipping it to `CLIENT INFORMED: Yes`.

## Decision Categories

| Category | Tag | Examples |
|----------|-----|----------|
| Scope addition | `scope-add` | New feature, new screen, new API |
| Scope removal | `scope-remove` | Feature cut, deferred to next sprint |
| Scope modification | `scope-modify` | Feature changed from spec |
| Technical approach | `tech-decision` | Chose X over Y for implementation |
| Hour overrun | `hour-overrun` | Task took longer than estimated |
| Client request | `client-request` | Client Contact/Partner Contact asked for something |
| Bug discovery | `bug-found` | Found pre-existing bug during work |

## Importance Scale

| Scenario | Importance |
|----------|-----------|
| Scope add/remove (affects deliverables) | 9 |
| Hour overrun (budget impact) | 8 |
| Technical approach (no budget impact) | 6 |
| Bug discovery (informational) | 5 |

## Anti-Patterns

| Don't | Do |
|-------|-----|
| Wait until end of day to log | Log IMMEDIATELY when it happens |
| Log without WHO | Always attribute the decision |
| Log without IMPACT | Always estimate hour/scope effect |
| Skip CLIENT INFORMED field | This is the whole point — prevent surprises |
| Log routine implementation choices | Only log things that affect scope/hours/deliverables |

## Querying Decisions

```bash
# All decisions this sprint (any category: scope-add, scope-remove,
# scope-modify, tech-decision, hour-overrun, client-request, bug-found)
brain_search("example-client decision", date_from="sprint-start")

# Only scope changes this sprint
brain_search("example-client decision scope", date_from="sprint-start")

# Decisions client wasn't informed about (unfiltered by date —
# yesterday's uncommunicated decisions must still surface)
brain_search("example-client decision CLIENT INFORMED: No")

# Hour overruns
brain_search("example-client decision hour-overrun")
```

## Example: Full Decision Trail for a Sprint

```text
[2026-04-14 09:00] DECISION: Started Sprint 3. Budget: 30 hours at [RATE].
[2026-04-14 14:30] DECISION: Added creator onboarding (Client Contact request). +6h. INFORMED: No.
[2026-04-15 11:00] DECISION: Content blocking needs native module (tech). +4h. INFORMED: Yes.
[2026-04-16 09:00] DECISION: Cut analytics dashboard (Operator). -8h. INFORMED: No.
[2026-04-17 16:00] DECISION: Hour overrun — 32/30 hours used. INFORMED: Yes, approved.
```
