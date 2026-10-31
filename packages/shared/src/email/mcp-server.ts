/**
 * EmailGolem MCP Server
 *
 * Exposes email data as MCP tools for Claude Code.
 * Tools: Gmail search and reply drafts
 *
 * Usage in .mcp.json:
 * {
 *   "golems-email": {
 *     "command": "bun",
 *     "args": ["run", "packages/shared/src/email/mcp-server.ts"]
 *   }
 * }
 */

// Load env first (launchd runs from /)
import "../lib/load-env";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { searchEmails } from "./gmail-client";
import { buildReplyDraft, type ReplyDraftInput } from "./draft-reply";

const server = new Server(
  { name: "golems-email", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

// --- Tool definitions ---

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "email_search",
      description:
        "Search Gmail using Gmail query syntax. Returns matching messages.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Gmail query (for example from:sender or subject:receipt)",
          },
          limit: {
            type: "number",
            description: "Max results (default: 20)",
            default: 20,
          },
        },
        required: ["query"],
      },
    },
    {
      name: "email_draftReply",
      description:
        "Draft a reply to an email. Generates a template-based reply draft that can be reviewed and sent.",
      inputSchema: {
        type: "object" as const,
        properties: {
          subject: {
            type: "string",
            description: "Original email subject",
          },
          from: {
            type: "string",
            description: "Original sender email address",
          },
          snippet: {
            type: "string",
            description: "Email snippet/preview text",
          },
          category: {
            type: "string",
            description:
              "Email category (interview, job, urgent, subscription, etc.)",
          },
          intent: {
            type: "string",
            description:
              "Reply intent: accept, decline, interested, followup, acknowledge",
            enum: [
              "accept",
              "decline",
              "interested",
              "followup",
              "acknowledge",
            ],
          },
          customNote: {
            type: "string",
            description: "Optional custom note to prepend to the template",
          },
        },
        required: ["subject", "from", "intent"],
      },
    },
  ],
}));

// --- Tool handlers ---

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "email_search":
        return handleSearch(args);
      case "email_draftReply":
        return handleDraftReply(args);
      default:
        return {
          content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
        };
    }
  } catch (err: unknown) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Error in ${name}: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }
});

type McpArgs = Record<string, unknown> | undefined;

async function handleSearch(args: McpArgs) {
  const query = args?.query;
  const limit = typeof args?.limit === "number" ? args.limit : 20;

  if (typeof query !== "string" || !query) {
    return {
      content: [{ type: "text" as const, text: "Missing required: query" }],
      isError: true,
    };
  }

  const matches = await searchEmails(query, limit);

  if (matches.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: `No emails matching "${query}".`,
        },
      ],
    };
  }

  const lines = [
    `## Email Search: "${query}"`,
    `**${matches.length} matches**\n`,
    ...matches.map((email) => `- **${email.subject}** from ${email.from} (${email.receivedAt.toLocaleString()})`),
  ];

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

async function handleDraftReply(args: McpArgs) {
  const { subject, from, snippet, category, intent, customNote } = args || {};

  if (typeof subject !== "string" || !subject || typeof from !== "string" || !from ||
      (intent !== "accept" && intent !== "decline" && intent !== "interested" &&
       intent !== "followup" && intent !== "acknowledge")) {
    return {
      content: [
        {
          type: "text" as const,
          text: "Missing required: subject, from, intent",
        },
      ],
      isError: true,
    };
  }

  const input: ReplyDraftInput = {
    originalSubject: subject,
    originalFrom: from,
    originalSnippet: typeof snippet === "string" ? snippet : "",
    category: typeof category === "string" ? category : "other",
    intent,
    customNote: typeof customNote === "string" ? customNote : undefined,
  };

  const draft = buildReplyDraft(input);

  const lines = [
    "## Email Reply Draft",
    "",
    `**To:** ${draft.to}`,
    `**Subject:** ${draft.subject}`,
    `**Intent:** ${draft.intent}`,
    `**Status:** ${draft.status}`,
    "",
    "### Body",
    "",
    draft.body,
    "",
    "---",
    `_Created: ${draft.createdAt}_`,
  ];

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

// --- Start server ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[golems-email] MCP server running on stdio");
}

main().catch((err) => {
  console.error("[golems-email] Fatal:", err);
  process.exit(1);
});
