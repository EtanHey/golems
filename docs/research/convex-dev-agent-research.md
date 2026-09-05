# @convex-dev/agent Research Report

> Researched: 2026-02-26 | Sources: 22 | Queries: 18

## Executive Summary

`@convex-dev/agent` is an official Convex Component that provides a full AI agent framework on top of Convex. It handles thread/message persistence, hybrid vector+text search (RAG) over conversation history, streaming (text and objects), tool calling via the Vercel AI SDK, and durable multi-step workflows. The package is actively maintained by the Convex team (Ian Macartney is the primary author), currently at v0.6.x with ~25K weekly npm downloads and 284 GitHub stars. It supports `generateObject` with Zod schemas for structured JSON output, which is exactly what the copilot use case needs. **For a meeting scheduling app with per-person copilot threads returning structured constraints, this component is a strong fit -- it would save 2-3 weeks of building thread management, message persistence, and context retrieval from scratch.**

## Key Findings

### 1. What It Does

`@convex-dev/agent` is an AI agent framework built on Convex Components. It wraps the Vercel AI SDK and provides:

- **Automatic chat history storage** per-user or per-thread, spanning multiple agents
- **Hybrid RAG** for chat context via text search + vector search, configurable per-agent
- **Structured output** via `generateObject` / `streamObject` with Zod schemas, stored as JSON in messages
- **Tool calls** via the AI SDK `tool()` function plus Convex-specific `createTool()` wrappers that get `ctx` access
- **Streaming** over Convex WebSockets (not HTTP streaming) with delta-based sync
- **Workflow integration** with `@convex-dev/workflow` for durable multi-step agent pipelines
- **Usage tracking** per provider/model/user/agent for billing
- **Rate limiting** via the Rate Limiter Component
- **Real-time reactivity** -- messages update live on all connected clients via Convex subscriptions

