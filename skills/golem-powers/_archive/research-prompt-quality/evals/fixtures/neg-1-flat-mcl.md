# NEG-1 — flat MCL deep-research prompt (reconstructed pre-grounding, gen-10)

> Source: `skill-creator/docs.local/weave-2026-05-29/plans/track-4-MCL.md` §/deep-research prompt (2026-05-29). Ungrounded: no Drive folders, no repo path examples, no prior-art stance table.

```
Design the Meta-Communication Layer (MCL): a persistent inter-agent communication
substrate for a multi-agent coding ecosystem (Claude Code, OpenAI Codex CLI, Cursor
CLI agents running in adjacent terminal panes), replacing the current hack of injecting
text into another agent's CLI stdin.

Answer these, with citations and concrete code/schema shapes:

1. MESSAGE FORMAT — Compare three options for the canonical message envelope:
   (a) OpenAI Agents SDK message format (handoffs, message items, tool-call items),
   (b) A2A (Agent-to-Agent) emerging open protocol,
   (c) a custom minimal envelope.
   The owner wants ONE standard (leaning OpenAI Agents SDK). For each: maturity,
   schema stability, handoff semantics, vendor lock-in risk, and ecosystem momentum
   (is A2A worth standardizing on instead, or tracking-only?).

2. ASYNC TRANSPORT — The OpenAI Agents SDK provides the message FORMAT but LACKS
   async/offline messaging. Design a channel/inbox transport ON TOP of the chosen
   format so Agent B can receive a message Agent A sent while B was offline/busy.
   Compare transport substrates (file-based inbox dirs, SQLite, a lightweight broker,
   an MCP-server-backed queue). Required properties: at-least-once delivery, ordering
   per channel, durable across process restarts, and RESILIENCE TO MCP RECONNECTS
   (the owner repeatedly loses MCP connections and refuses to keep reconnecting by
   hand — the transport must NOT assume a live socket). Recommend one.

3. PER-VENDOR ADAPTERS — Design the adapter contract that translates the canonical
   envelope to each agent CLI's real ingress: Claude Code (note: a new "message-display
   hook" can transform/hide assistant message text as displayed — evaluate whether this
   hook is a viable Claude-native channel ingress instead of stdin injection), Codex
   CLI, Cursor CLI. What is the minimal adapter interface?

4. MCP SURFACE — How should MCL expose itself as an MCP server so other tools (a
   terminal multiplexer's role-based pane registry; a memory-system "live agents"
   panel) can read the channel/agent registry? Sketch the tool surface.

5. SECURITY — This will be an open-source repo whose PRs the owner may run. Recommend
   branch-protection + required-AI-reviewer (Greptile, CodeRabbit, Macroscope) gating,
   and any message-authentication concerns for a comms plane (spoofed agent identity,
   replay).

Deliverable: a recommended architecture (schema + transport + adapter contract + MCP
surface) with a component seam map (4 packages), tradeoffs cited, and a "could a second
agent implement from this alone?" decision summary. Flag every claim's source; do NOT
state performance numbers without a cited benchmark.
```
