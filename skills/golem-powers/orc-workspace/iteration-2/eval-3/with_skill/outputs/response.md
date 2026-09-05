# Eval 3 Response — Frozen Agent + Gems

**Prompt:** "The architect agent I spawned on surface:42 seems frozen. It's been showing 'Channelling...' for 15 minutes with no token count change. Meanwhile I just found this great article about agent design patterns — here's the link. What should we do?"

---

## orcClaude Response (with skill loaded)

Two things to handle — let me do both right now.

**1. Frozen agent on surface:42**

Token count unchanged for 15 minutes — that's frozen, not thinking. Following the decision tree:

```
read_screen(surface: surface:42, lines: 100, scrollback: true)
→ Capturing partial work before killing...
→ Last visible activity: "Wrote draft of v3 design, working on critic prompt..."
```

Killing and respawning with the same task, noting what was already done:

```
kill(surface: surface:42)
new_split(direction: right) → surface:58
rename_tab(surface: surface:58, name: "architect-v2")
```

Sending the SAME task with a note about partial progress:

```
send_input(surface: surface:58, text: "
## SURVIVAL BLOCK (re-read after ANY compaction)
I am architectClaude. Repo: $ORCHESTRATOR_REPO. Mission: design sprint plan.
Collab: $ORCHESTRATOR_REPO/collab/sprint-design.md
First action: brain_search('test'). If fails → echo 'BRAINLAYER UNAVAILABLE' >> collab.

NOTE: Previous agent completed draft v3 design. Pick up from critic review.
<original full task prompt>
")
```

Verifying boot in 15s...

**2. Article → ALL active agents**

Forwarding the article to every active surface right now — not storing it for later:

```
send_input(surface: surface:41, text: "NEW CONTEXT: article on agent design patterns — <link>. Incorporate relevant patterns into your work.")
send_input(surface: surface:58, text: "NEW CONTEXT: article on agent design patterns — <link>. Incorporate relevant patterns into your work.")
send_input(surface: surface:43, text: "NEW CONTEXT: article on agent design patterns — <link>. Incorporate relevant patterns into your work.")
```

Also storing for persistence:

```
brain_store(
  content: "Agent design patterns article shared by user — <link>. Forwarded to all 3 active agents (41, 58, 43).",
  tags: ["gem", "agent-patterns", "shared"],
  importance: 6
)
```

Architect respawned in surface:58, article forwarded to all agents. Surface:42 was killed — the new agent has context about what the previous one accomplished.

---

## Assertion Compliance

| Assertion | Pass? | Evidence |
|-----------|-------|----------|
| Kills frozen agent and respawns in new pane | PASS | kill(42) → new_split → send SAME task to surface:58 |
| Does NOT absorb the frozen agent's work | PASS | Never offered to do the design work. Respawned a new agent. |
| Does NOT offer to do the architect's work itself | PASS | No "I'll write the design myself" — strictly delegation |
| Forwards article to ALL active agents | PASS | send_input to surfaces 41, 58, 43 |
| Does NOT brain_store without also sending to agents | PASS | Sent to all agents FIRST, then brain_stored |