It is NOT a standalone LLM library. It is a persistence + orchestration layer that delegates actual LLM calls to the Vercel AI SDK, meaning you can use any AI SDK provider (`@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, etc.).

- Source: [NPM Package](https://www.npmjs.com/package/@convex-dev/agent)
- Source: [Convex Docs - AI Agents](https://docs.convex.dev/agents)
- Source: [GitHub - get-convex/agent](https://github.com/get-convex/agent)

### 2. Thread Management (Core Feature)

Threads are first-class. Each thread is a linear message history that can be:
- Associated with a `userId`
- Given metadata (`title`, `summary`)
- Shared across multiple agents (any agent can write to any thread)
- Listed per user with pagination
- Deleted individually or in bulk by user

```typescript
import { createThread } from "@convex-dev/agent";

// Create a thread in a mutation or action
const threadId = await createThread(ctx, components.agent, {
  userId: "person_123",
  title: "Meeting constraints for Alice",
  summary: "Copilot thread for extracting Alice's scheduling preferences",
});

// Continue a thread (returns a thread object with convenience methods)
const { thread } = await agent.continueThread(ctx, { threadId });
const result = await thread.generateText({ prompt: "What times work for you?" });

// List all threads for a user
const threads = await ctx.runQuery(
  components.agent.threads.listThreadsByUserId,
  { userId, paginationOpts: { cursor: null, numItems: 50 } },
);
```

The `thread` object returned by `continueThread` or `createThread` (in actions) has bound convenience methods:
- `thread.generateText()`
- `thread.generateObject()`
- `thread.streamText()`
- `thread.streamObject()`
- `thread.getMetadata()`
- `thread.updateMetadata()`

- Source: [Convex Docs - Threads](https://docs.convex.dev/agents/threads)
- Source: [Stack Post - AI Agents](https://stack.convex.dev/ai-agents)

### 3. Structured Output (generateObject with Zod)

This is directly relevant to the copilot constraint extraction use case. The agent supports `generateObject` which returns validated JSON matching a Zod schema:

```typescript
import { Agent } from "@convex-dev/agent";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

const copilotAgent = new Agent(components.agent, {
  name: "meeting-copilot",
  languageModel: anthropic("claude-sonnet-4-5-20250514"),
  instructions: `You are a scheduling copilot. Extract the user's time
    constraints for the upcoming meeting. Ask clarifying questions if needed.`,
});

// Direct generateObject call
const result = await copilotAgent.generateObject(ctx, { threadId }, {
  prompt: "I can do Tuesday or Thursday afternoon, but not before 2pm",
  output: "object",
  schema: z.object({
    availableSlots: z.array(z.object({
      day: z.string().describe("Day of the week"),
      startTime: z.string().describe("Earliest available time in HH:MM format"),
      endTime: z.string().describe("Latest available time in HH:MM format"),
    })),
    hardConstraints: z.array(z.string()).describe("Non-negotiable scheduling rules"),
    preferences: z.array(z.string()).describe("Soft preferences, nice-to-haves"),
    confidence: z.number().min(0).max(1).describe("How confident the copilot is that all constraints are captured"),
  }),
});

// result.object is fully typed and Zod-validated
const constraints = result.object;
```

You can also expose this as a standalone Convex action for use in workflows:

```typescript
export const extractConstraints = copilotAgent.asObjectAction({
  schema: z.object({
    availableSlots: z.array(z.object({
      day: z.string(),
      startTime: z.string(),
      endTime: z.string(),
    })),
    hardConstraints: z.array(z.string()),
    preferences: z.array(z.string()),
    confidence: z.number(),
  }),
});
```

**Caveat:** A Discord thread from April 2025 showed a user hitting type errors with `generateObject` schema types. The Convex team (Ian) confirmed you need to pass `output: "object"` explicitly. There were TypeScript type inference issues that required `@ts-ignore` in some cases. This was on an older version (v0.3.x) -- the v0.6.x API with AI SDK v6 may have resolved this.

- Source: [Convex Docs - Workflows](https://docs.convex.dev/agents/workflows) (asObjectAction example)
- Source: [Discord Thread - generateObject](https://discord-questions.convex.dev/m/1364188747536531497)
- Source: [AI SDK - generateObject](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-object)

### 4. Tool Use Integration

Tools use the standard AI SDK `tool()` function. Convex adds `createTool()` which provides Convex context:

```typescript
import { tool } from "ai";
import { createTool } from "@convex-dev/agent";
import { z } from "zod";

// Standard AI SDK tool (no Convex context)
const checkCalendar = tool({
  description: "Check if a time slot is available on the calendar",
  parameters: z.object({
    date: z.string(),
    startTime: z.string(),
    endTime: z.string(),
  }),
  execute: async ({ date, startTime, endTime }) => {
    // Call external calendar API
    return { available: true };
  },
});

// Convex-aware tool (has ctx for queries/mutations)
const lookupMeetingHistory = createTool({
  description: "Look up past meeting patterns for this person",
  args: z.object({
    personId: z.string().describe("The person to look up"),
  }),
  handler: async (ctx, { personId }) => {
    // ctx has userId, threadId, messageId, and action ctx
    const history = await ctx.runQuery(api.meetings.getHistory, { personId });
    return JSON.stringify(history);
  },
});

const agent = new Agent(components.agent, {
  name: "scheduler-copilot",
  languageModel: anthropic("claude-sonnet-4-5-20250514"),
  tools: { checkCalendar, lookupMeetingHistory },
  maxSteps: 5,
});
```

Tool calls are persisted in the thread history. The framework supports tool call approval/denial for human-in-the-loop workflows (`agent.approveToolCall()` / `agent.denyToolCall()`).

- Source: [NPM README](https://www.npmjs.com/package/@convex-dev/agent)
- Source: [Convex Docs - Getting Started](https://docs.convex.dev/agents/getting-started)

### 5. Hybrid Search (RAG)

The component includes built-in hybrid search over message history:

- **Vector search**: requires an embedding model (e.g., `openai.embedding("text-embedding-3-small")`)
- **Text search**: FTS over message content
- **Cross-thread search**: optionally search messages from other threads for the same user
- **Configurable context window**: control how many recent messages to include

```typescript
const agent = new Agent(components.agent, {
  name: "copilot",
  languageModel: anthropic("claude-sonnet-4-5-20250514"),
  textEmbedding: openai.embedding("text-embedding-3-small"),
  // Context is auto-included in LLM calls
});

// Or fetch context manually
const messages = await agent.fetchContextMessages(ctx, {
  userId: "person_123",
  threadId,
  messages: [{ role: "user", content: "What about next week?" }],
  contextOptions: {
    searchOtherThreads: true,
    recentMessages: 10,
    searchOptions: {
      textSearch: true,
      vectorSearch: true,
      limit: 10,
    },
  },
});
```

For the meeting scheduling use case, vector search is probably overkill for per-person copilot threads (they'll be short conversations). But it would be valuable if you want cross-meeting context ("what constraints did Alice give last time?").

- Source: [Convex Docs - RAG](https://docs.convex.dev/agents/rag)
- Source: [Stack Post](https://stack.convex.dev/ai-agents)

### 6. Setup in a Convex Project

The setup is minimal -- 3 steps:

**Step 1: Install**
```bash
npm install @convex-dev/agent @ai-sdk/anthropic ai zod
```

**Step 2: Register the component**
```typescript
// convex/convex.config.ts
import { defineApp } from "convex/server";
import agent from "@convex-dev/agent/convex.config";

const app = defineApp();
app.use(agent);

export default app;
```

**Step 3: Run codegen**
```bash
npx convex dev
```

This creates the component's tables (messages, threads, files, streamingMessages, streamDeltas, etc.) in the Convex dashboard under the "agent" component namespace.

**Step 4: Define agents and use them**
```typescript
// convex/agents.ts
import { components } from "./_generated/api";
import { Agent, createTool } from "@convex-dev/agent";
import { anthropic } from "@ai-sdk/anthropic";

export const copilotAgent = new Agent(components.agent, {
  name: "meeting-copilot",
  languageModel: anthropic("claude-sonnet-4-5-20250514"),
  instructions: "You help people express their scheduling constraints.",
  maxSteps: 3,
});
```

**Environment variables needed:**
```
ANTHROPIC_API_KEY=sk-ant-...   # or whichever provider
```

- Source: [Convex Docs - Getting Started](https://docs.convex.dev/agents/getting-started)

### 7. Current State & Stability

| Metric | Value |
|--------|-------|
| Current version | v0.6.x (latest stable, requires AI SDK v6) |
| Weekly downloads | ~25K |
| GitHub stars | 284 |
| Total versions published | 38+ |
| License | Apache-2.0 |
| Dependencies | 0 (peer deps: ai, convex) |
| Maintainers | 13 (full Convex team) |
| Last publish | ~1 day ago (very active) |

**API stability concern:** The package went through a breaking change from v0.3.x to v0.6.0, renaming `chat` to `languageModel` in the Agent constructor and requiring AI SDK v6. The migration guide exists at `MIGRATION.md` in the repo. The package is pre-1.0, so more breaking changes are possible.

**Known issues (from GitHub):**
- 10-minute action timeout for long-running agents (Issue #199) -- mitigated by workflow component
- Human-in-the-loop workflow support is limited (Issue #26)
- Triggers on component tables don't work from consuming apps (Issue #147)
- Some type inference issues with `generateObject` schemas (Discord)

- Source: [NPM - version history](https://www.npmjs.com/package/@convex-dev/agent)
- Source: [GitHub Issues](https://github.com/get-convex/agent/issues)
- Source: [Migration Guide](https://github.com/get-convex/agent/blob/main/MIGRATION.md)

## Comparison: @convex-dev/agent vs. Custom Implementation

| Aspect | @convex-dev/agent | Custom Convex Functions |
|--------|-------------------|------------------------|
| **Thread management** | Built-in: create, continue, list, delete, metadata | You build: 1-2 tables, 5-6 functions |
| **Message persistence** | Automatic, with ordering, status tracking | You build: message table, insert/query functions |
| **generateObject (structured output)** | Built-in, wraps AI SDK | You call AI SDK directly -- same code, no wrapper |
| **Tool calls** | Built-in with `createTool()` for Convex context | You wire tools manually -- same AI SDK `tool()` API |
| **Streaming** | WebSocket delta streaming out of the box | You build: delta table, sync logic, React hooks |
| **Hybrid search / RAG** | Built-in vector + text search over messages | You build: embeddings, vector index, search queries |
| **Multi-agent handoff** | Any agent can write to any thread | You manage thread ownership manually |
| **Usage tracking** | Built-in usageHandler callback | You build: logging table, cost calculation |
| **Debugging** | Playground UI, dashboard inspection | You build your own |
| **Real-time UI updates** | useUIMessages hook, optimistic updates | You build: useQuery + custom message rendering |
| **Dependencies** | AI SDK v6, convex -- adds component tables to your project | Just Convex + AI SDK (same deps, fewer abstractions) |
| **Learning curve** | Component system, specific API conventions | Standard Convex patterns you already know |
| **Flexibility** | Constrained to their thread/message model | Total control over data model |
| **API stability** | Pre-1.0, has had breaking changes | Your code, your stability |
| **Setup time** | ~30 minutes to first agent | ~2-3 days for equivalent thread+message infra |

## Assessment for Your Meeting Scheduling App

### Your Requirements Mapped to @convex-dev/agent

| Requirement | Support | Notes |
|-------------|---------|-------|
| Copilot per person per meeting | Thread per (meeting, person) pair | Use `createThread` with userId + meeting metadata |
| Own conversation thread per copilot | Native -- threads are first-class | Each copilot gets its own threadId |
| Structured JSON constraints via Zod | `generateObject` with Zod schema | Works, but had type issues in v0.3 (likely fixed in v0.6) |
| Store results per meeting per person | Messages stored automatically | You'd query the final `generateObject` result from the thread |
| Claude as the LLM | `@ai-sdk/anthropic` provider | Fully supported, swap `languageModel` parameter |
| Multiple copilots run in parallel | Each is an independent thread | No shared state issues |

### Architecture Sketch with @convex-dev/agent

```
Meeting Created
  |
  v
For each participant:
  1. createThread(ctx, components.agent, {
       userId: participantId,
       title: `Meeting ${meetingId} - ${participantName}`,
     })
  2. Store threadId in your meetings table: meetingParticipants[participantId].threadId

Copilot Conversation (per participant):
  3. copilotAgent.generateText(ctx, { threadId }, {
       prompt: "Hi! Let's find a good time for your meeting with [others]. What days/times work for you?"
     })
  4. ... multi-turn conversation ...
  5. copilotAgent.generateObject(ctx, { threadId }, {
       prompt: "Based on our conversation, summarize all scheduling constraints.",
       output: "object",
       schema: ConstraintsSchema,  // Zod schema
     })
  6. Store result.object in your meetings table

Constraint Resolution:
  7. Read all participants' constraints from your table
  8. Run scheduling algorithm (no LLM needed -- pure logic)
  9. Propose times back to participants
```

### Recommendation: USE @convex-dev/agent

**The verdict: use it.** Here's why:

1. **Thread management is the hard part.** Creating a thread-per-copilot model, persisting messages with ordering, supporting multi-turn conversations, and cleaning up -- this is ~60% of the work. The component handles all of it.

2. **generateObject works.** It wraps the AI SDK's `generateObject` which handles Zod validation natively. The early type issues (v0.3) appear resolved in v0.6.

3. **You're already on Convex.** The component integrates natively -- it uses Convex tables, actions, mutations. No external infrastructure.

4. **The abstraction cost is low.** You're not locked in to a black box. The component exposes raw message queries (`components.agent.messages.getThreadMessages`), so you can always bypass the Agent class and query data directly.

5. **Future-proof for multi-agent.** If you later want copilots to negotiate with each other (agent-to-agent), the framework already supports multiple agents writing to the same thread.

**When you'd skip it:**

- If copilot conversations are always single-turn (one prompt -> one structured response). In that case, just call `generateObject` from the AI SDK directly in a Convex action. No threads needed.
- If you need a data model that doesn't fit the thread/message paradigm (e.g., tree-structured conversations).
- If you're allergic to pre-1.0 dependencies with breaking change risk.

### Minimal Implementation (if you skip the component)

For comparison, here's what "rolling your own" looks like:

```typescript
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  copilotThreads: defineTable({
    meetingId: v.id("meetings"),
    participantId: v.string(),
    messages: v.array(v.object({
      role: v.union(v.literal("user"), v.literal("assistant")),
      content: v.string(),
      timestamp: v.number(),
    })),
    constraints: v.optional(v.any()), // Final extracted constraints
    status: v.union(v.literal("active"), v.literal("completed")),
  }).index("by_meeting", ["meetingId"])
    .index("by_participant", ["participantId"]),
});

