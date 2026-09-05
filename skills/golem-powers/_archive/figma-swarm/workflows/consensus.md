# Consensus Protocol — Shared Component Resolution

> When multiple screen agents need the same component, this protocol prevents duplicates and ensures consistency.

## The 2-Straight-Consensus-Loops Rule

A shared component's spec is only locked when **all interested agents agree twice in a row** with no changes requested between rounds.

```
Round 1: Agent-A proposes spec → Agent-B agrees → Agent-C agrees    ✓ (1/2)
Round 2: No one requests changes → all confirm again                ✓ (2/2) → LOCKED
```

If anyone requests a change at any point, the counter resets:
```
Round 1: Agent-A proposes spec → Agent-B agrees → Agent-C agrees    ✓ (1/2)
Round 2: Agent-B says "actually I need a purple variant too"         ✗ RESET
Round 1: Agent-A updates spec with purple variant → Agent-B agrees   ✓ (1/2)
Round 2: Agent-C agrees → all confirm                               ✓ (2/2) → LOCKED
```

## Why 2 loops?

Screen agents see components in different contexts. The first agreement might miss how a component looks on another screen. The second round forces everyone to re-examine after seeing the agreed spec — catching issues like "this works on my screen but would clip on yours."

## Flow

### 1. Claim

When you need a component and it's UNCLAIMED in `component-needed.md`:

```markdown
| StatusBadge | agent-a, agent-c | agent-a | CLAIMED | 540:9301 | 24x24, 3 states | — |
```

Write a `claim` message to mailbox:
```json
{"id":"msg-010","ts":"...","from":"agent-a","to":"all","type":"claim","body":"Claiming StatusBadge. Spec: 24x24 circle, green/yellow/red fills, 2px border.","read_by":[]}
```

### 2. Wait & Check (90 seconds)

Wait ~90 seconds. Re-read `component-needed.md`.

- **No conflict?** → You own it. But if others need it, wait for consensus before building.
- **Conflict?** (Another agent also claimed it) → Negotiate via mailbox. The agent whose screen has the more complex usage typically takes ownership.

### 3. Consensus Rounds

For components needed by 2+ agents:

**Proposer** (the claiming agent) posts the full spec to mailbox:
```json
{"id":"msg-011","ts":"...","from":"agent-a","to":"all","type":"claim","body":"StatusBadge proposal:\n- Size: 24x24\n- Shape: circle\n- Colors: green=#22C55E, yellow=#EAB308, red=#EF4444\n- Border: 2px white\n- Props: status: 'active'|'pending'|'inactive'","read_by":[]}
```

**Other agents** read the spec and respond with `consensus` or `conflict`:

```json
{"id":"msg-012","ts":"...","from":"agent-c","to":"agent-a","type":"consensus","body":"StatusBadge spec works for my screen. Round 1 agree.","read_by":[]}
```

or:

```json
{"id":"msg-012","ts":"...","from":"agent-c","to":"agent-a","type":"conflict","body":"StatusBadge needs a 4th state 'expired' (grey) on my screen. Also needs 16x16 small variant.","read_by":[]}
```

### 4. Variant Consolidation Check

Before building separate components, agents should check if two "different" components are actually **the same component with variants**:

**Consolidate when:**
- Same visual structure, different colors → add `colorScheme` prop
- Same component, different sizes → add `size` prop
- Same content area, different wrappers → the wrapper is a separate shared component (like BottomDrawer)

**Keep separate when:**
- Fundamentally different layout or interaction pattern
- Sharing would require so many props it becomes confusing

**When unsure:** Flag to orchestrator via mailbox with type `review`. The orchestrator (or user) decides.

### 5. Update Registry

After 2 consecutive consensus rounds:
```markdown
| StatusBadge | agent-a, agent-c | agent-a | CONSENSUS | 540:9301 | 24x24, 4 states, 2 sizes | — |
```

The claiming agent can now build. Update status to BUILDING, then DONE when built + figma-loop verified.
