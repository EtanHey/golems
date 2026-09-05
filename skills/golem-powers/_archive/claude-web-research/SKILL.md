---
name: claude-web-research
description: "DEPRECATED ALIAS — renamed to /claude-desktop-research on 2026-04-30. Use /claude-desktop-research instead. This alias remains active until 2026-05-30, then retires. Triggers: 'research prompt', 'Claude Web research', 'Claude Desktop research', 'deep research'."
---

# /claude-web-research — DEPRECATED ALIAS

**This skill was renamed to `/claude-desktop-research` on 2026-04-30.**

User correction: BOTH Claude Web AND Claude Desktop have deep research + Drive grounding. The differentiator is local MCP connections — those are unique to Claude Desktop. So the umbrella skill is now `/claude-desktop-research` (web is the MCP-less subset).

## What to do now

- **Invoke `/claude-desktop-research` instead.** Same workflow, same Drive layout, plus an MCP pre-flight step.
- **This alias retires on 2026-05-30** (~30 days from rename).
- **Existing Drive files do not need to be moved.** Result file naming is now `R{NN}-claude-desktop-result.md` going forward; legacy `R{NN}-claude-web-result.md` files stay where they are (no migration required).

## See also

- `/claude-desktop-research` — the canonical skill (this used to be).
- `/research` — quick local web search.
- `/gemini-research` — Gemini Deep Research (visual / batch-frame work).
- `/research --unified` — paired Drive-grounded dispatch to both Claude Desktop AND Gemini.

(If your invocation reaches THIS file rather than the new canonical, the runtime is resolving the legacy slug. That's expected through 2026-05-30 — please follow the canonical workflow at `~/Gits/golems/skills/golem-powers/claude-desktop-research/SKILL.md` regardless.)
