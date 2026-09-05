import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import { resetTokenCache, _setSleep } from "../api";
import {
  handleInvoiceCreate,
  handleInvoiceList,
  handleReceiptCreate,
  handleClientSearch,
  handleClientCreate,
  TOOL_DEFINITIONS,
} from "../mcp-server";

// Standard mock API responses
const MOCK_DOC = {
  id: "doc-abc",
  number: "1001",
  url: "https://app.greeninvoice.co.il/doc/abc",
};
const MOCK_DOC_LIST = {
  items: [
    {
      id: "doc-1",
      number: "1001",
      type: 400,
      amount: 5000,
      currency: "ILS",
      documentDate: "2026-03-15",
      client: { name: "אלון לוי" },
    },
    {
      id: "doc-2",
      number: "1002",
      type: 305,
      amount: 12000,
      currency: "ILS",
      documentDate: "2026-03-20",
      client: { name: "Test Corp" },
    },
  ],
  total: 2,
};
const MOCK_CLIENT_LIST = {
  items: [
    {
      id: "client-1",
      name: "אלון לוי",
      email: "alon@example.com",
      taxId: "123456789",
    },
  ],
  total: 1,
};
const MOCK_CLIENT_CREATED = { id: "client-new", name: "דני כהן" };

let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | null =
  null;

/**
 * Mock fetch to return: token (first call) + API response (second call).
 * Each handler test goes through real auth → real API flow with mocked fetch.
 */
function mockApiCall(apiResponse: unknown) {
  let callIndex = 0;
  fetchSpy?.mockRestore();
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () => {
    callIndex++;
    if (callIndex === 1) {
      // Token request
      return new Response("{}", {
        status: 200,
        headers: { "X-Authorization-Bearer": "test-jwt" },
      });
    }
    // API call
    return new Response(JSON.stringify(apiResponse), { status: 200 });
  });
  return fetchSpy;
}

