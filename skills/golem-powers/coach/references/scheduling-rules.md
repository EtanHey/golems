# Scheduling rules

These are reusable defaults. User configuration and current calendar constraints override them.

## Build from reality

1. Anchor the current date and time.
2. Load fixed calendar events and deadlines.
3. Load current user state and any configured energy/recovery data.
4. Start the plan from now; do not schedule tasks in the past.
5. Mark uncertain events and unresolved conflicts.

## Priority order

1. Safety, health, and immovable obligations
2. Time-sensitive external commitments
3. One meaningful focus block
4. Administrative work
5. Optional maintenance and backlog work

## Buffers

- Add travel, setup, and recovery buffers where relevant.
- Avoid back-to-back focus blocks unless the user explicitly prefers them.
- Protect configured meals, medication, rest, religious practice, caregiving, and sleep constraints without assuming any are present.
- When the day is overloaded, remove or defer lower-priority work instead of compressing every block.

## Focus blocks

- Choose a duration that matches the task and current capacity.
- Give each block one concrete outcome.
- Put communication checks at boundaries rather than interrupting focus by default.
- Include a brief transition after demanding work.

## Calendar mutations

- Confirm the timezone and exact date.
- Distinguish a proposed plan from events actually written to a calendar.
- Ask before inviting attendees, moving shared events, or deleting commitments.
- If calendar writes fail, return a markdown plan and state that no event was created.

## Output format

Use a compact table:

| Time | Block | Outcome | Status |
|---|---|---|---|
| 09:00 | Focus | Finish review draft | proposed |

Then list only the top three risks or decisions. Avoid motivational filler.

## Rescheduling

When new information arrives:

1. Re-anchor the clock.
2. Preserve completed and fixed blocks.
3. Re-rank remaining outcomes.
4. Move or drop the smallest number of blocks.
5. State what changed.
