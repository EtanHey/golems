import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { DocumentType, DocumentTypeLabel } from "../green-invoice/types";
import { resetTokenCache, resolveOpReference } from "../green-invoice/api";

describe("Green Invoice Types", () => {
  it("has correct document type values", () => {
    expect(DocumentType.RECEIPT).toBe(400);
    expect(DocumentType.TAX_INVOICE_RECEIPT).toBe(320);
    expect(DocumentType.TAX_INVOICE).toBe(305);
    expect(DocumentType.PRICE_QUOTE).toBe(10);
    expect(DocumentType.REFUND).toBe(330);
  });

  it("has labels for all document types", () => {
    for (const [, value] of Object.entries(DocumentType)) {
      expect(DocumentTypeLabel[value]).toBeDefined();
      expect(typeof DocumentTypeLabel[value]).toBe("string");
    }
  });

  it("receipt label says Kabala", () => {
    expect(DocumentTypeLabel[400]).toContain("Kabala");
  });

  it("covers all 13 document types", () => {
    expect(Object.keys(DocumentType)).toHaveLength(13);
    expect(Object.keys(DocumentTypeLabel)).toHaveLength(13);
  });
});

describe("Green Invoice API", () => {
  beforeEach(() => {
    // Clear env and token cache for test isolation
    delete process.env.GREEN_INVOICE_ID;
    delete process.env.GREEN_INVOICE_SECRET;
    delete process.env.GREEN_INVOICE_SANDBOX;
    resetTokenCache();
  });

  it("throws on missing credentials", async () => {
    const { createDocument } = await import("../green-invoice/api");
    await expect(
      createDocument({
        type: DocumentType.RECEIPT,
        client: { name: "Test" },
        income: [{ description: "Test", quantity: 1, price: 100 }],
      }),
    ).rejects.toThrow("Missing GREEN_INVOICE_ID");
  });

  it("uses sandbox URL when configured", async () => {
    process.env.GREEN_INVOICE_SANDBOX = "true";
    process.env.GREEN_INVOICE_ID = "test-id";
    process.env.GREEN_INVOICE_SECRET = "test-secret";

    let capturedUrl = "";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      capturedUrl = typeof url === "string" ? url : url.toString();
      return new Response(JSON.stringify({ error: "test" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const { createDocument } = await import("../green-invoice/api");
      await createDocument({
        type: DocumentType.RECEIPT,
        client: { name: "Test" },
        income: [{ description: "Test", quantity: 1, price: 100 }],
      }).catch(() => {});
      expect(capturedUrl).toContain("sandbox.d.greeninvoice.co.il");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("retries on 401 with fresh token", async () => {
    process.env.GREEN_INVOICE_ID = "test-id";
    process.env.GREEN_INVOICE_SECRET = "test-secret";

    let callCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      callCount++;
      const urlStr = typeof url === "string" ? url : url.toString();
      // Auth endpoint — return token
      if (urlStr.includes("/account/token")) {
        return new Response("", {
          status: 200,
          headers: { "X-Authorization-Bearer": `token-${callCount}` },
        });
      }
      // First API call returns 401, second succeeds
      if (callCount <= 3) {
        return new Response("Unauthorized", { status: 401 });
      }
      return new Response(JSON.stringify({ id: "doc-123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const { getDocument } = await import("../green-invoice/api");
      const result = await getDocument("test-doc");
      expect(result).toEqual({ id: "doc-123" });
      // Should have called: token, doc(401), token(retry), doc(success) = 4 calls
      expect(callCount).toBe(4);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("Green Invoice — 1Password op:// resolution", () => {
  it("returns plain values unchanged", async () => {
    const result = await resolveOpReference("my-plain-api-key");
    expect(result).toBe("my-plain-api-key");
  });

  it("returns empty string unchanged", async () => {
    const result = await resolveOpReference("");
    expect(result).toBe("");
  });

  it("does not invoke op for non-op:// values", async () => {
    const originalSpawn = Bun.spawn;
    let spawnCalled = false;
    Bun.spawn = ((...args: unknown[]) => {
      spawnCalled = true;
      return originalSpawn(args[0] as any);
    }) as typeof Bun.spawn;

    try {
      const result = await resolveOpReference("just-a-secret-key-123");
      expect(result).toBe("just-a-secret-key-123");
      expect(spawnCalled).toBe(false);
    } finally {
      Bun.spawn = originalSpawn;
    }
  });

  it("rejects op:// references when op CLI fails", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = ((args: string[]) => {
      if (args[0] === "op" && args[1] === "read") {
        const stderrData = new TextEncoder().encode(
          "connect to 1Password failed\n",
        );
        return {
          exited: Promise.resolve(1),
          stdout: new ReadableStream(),
          stderr: new ReadableStream({
            start(controller) {
              controller.enqueue(stderrData);
              controller.close();
            },
          }),
        };
      }
      return originalSpawn(args as any);
    }) as typeof Bun.spawn;

    try {
      await expect(
        resolveOpReference("op://development/green-invoice/id"),
      ).rejects.toThrow("Failed to resolve 1Password reference");
    } finally {
      Bun.spawn = originalSpawn;
    }
  });

  it("resolves op:// references when op CLI succeeds", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = ((args: string[]) => {
      if (args[0] === "op" && args[1] === "read") {
        const stdoutData = new TextEncoder().encode("resolved-secret-value\n");
        return {
          exited: Promise.resolve(0),
          stdout: new ReadableStream({
            start(controller) {
              controller.enqueue(stdoutData);
              controller.close();
            },
          }),
          stderr: new ReadableStream(),
        };
      }
      return originalSpawn(args as any);
    }) as typeof Bun.spawn;

    try {
      const result = await resolveOpReference(
        "op://development/green-invoice/id",
      );
      expect(result).toBe("resolved-secret-value");
    } finally {
      Bun.spawn = originalSpawn;
    }
  });
});

describe("Green Invoice — Hebrew kabala receipt (mocked)", () => {
  let originalFetch: typeof globalThis.fetch;
  let capturedRequests: Array<{ url: string; body: unknown }>;

  beforeEach(() => {
    resetTokenCache();
    capturedRequests = [];
    process.env.GREEN_INVOICE_ID = "test-id";
    process.env.GREEN_INVOICE_SECRET = "test-secret";

    originalFetch = globalThis.fetch;
    globalThis.fetch = mock(
      async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : url.toString();

        if (urlStr.includes("/account/token")) {
          return new Response("", {
            status: 200,
            headers: { "X-Authorization-Bearer": "mock-jwt-token" },
          });
        }

        if (urlStr.includes("/documents") && init?.method === "POST") {
          const body = init.body ? JSON.parse(init.body as string) : {};
          capturedRequests.push({ url: urlStr, body });
          return new Response(
            JSON.stringify({
              id: "doc-he-001",
              number: "R-2026-042",
              url: "https://app.greeninvoice.co.il/doc/he001",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        return new Response("Not found", { status: 404 });
      },
    ) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.GREEN_INVOICE_ID;
    delete process.env.GREEN_INVOICE_SECRET;
  });

  it("creates a kabala with Hebrew client name and description", async () => {
    const { createDocument } = await import("../green-invoice/api");

    const result = await createDocument({
      type: DocumentType.RECEIPT,
      client: {
        name: "\u05D0\u05DC\u05D5\u05DF \u05DC\u05D5\u05D9",
        email: "alon@example.com",
        add: true,
      },
      currency: "ILS",
      lang: "he",
      signed: true,
      rounding: false,
      income: [
        {
          description:
            "\u05E9\u05E2\u05D5\u05EA \u05D9\u05D9\u05E2\u05D5\u05E5 - \u05DE\u05E8\u05E5 2026",
          quantity: 10,
          price: 160,
          currency: "ILS",
          vatType: 2,
        },
      ],
      payment: [
        {
          type: 4,
          price: 1600,
          currency: "ILS",
          date: "2026-03-27",
        },
      ],
    });

    expect(result).toEqual({
      id: "doc-he-001",
      number: "R-2026-042",
      url: "https://app.greeninvoice.co.il/doc/he001",
    });

    expect(capturedRequests).toHaveLength(1);
    const sent = capturedRequests[0].body as Record<string, unknown>;

    expect(sent.lang).toBe("he");
    expect(sent.type).toBe(400);
    expect(sent.currency).toBe("ILS");

    const client = sent.client as Record<string, unknown>;
    expect(client.name).toBe("\u05D0\u05DC\u05D5\u05DF \u05DC\u05D5\u05D9");
    expect(client.email).toBe("alon@example.com");

    const income = (sent.income as Array<Record<string, unknown>>)[0];
    expect(income.description).toBe(
      "\u05E9\u05E2\u05D5\u05EA \u05D9\u05D9\u05E2\u05D5\u05E5 - \u05DE\u05E8\u05E5 2026",
    );
    expect(income.quantity).toBe(10);
    expect(income.price).toBe(160);
    expect(income.vatType).toBe(2);

    const payment = (sent.payment as Array<Record<string, unknown>>)[0];
    expect(payment.type).toBe(4);
    expect(payment.price).toBe(1600);
  });

  it("preserves Hebrew characters in round-trip through JSON serialization", async () => {
    const hebrewName = "\u05D0\u05DC\u05D5\u05DF \u05DC\u05D5\u05D9";
    const hebrewDesc =
      "\u05E4\u05D9\u05EA\u05D5\u05D7 \u05D0\u05E4\u05DC\u05D9\u05E7\u05E6\u05D9\u05D9\u05EA TaskOwl";

    const { createDocument } = await import("../green-invoice/api");

    await createDocument({
      type: DocumentType.RECEIPT,
      client: { name: hebrewName, add: true },
      income: [{ description: hebrewDesc, quantity: 1, price: 500 }],
      payment: [{ type: 1, price: 500, date: "2026-03-27" }],
    });

    const sent = capturedRequests[0].body as Record<string, unknown>;
    const client = sent.client as Record<string, unknown>;
    const income = (sent.income as Array<Record<string, unknown>>)[0];

    expect(client.name).toBe(hebrewName);
    expect(income.description).toBe(hebrewDesc);
  });
});
