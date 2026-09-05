/**
 * Green Invoice MCP Server
 *
 * Exposes Green Invoice REST API as MCP tools for Claude Code.
 * Tools: invoice_createKabala, invoice_createDocument, invoice_listDocuments,
 *        invoice_getDocument, invoice_getClient, invoice_searchClients
 *
 * ENV: GREEN_INVOICE_ID, GREEN_INVOICE_SECRET
 * Optional: GREEN_INVOICE_SANDBOX=true
 *
 * Usage in .mcp.json:
 * {
 *   "golems-invoice": {
 *     "command": "bun",
 *     "args": ["run", "packages/teller/src/green-invoice/mcp-server.ts"]
 *   }
 * }
 */

import "@golems/shared/lib/load-env";

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
  getClient,
  searchClients,
} from "./api";
import { DocumentType, DocumentTypeLabel } from "./types";

const server = new Server(
  { name: "golems-invoice", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

// --- Tool definitions ---

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "invoice_createKabala",
      description:
        "Create a receipt (kabala/קבלה, type 400) in Green Invoice. For freelance work, use this after receiving payment. Currency defaults to ILS, language to Hebrew.",
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
          unitPrice: {
            type: "number",
            description:
              "Price per unit in ILS (API multiplies by quantity). For a single item, this is the total.",
          },
          quantity: {
            type: "number",
            description: "Quantity (default: 1)",
            default: 1,
          },
          paymentType: {
            type: "number",
            description:
              "Payment method: 1=cash, 2=check, 3=credit card, 4=bank transfer, 5=paypal, 10=payment app, 11=other (default: 4)",
            default: 4,
          },
          currency: {
            type: "string",
            description: "Currency code (default: ILS)",
            default: "ILS",
          },
          vatType: {
            type: "number",
            description:
              "VAT type: 0=default, 1=VAT included, 2=exempt (default: 2 for osek patur)",
            default: 2,
          },
        },
        required: ["clientName", "description", "unitPrice"],
      },
    },
    {
      name: "invoice_createDocument",
      description:
        "Create any document type in Green Invoice. Types: 10=quote, 100=order, 305=tax invoice, 320=tax invoice-receipt, 400=receipt/kabala, 330=refund. For simple receipts use invoice_createKabala instead.",
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
            description: "Client name",
          },
          clientId: {
            type: "string",
            description:
              "Green Invoice client ID (use instead of name if known)",
          },
          clientEmail: {
            type: "string",
            description: "Client email (optional)",
          },
          clientTaxId: {
            type: "string",
            description: "Client tax ID (optional)",
          },
          income: {
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
            description: "Currency (default: ILS)",
            default: "ILS",
          },
          lang: {
            type: "string",
            description: "Language: he=Hebrew, en=English (default: he)",
            default: "he",
          },
          description: {
            type: "string",
            description: "Document-level description/remarks",
          },
        },
        required: ["type", "income"],
      },
    },
    {
      name: "invoice_listDocuments",
      description:
        "Search/list documents in Green Invoice. Filter by type, date range. Returns paginated results.",
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
            default: 0,
          },
          pageSize: {
            type: "number",
            description: "Results per page (default: 25, max: 50)",
            default: 25,
          },
        },
      },
    },
    {
      name: "invoice_getDocument",
      description:
        "Get a specific document by ID from Green Invoice. Returns full document details and download link.",
      inputSchema: {
        type: "object" as const,
        properties: {
          documentId: {
            type: "string",
            description: "Green Invoice document ID",
          },
        },
        required: ["documentId"],
      },
    },
    {
      name: "invoice_getClient",
      description: "Get a specific client by ID from Green Invoice.",
      inputSchema: {
        type: "object" as const,
        properties: {
          clientId: {
            type: "string",
            description: "Green Invoice client ID",
          },
        },
        required: ["clientId"],
      },
    },
    {
      name: "invoice_searchClients",
      description: "Search clients in Green Invoice by name, email, or tax ID.",
      inputSchema: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description: "Search by client name (supports Hebrew)",
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
            default: 0,
          },
          pageSize: {
            type: "number",
            description: "Results per page (default: 25)",
            default: 25,
          },
        },
      },
    },
  ],
}));

