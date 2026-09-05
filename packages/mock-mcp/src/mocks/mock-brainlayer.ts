import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MockMcpServer } from "../mock-mcp-server";

/**
 * Mock BrainLayer MCP server tools: brain_recall, brain_store, brain_digest.
 * Simulates the 3-tool simplified BrainLayer API.
 */

function createBrainState() {
  return {
    chunks: new Map<
      string,
      { content: string; tags: string[]; importance: number }
    >(),
    nextId: 1,
  };
}

export function createMockBrainlayer(server: McpServer): void {
  const brainState = createBrainState();

  server.tool(
    "brain_recall",
    "Search BrainLayer memory for relevant chunks",
    {
      query: z.string().describe("Search query"),
      limit: z.number().optional().describe("Max results (default: 5)"),
      tags: z.array(z.string()).optional().describe("Filter by tags"),
    },
    async (args) => {
      const results = Array.from(brainState.chunks.entries())
        .filter(([_, chunk]) => {
          const matchesQuery = chunk.content
            .toLowerCase()
            .includes(args.query.toLowerCase());
          if (args.tags && args.tags.length > 0) {
            const matchesTag = args.tags.some((t) => chunk.tags.includes(t));
            return matchesQuery || matchesTag;
          }
          return matchesQuery;
        })
        .slice(0, args.limit ?? 5)
        .map(([id, chunk]) => ({ id, ...chunk }));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ results, count: results.length }),
          },
        ],
      };
    },
  );

  server.tool(
    "brain_store",
    "Store a new knowledge chunk in BrainLayer",
    {
      content: z.string().describe("Content to store"),
      tags: z.array(z.string()).optional().describe("Tags for the chunk"),
      importance: z
        .number()
        .min(1)
        .max(10)
        .optional()
        .describe("Importance 1-10"),
      project: z.string().optional().describe("Project name"),
    },
    async (args) => {
      const id = `chunk-${brainState.nextId++}`;
      brainState.chunks.set(id, {
        content: args.content,
        tags: args.tags ?? [],
        importance: args.importance ?? 5,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ id, stored: true }),
          },
        ],
      };
    },
  );

  server.tool(
    "brain_digest",
    "Digest large content into structured knowledge",
    {
      content: z.string().describe("Raw content to digest"),
      source: z.string().optional().describe("Source identifier"),
    },
    async (args) => {
      const entityCount = Math.floor(args.content.length / 100) + 1;
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              digested: true,
              entities_extracted: entityCount,
              relations_found: Math.max(0, entityCount - 1),
              source: args.source ?? "unknown",
            }),
          },
        ],
      };
    },
  );
}

/**
 * Register BrainLayer mock tools on a MockMcpServer instance.
 */
export function registerBrainlayerMocks(mock: MockMcpServer): void {
  mock.registerMockTool({
    name: "brain_recall",
    description: "Search BrainLayer memory",
    inputSchema: {
      query: z.string(),
      limit: z.number().optional(),
      tags: z.array(z.string()).optional(),
    },
    handler: (args) => ({
      results: [
        {
          id: "chunk-1",
          content: `Mock result for: ${args.query}`,
          tags: (args.tags as string[]) ?? [],
          importance: 7,
        },
      ],
      count: 1,
    }),
  });

  mock.registerMockTool({
    name: "brain_store",
    description: "Store knowledge in BrainLayer",
    inputSchema: {
      content: z.string(),
      tags: z.array(z.string()).optional(),
      importance: z.number().optional(),
      project: z.string().optional(),
    },
    handler: () => ({ id: "chunk-mock-1", stored: true }),
  });

  mock.registerMockTool({
    name: "brain_digest",
    description: "Digest large content into structured knowledge",
    inputSchema: {
      content: z.string(),
      source: z.string().optional(),
    },
    handler: (args) => ({
      digested: true,
      entities_extracted: 3,
      relations_found: 2,
      source: args.source ?? "unknown",
    }),
  });
}
