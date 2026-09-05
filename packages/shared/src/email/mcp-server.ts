/**
 * EmailGolem MCP Server
 *
 * Exposes email data as MCP tools for Claude Code.
 * Tools: getRecent, search, subscriptions, urgent, stats
 *
 * Usage in .mcp.json:
 * {
 *   "golems-email": {
 *     "command": "bun",
 *     "args": ["run", "packages/autonomous/src/email-golem/mcp-server.ts"]
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
import {
  createDbClient,
  getRecentEmails,
  getSubscriptionSummary,
  getUnnotifiedUrgentEmails,
  getEmailsByGolem,
  getEmailById,
} from "./db-client";
import { buildReplyDraft, type ReplyDraftInput } from "./draft-reply";
import {
  getSenders,
  setSenderAction,
  attemptUnsubscribe,
} from "./sender-tracker";
import type { Email } from "./types";

// Lazy-imported at call time to break shared↔teller circular dependency
async function getTellerReport() {
  return import("@golems/teller/report");
}

const server = new Server(
  { name: "golems-email", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

// Lazy DB client (only connect when first tool is called)
let db: ReturnType<typeof createDbClient> | null = null;
function getDb() {
  if (!db) {
    db = createDbClient();
  }
  return db;
}

// --- Tool definitions ---

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "email_getRecent",
      description:
        "Get recent emails from the last N hours, optionally filtered by minimum score. Returns subject, sender, score, category, and time.",
      inputSchema: {
        type: "object" as const,
        properties: {
          hours: {
            type: "number",
            description: "How many hours back to look (default: 24)",
            default: 24,
          },
          minScore: {
            type: "number",
            description:
              "Minimum score to include (default: 0). Use 5 for notable, 7 for important, 10 for urgent.",
            default: 0,
          },
        },
      },
    },
    {
      name: "email_search",
      description:
        "Search emails by keyword in subject or sender address. Returns matching emails with scores.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Search term to match in subject or sender",
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
      name: "email_subscriptions",
      description:
        "Get subscription summary: monthly total spend, active services, new/cancelled this month.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "email_urgent",
      description:
        "Get urgent emails (score 10) that haven't been notified yet. These need immediate attention.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "email_stats",
      description:
        "Quick email stats: total in last 24h, urgent count, category breakdown.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "email_getByGolem",
      description:
        "Get emails routed to a specific golem. Golems: recruitergolem (job/interview), tellergolem (subscription), claudegolem (tech-update/urgent), emailgolem (newsletter/promo/social/other).",
      inputSchema: {
        type: "object" as const,
        properties: {
          golem: {
            type: "string",
            description:
              "Target golem: recruitergolem, tellergolem, claudegolem, emailgolem",
            enum: [
              "recruitergolem",
              "tellergolem",
              "claudegolem",
              "emailgolem",
            ],
          },
          hours: {
            type: "number",
            description: "How many hours back to look (default: 24)",
            default: 24,
          },
        },
        required: ["golem"],
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
    {
      name: "email_getSenders",
      description:
        "Get email senders aggregated with counts, avg score, and unsubscribe status. Filter by category (promo/newsletter/normal/job/tech) or user action (keep/unsubscribe/block).",
      inputSchema: {
        type: "object" as const,
        properties: {
          category: {
            type: "string",
            description:
              "Filter by sender category: promo, newsletter, normal, job, tech",
            enum: ["promo", "newsletter", "normal", "job", "tech"],
          },
          userAction: {
            type: "string",
            description:
              "Filter by user action: keep, unsubscribe, block. Use 'pending' for senders with no action set.",
          },
          limit: {
            type: "number",
            description: "Max results (default: 50)",
            default: 50,
          },
        },
      },
    },
    {
      name: "email_setSenderAction",
      description:
        "Set action for an email sender: keep (want these emails), unsubscribe (stop receiving), block (unwanted spam). Can pass emailId instead of emailAddress to look up the sender.",
      inputSchema: {
        type: "object" as const,
        properties: {
          emailAddress: {
            type: "string",
            description: "Sender's email address (provide this OR emailId)",
          },
          emailId: {
            type: "string",
            description:
              "Email ID to look up sender from (alternative to emailAddress)",
          },
          action: {
            type: "string",
            description: "Action to take: keep, unsubscribe, block",
            enum: ["keep", "unsubscribe", "block"],
          },
        },
        required: ["action"],
      },
    },
    {
      name: "email_unsubscribe",
      description:
        "Attempt to unsubscribe from a sender using their List-Unsubscribe header. Tries HTTP POST first (RFC 8058), then GET. Returns method used and success status.",
      inputSchema: {
        type: "object" as const,
        properties: {
          emailAddress: {
            type: "string",
            description: "Sender's email address to unsubscribe from",
          },
        },
        required: ["emailAddress"],
      },
    },
    {
      name: "email_sendersByCategory",
      description:
        "Get all senders grouped by category (promo, newsletter, normal, job, tech) with counts and avg scores. Great for overview of email sources.",
      inputSchema: {
        type: "object" as const,
        properties: {
          limit: {
            type: "number",
            description: "Max senders per category (default: 10)",
            default: 10,
          },
        },
      },
    },
    {
      name: "email_unsubscribeHistory",
      description:
        "Get history of unsubscribe attempts with success/fail status, method used, and timestamps.",
      inputSchema: {
        type: "object" as const,
        properties: {
          limit: {
            type: "number",
            description: "Max results (default: 50)",
            default: 50,
          },
        },
      },
    },
    {
      name: "teller_monthlyReport",
      description:
        "Generate monthly spending report. Returns total spend, breakdown by category and vendor, and subscription count.",
      inputSchema: {
        type: "object" as const,
        properties: {
          month: {
            type: "string",
            description: "Month in YYYY-MM format (default: current month)",
            default: new Date().toISOString().slice(0, 7),
          },
        },
      },
    },
    {
      name: "teller_taxSummary",
      description:
        "Generate annual tax report. Returns deductible totals by IRS Schedule C category with line items.",
      inputSchema: {
        type: "object" as const,
        properties: {
          year: {
            type: "number",
            description: "Tax year (default: current year)",
            default: new Date().getFullYear(),
          },
        },
      },
    },
  ],
}));

// --- Tool handlers ---

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "email_getRecent":
        return handleGetRecent(args);
      case "email_search":
        return handleSearch(args);
      case "email_subscriptions":
        return handleSubscriptions();
      case "email_urgent":
        return handleUrgent();
      case "email_stats":
        return handleStats();
      case "email_getByGolem":
        return handleGetByGolem(args);
      case "email_draftReply":
        return handleDraftReply(args);
      case "email_getSenders":
        return handleGetSenders(args);
      case "email_setSenderAction":
        return handleSetSenderAction(args);
      case "email_unsubscribe":
        return handleUnsubscribe(args);
      case "email_sendersByCategory":
        return handleSendersByCategory(args);
      case "email_unsubscribeHistory":
        return handleUnsubscribeHistory(args);
      case "teller_monthlyReport":
        return handleMonthlyReport(args);
      case "teller_taxSummary":
        return handleTaxSummary(args);
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

function formatEmail(e: Email): string {
  const score = e.score ?? "?";
  const cat = e.category ?? "unknown";
  const date = e.received_at
    ? new Date(e.received_at).toLocaleString()
    : "unknown";
  return `- [${score}/10 ${cat}] **${e.subject || "(no subject)"}** from ${e.from_address || "unknown"} (${date})`;
}

type McpArgs = Record<string, unknown> | undefined;

async function handleGetRecent(args: McpArgs) {
  const hours = args?.hours ?? 24;
  const minScore = args?.minScore ?? 0;
  const emails = await getRecentEmails(getDb(), hours, minScore);

  if (emails.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: `No emails found in the last ${hours}h with score >= ${minScore}.`,
        },
      ],
    };
  }

  const lines = [
    `## Recent Emails (last ${hours}h, score >= ${minScore})`,
    `**${emails.length} emails found**\n`,
    ...emails.map(formatEmail),
  ];

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

async function handleSearch(args: McpArgs) {
  const query = args?.query?.toLowerCase();
  const limit = args?.limit ?? 20;

  if (!query) {
    return {
      content: [{ type: "text" as const, text: "Missing required: query" }],
      isError: true,
    };
  }

  // Get last 7 days of emails and filter client-side
  // (Supabase free tier doesn't support full-text search)
  const emails = await getRecentEmails(getDb(), 7 * 24, 0);
  const matches = emails
    .filter(
      (e) =>
        e.subject?.toLowerCase().includes(query) ||
        e.from_address?.toLowerCase().includes(query),
    )
    .slice(0, limit);

  if (matches.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: `No emails matching "${args.query}" in the last 7 days.`,
        },
      ],
    };
  }

  const lines = [
    `## Email Search: "${args.query}"`,
    `**${matches.length} matches**\n`,
    ...matches.map(formatEmail),
  ];

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

async function handleSubscriptions() {
  const summary = await getSubscriptionSummary(getDb());

  const lines = [
    "## Subscription Summary",
    `**Monthly total: $${summary.totalMonthly.toFixed(2)}**\n`,
    "### Active Services",
    ...summary.services.map(
      (s) => `- ${s.name}: ${s.currency} ${s.amount} (${s.status})`,
    ),
  ];

  if (summary.newThisMonth.length > 0) {
    lines.push("\n### New This Month");
    lines.push(...summary.newThisMonth.map((s) => `- ${s}`));
  }

  if (summary.cancelledThisMonth.length > 0) {
    lines.push("\n### Cancelled This Month");
    lines.push(...summary.cancelledThisMonth.map((s) => `- ${s}`));
  }

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

async function handleUrgent() {
  const urgent = await getUnnotifiedUrgentEmails(getDb());

  if (urgent.length === 0) {
    return {
      content: [
        { type: "text" as const, text: "No unnotified urgent emails." },
      ],
    };
  }

  const lines = [
    `## Urgent Emails (${urgent.length} unnotified)`,
    "",
    ...urgent.map(formatEmail),
  ];

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

async function handleStats() {
  const last24h = await getRecentEmails(getDb(), 24, 0);
  const urgent = last24h.filter((e) => (e.score ?? 0) >= 10);
  const important = last24h.filter(
    (e) => (e.score ?? 0) >= 7 && (e.score ?? 0) < 10,
  );

  // Category breakdown
  const categories: Record<string, number> = {};
  for (const e of last24h) {
    const cat = e.category || "unknown";
    categories[cat] = (categories[cat] || 0) + 1;
  }

  const lines = [
    "## Email Stats (last 24h)",
    `- **Total:** ${last24h.length}`,
    `- **Urgent (10):** ${urgent.length}`,
    `- **Important (7-9):** ${important.length}`,
    "",
    "### Categories",
    ...Object.entries(categories)
      .sort(([, a], [, b]) => b - a)
      .map(([cat, count]) => `- ${cat}: ${count}`),
  ];

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

async function handleDraftReply(args: McpArgs) {
  const { subject, from, snippet, category, intent, customNote } = args || {};

  if (!subject || !from || !intent) {
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
    originalSnippet: snippet || "",
    category: category || "other",
    intent,
    customNote,
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

async function handleGetByGolem(args: McpArgs) {
  const golem = args?.golem;
  const hours = args?.hours ?? 24;

  if (!golem) {
    return {
      content: [{ type: "text" as const, text: "Missing required: golem" }],
      isError: true,
    };
  }

  const emails = await getEmailsByGolem(getDb(), golem, hours);

  if (emails.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: `No emails routed to ${golem} in the last ${hours}h.`,
        },
      ],
    };
  }

  const golemNames: Record<string, string> = {
    recruitergolem: "RecruiterGolem",
    tellergolem: "TellerGolem",
    claudegolem: "ClaudeGolem",
    emailgolem: "EmailGolem",
  };

  const lines = [
    `## Emails for ${golemNames[golem] || golem} (last ${hours}h)`,
    `**${emails.length} emails**\n`,
    ...emails.map(formatEmail),
  ];

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

async function handleGetSenders(args: McpArgs) {
  const category = args?.category;
  const userAction = args?.userAction === "pending" ? null : args?.userAction;
  const limit = args?.limit ?? 50;

  const senders = await getSenders(getDb(), { category, userAction, limit });

  if (senders.length === 0) {
    return {
      content: [
        { type: "text" as const, text: "No senders found matching filters." },
      ],
    };
  }

  const lines = [
    `## Email Senders${category ? ` (${category})` : ""}`,
    `**${senders.length} senders**\n`,
    ...senders.map((s: Record<string, unknown>) => {
      const action = s.user_action ? ` [${s.user_action}]` : "";
      const unsub = s.unsubscribe_url ? " (has unsub link)" : "";
      return `- **${s.email_address}** — ${s.total_emails} emails, avg ${s.avg_score}/10 (${s.category})${action}${unsub}`;
    }),
  ];

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

async function handleSetSenderAction(args: McpArgs) {
  let { emailAddress, emailId, action } = args || {};

  const validActions = ["keep", "unsubscribe", "block"];

  if (!action) {
    return {
      content: [{ type: "text" as const, text: "Missing required: action" }],
      isError: true,
    };
  }

  if (!validActions.includes(action)) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Invalid action "${action}". Must be one of: ${validActions.join(", ")}`,
        },
      ],
      isError: true,
    };
  }

  // If emailId provided, look up sender from that email
  if (!emailAddress && emailId) {
    const email = await getEmailById(getDb(), emailId);
    if (!email) {
      return {
        content: [
          { type: "text" as const, text: `Email not found: ${emailId}` },
        ],
        isError: true,
      };
    }
    emailAddress = email.from_address;
  }

  if (!emailAddress) {
    return {
      content: [
        {
          type: "text" as const,
          text: "Missing required: emailAddress or emailId",
        },
      ],
      isError: true,
    };
  }

  const success = await setSenderAction(getDb(), emailAddress, action);

  return {
    content: [
      {
        type: "text" as const,
        text: success
          ? `Set ${emailAddress} to "${action}"`
          : `Failed to update ${emailAddress}`,
      },
    ],
    ...(!success && { isError: true }),
  };
}

async function handleUnsubscribe(args: McpArgs) {
  const { emailAddress } = args || {};

  if (!emailAddress) {
    return {
      content: [
        { type: "text" as const, text: "Missing required: emailAddress" },
      ],
      isError: true,
    };
  }

  const result = await attemptUnsubscribe(getDb(), emailAddress);

  const lines = [
    `## Unsubscribe: ${emailAddress}`,
    `- **Success:** ${result.success}`,
    `- **Method:** ${result.method}`,
  ];
  if (result.error) {
    lines.push(`- **Note:** ${result.error}`);
  }

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

async function handleSendersByCategory(args: McpArgs) {
  const limit = args?.limit ?? 10;
  const categories = ["promo", "newsletter", "normal", "job", "tech"];
  const sections: string[] = ["## Senders by Category\n"];

  for (const cat of categories) {
    const senders = await getSenders(getDb(), { category: cat, limit });
    if (senders.length === 0) continue;

    sections.push(
      `### ${cat.charAt(0).toUpperCase() + cat.slice(1)} (${senders.length})`,
    );
    for (const s of senders) {
      const action = s.user_action ? ` [${s.user_action}]` : "";
      sections.push(
        `- **${s.display_name || s.email_address}** — ${s.total_emails} emails, avg ${s.avg_score}/10${action}`,
      );
    }
    sections.push("");
  }

  return { content: [{ type: "text" as const, text: sections.join("\n") }] };
}

async function handleUnsubscribeHistory(args: McpArgs) {
  const limit = args?.limit ?? 50;

  // Query golem_events table for unsubscribe attempts
  const db = getDb();
  const { data, error } = await db
    .from("golem_events")
    .select("*")
    .eq("type", "email_unsubscribe_attempt")
    .order("timestamp", { ascending: false })
    .limit(limit);

  if (error || !data || data.length === 0) {
    return {
      content: [
        { type: "text" as const, text: "No unsubscribe history found." },
      ],
    };
  }

  const lines = [
    `## Unsubscribe History (${data.length} attempts)\n`,
    ...data.map((e: Record<string, unknown>) => {
      const d = (e.data as Record<string, unknown>) || {};
      const status = d.success ? "OK" : "FAIL";
      const filter = d.gmail_filter ? " +filter" : "";
      const ts = e.timestamp
        ? new Date(e.timestamp as string).toLocaleString()
        : "unknown";
      return `- [${status}] ${d.sender || "unknown"} via ${d.method || "?"}${filter} — ${ts}${d.error ? ` (${d.error})` : ""}`;
    }),
  ];

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

/**
 * Generate and format a monthly spending report.
 * @param args - Optional month parameter in YYYY-MM format (defaults to current month)
 */
async function handleMonthlyReport(args: Record<string, unknown> | undefined) {
  const month = (args?.month as string) ?? new Date().toISOString().slice(0, 7);

  const { generateMonthlyReport, formatMonthlyReportText } =
    await getTellerReport();
  const report = await generateMonthlyReport(month);
  const formatted = formatMonthlyReportText(report);

  return { content: [{ type: "text" as const, text: formatted }] };
}

/**
 * Generate and format an annual tax report.
 * @param args - Optional year parameter (defaults to current year)
 */
async function handleTaxSummary(args: Record<string, unknown> | undefined) {
  const year = (args?.year as number) ?? new Date().getFullYear();

  const { generateTaxReport, formatTaxReportText } = await getTellerReport();
  const report = await generateTaxReport(year);
  const formatted = formatTaxReportText(report);

  return { content: [{ type: "text" as const, text: formatted }] };
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
