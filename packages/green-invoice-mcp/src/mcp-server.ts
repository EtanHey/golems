#!/usr/bin/env bun
/**
 * Green Invoice MCP Server
 *
 * Exposes Green Invoice REST API as MCP tools for Claude Code.
 * Tools: invoice_create, invoice_list, receipt_create, client_search, client_create
 *
 * ENV: GREEN_INVOICE_ID, GREEN_INVOICE_SECRET
 * Optional: GREEN_INVOICE_SANDBOX=true
 *
 * Usage in .mcp.json:
 * {
 *   "green-invoice": {
 *     "command": "bun",
 *     "args": ["run", "packages/green-invoice-mcp/src/mcp-server.ts"]
 *   }
 * }
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  createDocument,
  getDocument,
  searchDocuments,
  getDocumentDownloadLink,
  searchClients,
  createClient,
} from "./api";
import { DocumentType, DocumentTypeLabel, PaymentType } from "./types";

export const server = new Server(
  { name: "green-invoice", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

// --- Tool definitions ---

export const TOOL_DEFINITIONS = [
  {
    name: "invoice_create",
    description:
      "Create any document type in Green Invoice. Types: 10=quote, 100=order, 305=tax invoice, 320=tax invoice-receipt, 400=receipt/kabala, 330=refund. For simple receipts use receipt_create instead.",
    inputSchema: {
      type: "object" as const,
      properties: {
        type: {
          type: "number",
          description:
            "Document type: 10=quote, 100=order, 305=tax invoice, 320=tax invoice-receipt, 400=receipt, 330=refund",
        },
        clientName: {
          type: "string",
          description: "Client name (Hebrew supported, e.g. אלון לוי)",
        },
        clientId: {
          type: "string",
          description: "Green Invoice client ID (use instead of name if known)",
        },
        clientEmail: {
          type: "string",
          description: "Client email (optional)",
        },
        clientTaxId: {
          type: "string",
          description: "Client tax ID / ע.מ. (optional, for businesses)",
        },
        items: {
          type: "array",
          description:
            "Line items: [{description, quantity, price, vatType?, currency?}]",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              quantity: { type: "number" },
              price: { type: "number" },
              vatType: { type: "number" },
              currency: { type: "string" },
            },
            required: ["description", "quantity", "price"],
          },
        },
        payment: {
          type: "array",
          description:
            "Payment items: [{type, price, currency?, date?}]. type: 1=cash, 2=check, 3=cc, 4=transfer, 5=paypal",
          items: {
            type: "object",
            properties: {
              type: { type: "number" },
              price: { type: "number" },
              currency: { type: "string" },
              date: { type: "string" },
            },
            required: ["type", "price"],
          },
        },
        currency: {
          type: "string",
          description: "Currency code (default: ILS)",
        },
        lang: {
          type: "string",
          description: "Language: he=Hebrew, en=English (default: he)",
        },
        description: {
          type: "string",
          description: "Document-level description/remarks",
        },
      },
      required: ["type", "items"],
    },
  },
  {
    name: "invoice_list",
    description:
      "Search/list documents in Green Invoice. Filter by type, date range, status. Returns paginated results with summaries.",
    inputSchema: {
      type: "object" as const,
      properties: {
        type: {
          type: "number",
          description:
            "Filter by document type (e.g. 400 for receipts). Omit for all types.",
        },
        fromDate: {
          type: "string",
          description: "Start date filter (YYYY-MM-DD)",
        },
        toDate: {
          type: "string",
          description: "End date filter (YYYY-MM-DD)",
        },
        page: {
          type: "number",
          description: "Page number (default: 0)",
        },
        pageSize: {
          type: "number",
          description: "Results per page (default: 25, max: 50)",
        },
      },
    },
  },
  {
    name: "receipt_create",
    description:
      "Create a receipt (kabala/קבלה, type 400) in Green Invoice. Convenience wrapper for freelance work — use after receiving payment. Currency defaults to ILS, language to Hebrew, VAT exempt (osek patur).",
    inputSchema: {
      type: "object" as const,
      properties: {
        clientName: {
          type: "string",
          description: "Client name (Hebrew supported, e.g. אלון לוי)",
        },
        clientEmail: {
          type: "string",
          description: "Client email address (optional)",
        },
        clientTaxId: {
          type: "string",
          description: "Client tax ID / ע.מ. (optional, for businesses)",
        },
        description: {
          type: "string",
          description: "Line item description (e.g. שעות ייעוץ - מרץ 2026)",
        },
        amount: {
          type: "number",
          description: "Unit price in ILS. Multiplied by quantity for total.",
        },
        quantity: {
          type: "number",
          description: "Quantity (default: 1)",
        },
        paymentMethod: {
          type: "number",
          description:
            "Payment method: 1=cash, 2=check, 3=credit card, 4=bank transfer, 5=paypal, 10=payment app, 11=other (default: 4)",
        },
        currency: {
          type: "string",
          description: "Currency code (default: ILS)",
        },
        vatType: {
          type: "number",
          description:
            "VAT type: 0=default, 1=VAT included, 2=exempt (default: 2 for osek patur)",
        },
      },
      required: ["clientName", "description", "amount"],
    },
  },
  {
    name: "client_search",
    description:
      "Search clients in Green Invoice by name, email, or tax ID. Supports Hebrew names.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description:
            "Search query — matches against client name (supports Hebrew)",
        },
        email: {
          type: "string",
          description: "Search by email",
        },
        taxId: {
          type: "string",
          description: "Search by tax ID",
        },
        page: {
          type: "number",
          description: "Page number (default: 0)",
        },
        pageSize: {
          type: "number",
          description: "Results per page (default: 25)",
        },
      },
    },
  },
  {
    name: "client_create",
    description:
      "Create a new client in Green Invoice. Supports Hebrew names and Israeli tax IDs.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Client name (Hebrew supported)",
        },
        email: {
          type: "string",
          description: "Client email address",
        },
        taxId: {
          type: "string",
          description: "Tax ID / ע.מ. / ח.פ.",
        },
        phone: {
          type: "string",
          description: "Phone number",
        },
        address: {
          type: "string",
          description: "Street address",
        },
        city: {
          type: "string",
          description: "City",
        },
        country: {
          type: "string",
          description: "Country code (default: IL)",
        },
      },
      required: ["name"],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_DEFINITIONS,
}));

// --- Tool handlers ---

type McpArgs = Record<string, unknown> | undefined;
type McpResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function textResult(text: string, isError = false): McpResult {
  return {
    content: [{ type: "text" as const, text }],
    ...(isError ? { isError: true } : {}),
  };
}

export async function handleInvoiceCreate(args: McpArgs): Promise<McpResult> {
  const type = args?.type as number;
  const items = args?.items as Array<Record<string, unknown>>;

  if (!type || !items?.length) {
    return textResult(
      "Missing required: type, items (at least one line item)",
      true,
    );
  }

  const validTypes = new Set(Object.values(DocumentType));
  if (!validTypes.has(type as any)) {
    return textResult(
      `Invalid document type: ${type}. Valid: ${Object.entries(DocumentType)
        .map(([k, v]) => `${v}=${k}`)
        .join(", ")}`,
      true,
    );
  }

  if (!args?.clientId && !args?.clientName) {
    return textResult("Missing client: provide clientId or clientName", true);
  }

  const client: Record<string, unknown> = {};
  if (args?.clientId) {
    client.id = args.clientId;
  } else if (args?.clientName) {
    client.name = args.clientName;
    client.add = true;
  }
  if (args?.clientEmail) client.email = args.clientEmail;
  if (args?.clientTaxId) client.taxId = args.clientTaxId;

  const result = await createDocument({
    type: type as number,
    client,
    currency: (args?.currency as string) ?? "ILS",
    lang: (args?.lang as string) ?? "he",
    description: args?.description as string,
    signed: true,
    rounding: false,
    income: items.map((item) => ({
      description: item.description as string,
      quantity: item.quantity as number,
      price: item.price as number,
      vatType: (item.vatType as number) ?? 0,
      currency: (item.currency as string) ?? "ILS",
    })),
    payment: args?.payment
      ? (args.payment as Array<Record<string, unknown>>).map((p) => ({
          type: p.type as number,
          price: p.price as number,
          currency: (p.currency as string) ?? "ILS",
          date:
            (p.date as string) ??
            new Date().toLocaleDateString("en-CA", {
              timeZone: "Asia/Jerusalem",
            }),
        }))
      : undefined,
  });

  const docId = result.id ?? "unknown";
  const docNum = result.number ?? "";
  const docUrl = result.url ?? "";
  const typeLabel = DocumentTypeLabel[type] ?? `Type ${type}`;

  const lines = [
    `## ${typeLabel} Created`,
    "",
    `- **Document ID:** ${docId}`,
    `- **Number:** ${docNum}`,
    `- **Type:** ${typeLabel} (${type})`,
    `- **Lines:** ${items.length}`,
    ...(docUrl ? [`- **URL:** ${docUrl}`] : []),
  ];

  return textResult(lines.join("\n"));
}

export async function handleInvoiceList(args: McpArgs): Promise<McpResult> {
  const result = await searchDocuments({
    type: args?.type as number | undefined,
    fromDate: args?.fromDate as string | undefined,
    toDate: args?.toDate as string | undefined,
    page: (args?.page as number) ?? 0,
    pageSize: (args?.pageSize as number) ?? 25,
  });

  const items = result.items as Array<Record<string, unknown>> | undefined;
  const total = result.total ?? 0;

  if (!items?.length) {
    return textResult("No documents found matching filters.");
  }

  const lines = [
    `## Documents (${items.length} of ${total})`,
    "",
    ...items.map((doc) => {
      const docType =
        DocumentTypeLabel[doc.type as number] ?? `Type ${doc.type}`;
      const amount = doc.amount ?? doc.totalAmount ?? "?";
      const currency = doc.currency ?? "ILS";
      const date = doc.documentDate ?? doc.createdAt ?? "";
      const client =
        (doc.client as Record<string, unknown>)?.name ?? "No client";
      return `- [${docType}] **#${doc.number}** | ${client} | ${currency} ${amount} | ${date} | ID: ${doc.id}`;
    }),
  ];

  return textResult(lines.join("\n"));
}

export async function handleReceiptCreate(args: McpArgs): Promise<McpResult> {
  const clientName = args?.clientName as string;
  const description = args?.description as string;
  const amount = args?.amount as number;

  if (!clientName || !description || amount == null) {
    return textResult(
      "Missing required: clientName, description, amount",
      true,
    );
  }

  const quantity = (args?.quantity as number) ?? 1;
  const paymentMethod =
    (args?.paymentMethod as number) ?? PaymentType.ELECTRONIC_FUND_TRANSFER;
  const currency = (args?.currency as string) ?? "ILS";
  const vatType = (args?.vatType as number) ?? 2; // exempt for osek patur
  const totalAmount = amount * quantity;

  const result = await createDocument({
    type: DocumentType.RECEIPT,
    client: {
      name: clientName,
      ...(args?.clientEmail ? { email: args.clientEmail as string } : {}),
      ...(args?.clientTaxId ? { taxId: args.clientTaxId as string } : {}),
      add: true,
    },
    currency,
    lang: "he",
    signed: true,
    rounding: false,
    income: [
      {
        description,
        quantity,
        price: amount,
        currency,
        vatType,
      },
    ],
    payment: [
      {
        type: paymentMethod,
        price: totalAmount,
        currency,
        date: new Date().toLocaleDateString("en-CA", {
          timeZone: "Asia/Jerusalem",
        }),
      },
    ],
  });

  const docId = result.id ?? "unknown";
  const docNum = result.number ?? "";
  const docUrl = result.url ?? "";

  const paymentLabel =
    {
      1: "Cash",
      2: "Check",
      3: "Credit Card",
      4: "Bank Transfer",
      5: "PayPal",
      10: "Payment App",
      11: "Other",
    }[paymentMethod] ?? `Type ${paymentMethod}`;

  const lines = [
    "## Receipt (Kabala) Created",
    "",
    `- **Document ID:** ${docId}`,
    `- **Number:** ${docNum}`,
    `- **Client:** ${clientName}`,
    `- **Amount:** ${currency} ${totalAmount.toFixed(2)}`,
    `- **Description:** ${description}`,
    `- **Payment:** ${paymentLabel}`,
    ...(docUrl ? [`- **URL:** ${docUrl}`] : []),
  ];

  return textResult(lines.join("\n"));
}

export async function handleClientSearch(args: McpArgs): Promise<McpResult> {
  const result = await searchClients({
    name: args?.query as string | undefined,
    email: args?.email as string | undefined,
    taxId: args?.taxId as string | undefined,
    page: (args?.page as number) ?? 0,
    pageSize: (args?.pageSize as number) ?? 25,
  });

  const items = result.items as Array<Record<string, unknown>> | undefined;
  const total = result.total ?? 0;

  if (!items?.length) {
    return textResult("No clients found matching search.");
  }

  const lines = [
    `## Clients (${items.length} of ${total})`,
    "",
    ...items.map((c) => {
      const email = c.email ? ` | ${c.email}` : "";
      const taxId = c.taxId ? ` | Tax: ${c.taxId}` : "";
      return `- **${c.name}**${email}${taxId} | ID: ${c.id}`;
    }),
  ];

  return textResult(lines.join("\n"));
}

export async function handleClientCreate(args: McpArgs): Promise<McpResult> {
  const name = args?.name as string;
  if (!name) {
    return textResult("Missing required: name", true);
  }

  const result = await createClient({
    name,
    email: args?.email as string | undefined,
    taxId: args?.taxId as string | undefined,
    phone: args?.phone as string | undefined,
    address: args?.address as string | undefined,
    city: args?.city as string | undefined,
    country: (args?.country as string) ?? "IL",
  });

  const lines = [
    `## Client Created`,
    "",
    `- **ID:** ${result.id}`,
    `- **Name:** ${name}`,
    ...(args?.email ? [`- **Email:** ${args.email}`] : []),
    ...(args?.taxId ? [`- **Tax ID:** ${args.taxId}`] : []),
    ...(args?.phone ? [`- **Phone:** ${args.phone}`] : []),
    ...(args?.address
      ? [`- **Address:** ${args.address}${args?.city ? `, ${args.city}` : ""}`]
      : []),
  ];

  return textResult(lines.join("\n"));
}

const HANDLERS: Record<string, (args: McpArgs) => Promise<McpResult>> = {
  invoice_create: handleInvoiceCreate,
  invoice_list: handleInvoiceList,
  receipt_create: handleReceiptCreate,
  client_search: handleClientSearch,
  client_create: handleClientCreate,
};

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const handler = HANDLERS[name];
  if (!handler) {
    return textResult(`Unknown tool: ${name}`, true);
  }

  try {
    return await handler(args);
  } catch (err: unknown) {
    return textResult(
      `Error in ${name}: ${err instanceof Error ? err.message : String(err)}`,
      true,
    );
  }
});

// --- Start server ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[green-invoice] MCP server running on stdio");
}

// Only start if run directly (not imported by tests)
if (import.meta.main) {
  main().catch((err) => {
    console.error("[green-invoice] Fatal:", err);
    process.exit(1);
  });
}
