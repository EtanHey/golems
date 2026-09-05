#!/usr/bin/env bun
/**
 * Stdio-based mock MCP server for .mcp.json injection.
 *
 * InMemoryTransport only works for in-process tests. This script creates
 * a real stdio MCP server that can be configured in .mcp.json for
 * integration testing with actual Claude Code sessions.
 *
 * Usage in .mcp.json:
 *   {
 *     "mcpServers": {
 *       "mock-github": {
 *         "command": "bun",
 *         "args": ["packages/mock-mcp/src/stdio-server.ts", "--mock", "github"]
 *       }
 *     }
 *   }
 *
 * Supported mocks: github, brainlayer, voicelayer
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMockGithub } from "./mocks/mock-github";
import { createMockBrainlayer } from "./mocks/mock-brainlayer";
import { createMockVoicelayer } from "./mocks/mock-voicelayer";

type MockRegistrar = (server: McpServer) => void;

const MOCKS: Record<string, MockRegistrar> = {
  github: createMockGithub,
  brainlayer: createMockBrainlayer,
  voicelayer: createMockVoicelayer,
};

function main() {
  const args = process.argv.slice(2);
  const mockIdx = args.indexOf("--mock");

  if (mockIdx === -1 || !args[mockIdx + 1]) {
    const availableMocks = Object.keys(MOCKS).join(", ");
    process.stderr.write(
      `Usage: bun stdio-server.ts --mock <name>\nAvailable mocks: ${availableMocks}\n`,
    );
    process.exit(1);
  }

  const mockNames = args[mockIdx + 1].split(",");
  const server = new McpServer(
    { name: "mock-mcp-stdio", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  for (const mockName of mockNames) {
    const registrar = MOCKS[mockName.trim()];
    if (!registrar) {
      process.stderr.write(
        `Unknown mock: "${mockName}". Available: ${Object.keys(MOCKS).join(", ")}\n`,
      );
      process.exit(1);
    }
    registrar(server);
  }

  const transport = new StdioServerTransport();
  server.connect(transport).then(() => {
    process.stderr.write(
      `Mock MCP server running (stdio) with mocks: ${mockNames.join(", ")}\n`,
    );
  });
}

main();