describe("MCP Server", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetTokenCache();
    _setSleep(async () => {});
    process.env.GREEN_INVOICE_ID = "test-id";
    process.env.GREEN_INVOICE_SECRET = "test-secret";
    delete process.env.GREEN_INVOICE_SANDBOX;
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    fetchSpy = null;
    process.env = { ...originalEnv };
  });

  // --- Tool Definitions ---

  describe("tool definitions", () => {
    it("exposes exactly 5 required tools", () => {
      const names = TOOL_DEFINITIONS.map((t) => t.name);
      expect(names).toContain("invoice_create");
      expect(names).toContain("invoice_list");
      expect(names).toContain("receipt_create");
      expect(names).toContain("client_search");
      expect(names).toContain("client_create");
      expect(names).toHaveLength(5);
    });

    it("all tools have inputSchema with type object", () => {
      for (const tool of TOOL_DEFINITIONS) {
        expect(tool.inputSchema.type).toBe("object");
      }
    });
  });

  // --- invoice_create ---

  describe("invoice_create", () => {
    it("creates a document with valid args", async () => {
      mockApiCall(MOCK_DOC);
      const result = await handleInvoiceCreate({
        type: 305,
        clientName: "Test Corp",
        items: [{ description: "Consulting", quantity: 10, price: 500 }],
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Tax Invoice Created");
      expect(result.content[0].text).toContain("doc-abc");
    });

    it("returns error when type is missing", async () => {
      const result = await handleInvoiceCreate({
        clientName: "Test",
        items: [{ description: "Item", quantity: 1, price: 100 }],
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Missing required");
    });

    it("returns error when items array is empty", async () => {
      const result = await handleInvoiceCreate({
        type: 305,
        clientName: "Test",
        items: [],
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Missing required");
    });

    it("returns error for invalid document type", async () => {
      const result = await handleInvoiceCreate({
        type: 999,
        clientName: "Test",
        items: [{ description: "Item", quantity: 1, price: 100 }],
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Invalid document type");
    });

    it("returns error when no client info provided", async () => {
      const result = await handleInvoiceCreate({
        type: 305,
        items: [{ description: "Item", quantity: 1, price: 100 }],
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Missing client");
    });

    it("sends clientId to API when provided", async () => {
      const spy = mockApiCall(MOCK_DOC);
      await handleInvoiceCreate({
        type: 305,
        clientId: "existing-client-id",
        items: [{ description: "Item", quantity: 1, price: 100 }],
      });

      // Second fetch call is the API call — check its body
      const [, apiOpts] = spy.mock.calls[1] as [string, RequestInit];
      const body = JSON.parse(apiOpts.body as string);
      expect(body.client.id).toBe("existing-client-id");
      expect(body.client.add).toBeUndefined();
    });

    it("handles Hebrew content in client name and items", async () => {
      const spy = mockApiCall(MOCK_DOC);
      const result = await handleInvoiceCreate({
        type: 320,
        clientName: "אלון לוי",
        clientTaxId: "123456789",
        items: [
          {
            description: "שעות ייעוץ - מרץ 2026",
            quantity: 10,
            price: 500,
          },
        ],
        currency: "ILS",
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Tax Invoice-Receipt Created");

      const [, apiOpts] = spy.mock.calls[1] as [string, RequestInit];
      const body = JSON.parse(apiOpts.body as string);
      expect(body.client.name).toBe("אלון לוי");
      expect(body.client.taxId).toBe("123456789");
      expect(body.income[0].description).toBe("שעות ייעוץ - מרץ 2026");
    });

    it("includes payment items when provided", async () => {
      const spy = mockApiCall(MOCK_DOC);
      await handleInvoiceCreate({
        type: 320,
        clientName: "Test",
        items: [{ description: "Item", quantity: 1, price: 1000 }],
        payment: [{ type: 4, price: 1000 }],
      });

      const [, apiOpts] = spy.mock.calls[1] as [string, RequestInit];
      const body = JSON.parse(apiOpts.body as string);
      expect(body.payment).toHaveLength(1);
      expect(body.payment[0].type).toBe(4);
    });

    it("includes URL in output when present", async () => {
      mockApiCall(MOCK_DOC);
      const result = await handleInvoiceCreate({
        type: 400,
        clientName: "Test",
        items: [{ description: "Item", quantity: 1, price: 100 }],
      });
      expect(result.content[0].text).toContain(
        "https://app.greeninvoice.co.il/doc/abc",
      );
    });
  });

  // --- invoice_list ---

  describe("invoice_list", () => {
    it("returns formatted list of documents", async () => {
      mockApiCall(MOCK_DOC_LIST);
      const result = await handleInvoiceList({});
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Documents (2 of 2)");
      expect(result.content[0].text).toContain("אלון לוי");
      expect(result.content[0].text).toContain("Receipt (Kabala)");
      expect(result.content[0].text).toContain("Tax Invoice");
    });

    it("returns no documents message when empty", async () => {
      mockApiCall({ items: [], total: 0 });
      const result = await handleInvoiceList({});
      expect(result.content[0].text).toContain("No documents found");
    });

    it("passes filter params to API", async () => {
      const spy = mockApiCall(MOCK_DOC_LIST);
      await handleInvoiceList({
        type: 400,
        fromDate: "2026-01-01",
        toDate: "2026-03-31",
        page: 1,
        pageSize: 10,
      });

      const [, apiOpts] = spy.mock.calls[1] as [string, RequestInit];
      const body = JSON.parse(apiOpts.body as string);
      expect(body.type).toBe(400);
      expect(body.fromDate).toBe("2026-01-01");
      expect(body.toDate).toBe("2026-03-31");
    });
  });

  // --- receipt_create ---

  describe("receipt_create", () => {
    it("creates receipt with required fields", async () => {
      mockApiCall(MOCK_DOC);
      const result = await handleReceiptCreate({
        clientName: "דני כהן",
        description: "שעות ייעוץ - מרץ 2026",
        amount: 5000,
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Receipt (Kabala) Created");
      expect(result.content[0].text).toContain("דני כהן");
      expect(result.content[0].text).toContain("ILS 5000.00");
      expect(result.content[0].text).toContain("Bank Transfer");
    });

    it("returns error when clientName is missing", async () => {
      const result = await handleReceiptCreate({
        description: "Item",
        amount: 100,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Missing required");
    });

    it("returns error when amount is missing", async () => {
      const result = await handleReceiptCreate({
        clientName: "Test",
        description: "Item",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Missing required");
    });

    it("defaults to bank transfer and VAT exempt", async () => {
      const spy = mockApiCall(MOCK_DOC);
      await handleReceiptCreate({
        clientName: "Test",
        description: "Item",
        amount: 1000,
      });

      const [, apiOpts] = spy.mock.calls[1] as [string, RequestInit];
      const body = JSON.parse(apiOpts.body as string);
      expect(body.payment[0].type).toBe(4); // bank transfer
      expect(body.income[0].vatType).toBe(2); // exempt
    });

    it("respects custom payment method", async () => {
      mockApiCall(MOCK_DOC);
      const result = await handleReceiptCreate({
        clientName: "Test",
        description: "Item",
        amount: 500,
        paymentMethod: 3,
      });
      expect(result.content[0].text).toContain("Credit Card");
    });

    it("calculates total from amount * quantity", async () => {
      mockApiCall(MOCK_DOC);
      const result = await handleReceiptCreate({
        clientName: "Test",
        description: "Hours",
        amount: 200,
        quantity: 5,
      });
      expect(result.content[0].text).toContain("ILS 1000.00");
    });

    it("passes client email and tax ID when provided", async () => {
      const spy = mockApiCall(MOCK_DOC);
      await handleReceiptCreate({
        clientName: "Test",
        description: "Item",
        amount: 1000,
        clientEmail: "test@example.com",
        clientTaxId: "987654321",
      });

      const [, apiOpts] = spy.mock.calls[1] as [string, RequestInit];
      const body = JSON.parse(apiOpts.body as string);
      expect(body.client.email).toBe("test@example.com");
      expect(body.client.taxId).toBe("987654321");
    });
  });

  // --- client_search ---

  describe("client_search", () => {
    it("returns formatted client list", async () => {
      mockApiCall(MOCK_CLIENT_LIST);
      const result = await handleClientSearch({ query: "אלון" });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Clients (1 of 1)");
      expect(result.content[0].text).toContain("אלון לוי");
      expect(result.content[0].text).toContain("alon@example.com");
      expect(result.content[0].text).toContain("Tax: 123456789");
    });

    it("returns no clients when empty", async () => {
      mockApiCall({ items: [], total: 0 });
      const result = await handleClientSearch({ query: "nonexistent" });
      expect(result.content[0].text).toContain("No clients found");
    });

    it("passes query as name to API", async () => {
      const spy = mockApiCall(MOCK_CLIENT_LIST);
      await handleClientSearch({ query: "דני" });

      const [, apiOpts] = spy.mock.calls[1] as [string, RequestInit];
      const body = JSON.parse(apiOpts.body as string);
      expect(body.name).toBe("דני");
    });
  });

  // --- client_create ---

  describe("client_create", () => {
    it("creates client with name only", async () => {
      mockApiCall(MOCK_CLIENT_CREATED);
      const result = await handleClientCreate({ name: "דני כהן" });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Client Created");
      expect(result.content[0].text).toContain("דני כהן");
      expect(result.content[0].text).toContain("client-new");
    });

    it("returns error when name is missing", async () => {
      const result = await handleClientCreate({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Missing required: name");
    });

    it("passes all optional fields to API", async () => {
      const spy = mockApiCall(MOCK_CLIENT_CREATED);
      await handleClientCreate({
        name: "Test Corp",
        email: "corp@test.com",
        taxId: "515123456",
        phone: "050-1234567",
        address: "רחוב הרצל 1",
        city: "תל אביב",
        country: "IL",
      });

      const [, apiOpts] = spy.mock.calls[1] as [string, RequestInit];
      const body = JSON.parse(apiOpts.body as string);
      expect(body.name).toBe("Test Corp");
      expect(body.email).toBe("corp@test.com");
      expect(body.taxId).toBe("515123456");
      expect(body.phone).toBe("050-1234567");
      expect(body.address).toBe("רחוב הרצל 1");
      expect(body.city).toBe("תל אביב");
    });

    it("defaults country to IL", async () => {
      const spy = mockApiCall(MOCK_CLIENT_CREATED);
      await handleClientCreate({ name: "Test" });

      const [, apiOpts] = spy.mock.calls[1] as [string, RequestInit];
      const body = JSON.parse(apiOpts.body as string);
      expect(body.country).toBe("IL");
    });

    it("includes optional fields in output when provided", async () => {
      mockApiCall(MOCK_CLIENT_CREATED);
      const result = await handleClientCreate({
        name: "Test",
        email: "t@t.com",
        taxId: "123",
        phone: "050-111",
        address: "St 1",
        city: "TLV",
      });

      const text = result.content[0].text;
      expect(text).toContain("t@t.com");
      expect(text).toContain("123");
      expect(text).toContain("050-111");
      expect(text).toContain("St 1, TLV");
    });
  });
});