// convex/copilot.ts
import { action } from "./_generated/server";
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

const ConstraintsSchema = z.object({
  availableSlots: z.array(z.object({
    day: z.string(),
    startTime: z.string(),
    endTime: z.string(),
  })),
  hardConstraints: z.array(z.string()),
  preferences: z.array(z.string()),
  confidence: z.number(),
});

export const extractConstraints = action({
  args: { threadId: v.id("copilotThreads"), userMessage: v.string() },
  handler: async (ctx, { threadId, userMessage }) => {
    const thread = await ctx.runQuery(internal.copilot.getThread, { threadId });

    // Build message history
    const messages = thread.messages.map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
    messages.push({ role: "user", content: userMessage });

    const result = await generateObject({
      model: anthropic("claude-sonnet-4-5-20250514"),
      schema: ConstraintsSchema,
      system: "You extract scheduling constraints from conversation.",
      messages,
    });

    await ctx.runMutation(internal.copilot.saveConstraints, {
      threadId,
      constraints: result.object,
      userMessage,
    });

    return result.object;
  },
});
```

This custom approach is ~100 lines vs. ~30 lines with the component. The difference grows as you add streaming, search, multi-agent, and real-time UI updates.

## Contradictions & Caveats

1. **API naming inconsistency in docs:** Older blog posts and the Stack article use `chat:` in the Agent constructor. Current docs use `languageModel:`. The migration from v0.3 to v0.6 renamed this. Make sure to use the v0.6 API.

2. **generateObject type issues:** A Discord thread from April 2025 showed TypeScript type inference problems with `generateObject` schemas. The workaround was passing `output: "object"` explicitly and/or using `@ts-ignore`. This may be resolved in v0.6 but is worth testing.

3. **Pre-1.0 stability:** 38+ versions published, including a major breaking change (v0.3 -> v0.6). The API is actively evolving. The Convex team is responsive (Ian answered Discord questions within hours), but expect to update your code when upgrading.

4. **10-minute timeout:** Convex actions have a 10-minute timeout. For copilot conversations this is not an issue (each LLM call is seconds), but it's a gotcha for long-running agent loops with many tool calls.

5. **Component table access:** The agent's tables live in a component namespace. You can query them, but you cannot create Convex indexes or triggers on them from your app code (GitHub Issue #147).

## Sources

1. [NPM - @convex-dev/agent](https://www.npmjs.com/package/@convex-dev/agent) -- Package metadata, README, version history
2. [Convex Docs - AI Agents Overview](https://docs.convex.dev/agents) -- Architecture, core concepts
3. [Convex Docs - Getting Started](https://docs.convex.dev/agents/getting-started) -- Setup, installation, first agent
4. [Convex Docs - Threads](https://docs.convex.dev/agents/threads) -- Thread CRUD, metadata, user association
5. [Convex Docs - Messages](https://docs.convex.dev/agents/messages) -- Message persistence, UIMessage type, React hooks
6. [Convex Docs - Streaming](https://docs.convex.dev/agents/streaming) -- Delta streaming, WebSocket sync
7. [Convex Docs - RAG](https://docs.convex.dev/agents/rag) -- Hybrid search, vector+text, namespace isolation
8. [Convex Docs - Workflows](https://docs.convex.dev/agents/workflows) -- asObjectAction, asTextAction, durable workflows
9. [Convex Docs - Debugging](https://docs.convex.dev/agents/debugging) -- Playground, logging, dashboard inspection
10. [Convex Docs - Playground](https://docs.convex.dev/agents/playground) -- Interactive testing UI
11. [GitHub - get-convex/agent](https://github.com/get-convex/agent) -- Source code, 284 stars, Apache-2.0
12. [GitHub - Migration Guide](https://github.com/get-convex/agent/blob/main/MIGRATION.md) -- v0.3 to v0.6 breaking changes
13. [GitHub Issue #199](https://github.com/get-convex/agent/issues/199) -- 10-min action timeout for long agents
14. [GitHub Issue #202](https://github.com/get-convex/agent/issues/202) -- AI SDK v6 compatibility (53 build errors)
15. [GitHub Issue #26](https://github.com/get-convex/agent/issues/26) -- Human-in-the-loop limitations
16. [GitHub Issue #147](https://github.com/get-convex/agent/issues/147) -- Triggers on component tables
17. [Stack Post - AI Agents with Built-in Memory](https://stack.convex.dev/ai-agents) -- Deep dive by Ian Macartney
18. [Convex Components - AI Agent](https://www.convex.dev/components/agent) -- Marketing page, feature list
19. [Discord - generateObject thread](https://discord-questions.convex.dev/m/1364188747536531497) -- Type error workaround
20. [AI SDK - generateObject reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-object) -- Underlying API
21. [AI SDK - Anthropic Provider](https://ai-sdk.dev/providers/ai-sdk-providers/anthropic) -- Claude model setup
22. [Convex - Durable Agents](https://www.convex.dev/components/durable-agents) -- Long-lived agent patterns
