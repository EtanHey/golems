import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MockMcpServer } from "../mock-mcp-server";

/**
 * Mock GitHub MCP server tools: gh pr create, gh pr view, gh pr merge, gh pr checks.
 * Realistic schemas matching typical GitHub PR workflow operations.
 */

const prState = {
  prs: new Map<
    number,
    { title: string; body: string; state: string; merged: boolean }
  >(),
  nextPrNumber: 100,
};

export function createMockGithub(server: McpServer): void {
  server.tool(
    "gh_pr_create",
    "Create a pull request on GitHub",
    {
      title: z.string().describe("PR title"),
      body: z.string().optional().describe("PR body/description"),
      base: z.string().optional().describe("Base branch (default: main)"),
      head: z.string().optional().describe("Head branch"),
      draft: z.boolean().optional().describe("Create as draft PR"),
    },
    async (args) => {
      const prNumber = prState.nextPrNumber++;
      prState.prs.set(prNumber, {
        title: args.title,
        body: args.body ?? "",
        state: args.draft ? "draft" : "open",
        merged: false,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              number: prNumber,
              url: `https://github.com/test/repo/pull/${prNumber}`,
              title: args.title,
              state: args.draft ? "draft" : "open",
            }),
          },
        ],
      };
    },
  );

  server.tool(
    "gh_pr_view",
    "View a pull request",
    {
      number: z.number().describe("PR number"),
    },
    async (args) => {
      const pr = prState.prs.get(args.number);
      if (!pr) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: `PR #${args.number} not found` }),
            },
          ],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              number: args.number,
              title: pr.title,
              body: pr.body,
              state: pr.state,
              merged: pr.merged,
            }),
          },
        ],
      };
    },
  );

  server.tool(
    "gh_pr_merge",
    "Merge a pull request",
    {
      number: z.number().describe("PR number"),
      method: z
        .enum(["squash", "merge", "rebase"])
        .optional()
        .describe("Merge method"),
    },
    async (args) => {
      const pr = prState.prs.get(args.number);
      if (!pr) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: `PR #${args.number} not found` }),
            },
          ],
          isError: true,
        };
      }
      if (pr.merged) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `PR #${args.number} already merged`,
              }),
            },
          ],
          isError: true,
        };
      }
      pr.state = "closed";
      pr.merged = true;
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              number: args.number,
              merged: true,
              method: args.method ?? "squash",
            }),
          },
        ],
      };
    },
  );

  server.tool(
    "gh_pr_checks",
    "View CI check status for a pull request",
    {
      number: z.number().describe("PR number"),
    },
    async (args) => {
      const pr = prState.prs.get(args.number);
      if (!pr) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: `PR #${args.number} not found` }),
            },
          ],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              number: args.number,
              checks: [
                { name: "lint", status: "completed", conclusion: "success" },
                { name: "test", status: "completed", conclusion: "success" },
                { name: "build", status: "completed", conclusion: "success" },
              ],
              overall: "success",
            }),
          },
        ],
      };
    },
  );
}

/**
 * Register GitHub mock tools on a MockMcpServer instance.
 * Records all calls for behavioral assertions.
 */
export function registerGithubMocks(mock: MockMcpServer): void {
  mock.registerMockTool({
    name: "gh_pr_create",
    description: "Create a pull request on GitHub",
    inputSchema: {
      title: z.string(),
      body: z.string().optional(),
      base: z.string().optional(),
      head: z.string().optional(),
      draft: z.boolean().optional(),
    },
    handler: (args) => ({
      number: 100,
      url: "https://github.com/test/repo/pull/100",
      title: args.title,
      state: args.draft ? "draft" : "open",
    }),
  });

  mock.registerMockTool({
    name: "gh_pr_view",
    description: "View a pull request",
    inputSchema: { number: z.number() },
    handler: (args) => ({
      number: args.number,
      title: "Test PR",
      state: "open",
      merged: false,
    }),
  });

  mock.registerMockTool({
    name: "gh_pr_merge",
    description: "Merge a pull request",
    inputSchema: {
      number: z.number(),
      method: z.enum(["squash", "merge", "rebase"]).optional(),
    },
    handler: (args) => ({
      number: args.number,
      merged: true,
      method: args.method ?? "squash",
    }),
  });

  mock.registerMockTool({
    name: "gh_pr_checks",
    description: "View CI check status for a PR",
    inputSchema: { number: z.number() },
    handler: () => ({
      checks: [
        { name: "lint", status: "completed", conclusion: "success" },
        { name: "test", status: "completed", conclusion: "success" },
      ],
      overall: "success",
    }),
  });
}
