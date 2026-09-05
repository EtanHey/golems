# @golems/mock-mcp

Mock MCP server infrastructure for behavioral testing of AI agent skills. Uses the real MCP SDK `InMemoryTransport` for in-process testing and provides a stdio wrapper for `.mcp.json` integration testing.

## Quick Start

```typescript
import { MockMcpServer, installMatchers } from "@golems/mock-mcp";
import { z } from "zod";

installMatchers();

const server = new MockMcpServer("test");

server.registerMockTool({
  name: "my_tool",
  inputSchema: { message: z.string() },
  handler: (args) => ({ echo: args.message }),
});

const client = await server.connect();
await client.callTool({ name: "my_tool", arguments: { message: "hello" } });

expect(server.getCallCount("my_tool")).toBe(1);
expect(server).toHaveCalledWithArgs("my_tool", { message: "hello" });

await server.close();
```

## Pre-built Mock Servers

Three mock servers with realistic schemas are included:

```typescript
import { MockMcpServer, registerGithubMocks, registerBrainlayerMocks, registerVoicelayerMocks } from "@golems/mock-mcp";

const server = new MockMcpServer();

registerGithubMocks(server);     // gh_pr_create, gh_pr_view, gh_pr_merge, gh_pr_checks
registerBrainlayerMocks(server); // brain_recall, brain_store, brain_digest
registerVoicelayerMocks(server); // voice_speak, voice_ask
```

## Behavioral Assertion Matchers

Install once per test file with `installMatchers()`:

```typescript
// Order assertions
expect(server).toHaveCalledBefore("gh_pr_create", "gh_pr_merge");
expect(server).toHaveCalledInOrder(["create", "review", "merge"]);

// Count assertions
expect(server).toHaveCalledToolCount("brain_store", 1);

// Argument assertions
expect(server).toHaveCalledWithArgs("brain_store", { tags: ["commit"] });
```

## MockMcpServer API

| Method | Description |
|--------|-------------|
| `registerMockTool(config)` | Register a mock tool with optional schema and handler |
| `connect()` | Connect server + client via InMemoryTransport, returns `Client` |
| `getClient()` | Get the connected client (throws if not connected) |
| `getCallCount(name)` | Number of times a tool was called |
| `getAllCalls(name)` | All call records for a tool |
| `getCallSequence()` | All calls in order across all tools |
| `getCallOrder()` | Tool names in call order |
| `getLastCall(name)` | Most recent call for a tool |
| `reset()` | Clear all recorded calls and reset counter |
| `close()` | Close server and client connections |

## Stdio Server (for .mcp.json injection)

For integration testing with real Claude Code sessions:

```json
{
  "mcpServers": {
    "mock-github": {
      "command": "bun",
      "args": ["packages/mock-mcp/src/stdio-server.ts", "--mock", "github"]
    },
    "mock-all": {
      "command": "bun",
      "args": ["packages/mock-mcp/src/stdio-server.ts", "--mock", "github,brainlayer,voicelayer"]
    }
  }
}
```

## Integration Scenario Example

```typescript
import { MockMcpServer, installMatchers, registerGithubMocks } from "@golems/mock-mcp";

installMatchers();

test("PR loop follows correct order", async () => {
  const server = new MockMcpServer();
  registerGithubMocks(server);
  const client = await server.connect();

  await client.callTool({ name: "gh_pr_create", arguments: { title: "feat: thing" } });
  await client.callTool({ name: "gh_pr_checks", arguments: { number: 100 } });
  await client.callTool({ name: "gh_pr_merge", arguments: { number: 100 } });

  expect(server).toHaveCalledBefore("gh_pr_create", "gh_pr_merge");
  expect(server).toHaveCalledInOrder(["gh_pr_create", "gh_pr_checks", "gh_pr_merge"]);

  await server.close();
});
```