// --- Tool handlers ---

type McpArgs = Record<string, unknown> | undefined;

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "invoice_createKabala":
        return await handleCreateKabala(args);
      case "invoice_createDocument":
        return await handleCreateDocument(args);
      case "invoice_listDocuments":
        return await handleListDocuments(args);
      case "invoice_getDocument":
        return await handleGetDocument(args);
      case "invoice_getClient":
        return await handleGetClient(args);
      case "invoice_searchClients":
        return await handleSearchClients(args);
      default:
        return {
          content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
          isError: true,
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

async function handleCreateKabala(args: McpArgs) {
  const clientName = args?.clientName as string;
  const description = args?.description as string;
  const unitPrice = args?.unitPrice as number;

  if (!clientName || !description || unitPrice == null) {
    return {
      content: [
        {
          type: "text" as const,
          text: "Missing required: clientName, description, unitPrice",
        },
      ],
      isError: true,
    };
  }

  const quantity = (args?.quantity as number) ?? 1;
  const paymentType = (args?.paymentType as number) ?? 4; // bank transfer
  const currency = (args?.currency as string) ?? "ILS";
  const vatType = (args?.vatType as number) ?? 2; // exempt for osek patur
  const totalAmount = unitPrice * quantity;

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
        price: unitPrice,
        currency,
        vatType,
      },
    ],
    payment: [
      {
        type: paymentType,
        price: totalAmount,
        currency,
        date: new Date().toISOString().slice(0, 10),
      },
    ],
  });

  const docId = (result as Record<string, unknown>).id ?? "unknown";
  const docNum = (result as Record<string, unknown>).number ?? "";
  const docUrl = (result as Record<string, unknown>).url ?? "";

  const lines = [
    "## Receipt (Kabala) Created",
    "",
    `- **Document ID:** ${docId}`,
    `- **Number:** ${docNum}`,
    `- **Client:** ${clientName}`,
    `- **Amount:** ${currency} ${totalAmount.toFixed(2)}`,
    `- **Description:** ${description}`,
    `- **Payment:** ${paymentType === 4 ? "Bank Transfer" : `Type ${paymentType}`}`,
    ...(docUrl ? [`- **URL:** ${docUrl}`] : []),
  ];

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

async function handleCreateDocument(args: McpArgs) {
  const type = args?.type as number;
  const income = args?.income as Array<Record<string, unknown>>;

  if (!type || !income?.length) {
    return {
      content: [
        {
          type: "text" as const,
          text: "Missing required: type, income (at least one line item)",
        },
      ],
      isError: true,
    };
  }

  const validTypes = new Set(Object.values(DocumentType));
  if (!validTypes.has(type as any)) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Invalid document type: ${type}. Valid: ${Object.entries(
            DocumentType,
          )
            .map(([k, v]) => `${v}=${k}`)
            .join(", ")}`,
        },
      ],
      isError: true,
    };
  }

  if (!args?.clientId && !args?.clientName) {
    return {
      content: [
        {
          type: "text" as const,
          text: "Missing client: provide clientId or clientName",
        },
      ],
      isError: true,
    };
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
    income: income.map((item) => ({
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
          date: (p.date as string) ?? new Date().toISOString().slice(0, 10),
        }))
      : undefined,
  });

  const docId = (result as Record<string, unknown>).id ?? "unknown";
  const docNum = (result as Record<string, unknown>).number ?? "";
  const typeLabel = DocumentTypeLabel[type] ?? `Type ${type}`;

  const lines = [
    `## ${typeLabel} Created`,
    "",
    `- **Document ID:** ${docId}`,
    `- **Number:** ${docNum}`,
    `- **Type:** ${typeLabel} (${type})`,
    `- **Lines:** ${income.length}`,
  ];

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

async function handleListDocuments(args: McpArgs) {
  const result = await searchDocuments({
    type: args?.type as number | undefined,
    fromDate: args?.fromDate as string | undefined,
    toDate: args?.toDate as string | undefined,
    page: (args?.page as number) ?? 0,
    pageSize: (args?.pageSize as number) ?? 25,
  });

  const items = (result as Record<string, unknown>).items as
    | Array<Record<string, unknown>>
    | undefined;
  const total = (result as Record<string, unknown>).total ?? 0;

  if (!items?.length) {
    return {
      content: [
        { type: "text" as const, text: "No documents found matching filters." },
      ],
    };
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

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

async function handleGetDocument(args: McpArgs) {
  const documentId = args?.documentId as string;
  if (!documentId) {
    return {
      content: [
        { type: "text" as const, text: "Missing required: documentId" },
      ],
      isError: true,
    };
  }

  const [doc, links] = await Promise.all([
    getDocument(documentId),
    getDocumentDownloadLink(documentId).catch(() => null),
  ]);

  const docType =
    DocumentTypeLabel[(doc as Record<string, unknown>).type as number] ??
    `Type ${(doc as Record<string, unknown>).type}`;
  const client =
    ((doc as Record<string, unknown>).client as Record<string, unknown>)
      ?.name ?? "No client";

  const lines = [
    `## Document: ${docType} #${(doc as Record<string, unknown>).number}`,
    "",
    `- **ID:** ${(doc as Record<string, unknown>).id}`,
    `- **Type:** ${docType}`,
    `- **Client:** ${client}`,
    `- **Amount:** ${(doc as Record<string, unknown>).currency ?? "ILS"} ${(doc as Record<string, unknown>).amount ?? (doc as Record<string, unknown>).totalAmount ?? "?"}`,
    `- **Date:** ${(doc as Record<string, unknown>).documentDate ?? ""}`,
    `- **Status:** ${(doc as Record<string, unknown>).status ?? ""}`,
  ];

  if (links) {
    const linkItems = (links as Record<string, unknown>).items as
      | Array<Record<string, unknown>>
      | undefined;
    if (linkItems?.length) {
      lines.push(
        `- **Download:** ${(linkItems[0] as Record<string, unknown>).url ?? ""}`,
      );
    }
  }

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

async function handleGetClient(args: McpArgs) {
  const clientId = args?.clientId as string;
  if (!clientId) {
    return {
      content: [{ type: "text" as const, text: "Missing required: clientId" }],
      isError: true,
    };
  }

  const client = await getClient(clientId);
  const c = client as Record<string, unknown>;

  const lines = [
    `## Client: ${c.name}`,
    "",
    `- **ID:** ${c.id}`,
    `- **Name:** ${c.name}`,
    ...(c.taxId ? [`- **Tax ID:** ${c.taxId}`] : []),
    ...(c.email ? [`- **Email:** ${c.email}`] : []),
    ...(c.phone ? [`- **Phone:** ${c.phone}`] : []),
    ...(c.address ? [`- **Address:** ${c.address}, ${c.city ?? ""}`] : []),
  ];

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

async function handleSearchClients(args: McpArgs) {
  const result = await searchClients({
    name: args?.name as string | undefined,
    email: args?.email as string | undefined,
    taxId: args?.taxId as string | undefined,
    page: (args?.page as number) ?? 0,
    pageSize: (args?.pageSize as number) ?? 25,
  });

  const items = (result as Record<string, unknown>).items as
    | Array<Record<string, unknown>>
    | undefined;
  const total = (result as Record<string, unknown>).total ?? 0;

  if (!items?.length) {
    return {
      content: [
        { type: "text" as const, text: "No clients found matching search." },
      ],
    };
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

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

// --- Start server ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[golems-invoice] MCP server running on stdio");
}

main().catch((err) => {
  console.error("[golems-invoice] Fatal:", err);
  process.exit(1);
});
