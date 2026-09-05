import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import {
  getToken,
  resetTokenCache,
  apiRequest,
  getBaseUrl,
  getCredentials,
  _setSleep,
} from "../api";

let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | null =
  null;

// Creates a fresh Response for each fetch call (Response body is single-read)
function mockFetch(response: {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
  text?: string;
}) {
  fetchSpy?.mockRestore();
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () => {
    const headers = new Headers(response.headers ?? {});
    const bodyText =
      response.text ?? (response.body ? JSON.stringify(response.body) : "");
    return new Response(bodyText, { status: response.status, headers });
  });
  return fetchSpy;
}

function mockFetchSequence(
  responses: Array<{
    status: number;
    headers?: Record<string, string>;
    body?: unknown;
    text?: string;
  }>,
) {
  fetchSpy?.mockRestore();
  let callIndex = 0;
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () => {
    const response = responses[Math.min(callIndex, responses.length - 1)];
    callIndex++;
    const headers = new Headers(response.headers ?? {});
    const bodyText =
      response.text ?? (response.body ? JSON.stringify(response.body) : "");
    return new Response(bodyText, { status: response.status, headers });
  });
  return fetchSpy;
}

describe("api", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetTokenCache();
    _setSleep(async () => {}); // No-op sleep for tests
    process.env.GREEN_INVOICE_ID = "test-id";
    process.env.GREEN_INVOICE_SECRET = "test-secret";
    delete process.env.GREEN_INVOICE_SANDBOX;
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    fetchSpy = null;
    process.env = { ...originalEnv };
  });

  // --- getBaseUrl ---

  describe("getBaseUrl", () => {
    it("returns production URL by default", () => {
      expect(getBaseUrl()).toBe("https://api.greeninvoice.co.il/api/v1");
    });

    it("returns sandbox URL when GREEN_INVOICE_SANDBOX=true", () => {
      process.env.GREEN_INVOICE_SANDBOX = "true";
      expect(getBaseUrl()).toBe("https://sandbox.d.greeninvoice.co.il/api/v1");
    });
  });

  // --- getCredentials ---

  describe("getCredentials", () => {
    it("returns credentials from env vars", () => {
      expect(getCredentials()).toEqual({
        id: "test-id",
        secret: "test-secret",
      });
    });

    it("throws when GREEN_INVOICE_ID is missing", () => {
      delete process.env.GREEN_INVOICE_ID;
      expect(() => getCredentials()).toThrow("Missing GREEN_INVOICE_ID");
    });

    it("throws when GREEN_INVOICE_SECRET is missing", () => {
      delete process.env.GREEN_INVOICE_SECRET;
      expect(() => getCredentials()).toThrow(
        "Missing GREEN_INVOICE_ID or GREEN_INVOICE_SECRET",
      );
    });
  });

  // --- getToken ---

  describe("getToken", () => {
    it("fetches token from X-Authorization-Bearer header", async () => {
      const spy = mockFetch({
        status: 200,
        headers: { "X-Authorization-Bearer": "jwt-token-123" },
        body: {},
      });

      const token = await getToken();
      expect(token).toBe("jwt-token-123");
      expect(spy).toHaveBeenCalledTimes(1);

      const [url, options] = spy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.greeninvoice.co.il/api/v1/account/token");
      expect(JSON.parse(options.body as string)).toEqual({
        id: "test-id",
        secret: "test-secret",
      });
    });

    it("falls back to token in response body", async () => {
      mockFetch({
        status: 200,
        body: { token: "body-token-456" },
      });

      const token = await getToken();
      expect(token).toBe("body-token-456");
    });

    it("caches token for subsequent calls", async () => {
      const spy = mockFetch({
        status: 200,
        headers: { "X-Authorization-Bearer": "cached-token" },
        body: {},
      });

      await getToken();
      await getToken();
      await getToken();

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("throws on auth failure", async () => {
      mockFetch({
        status: 401,
        text: "Invalid credentials",
      });

      await expect(getToken()).rejects.toThrow(
        "Green Invoice auth failed (401)",
      );
    });

    it("throws when no token in header or body", async () => {
      mockFetch({
        status: 200,
        body: { noTokenHere: true },
      });

      await expect(getToken()).rejects.toThrow(
        "No JWT token in response header or body",
      );
    });
  });

  // --- apiRequest ---

  describe("apiRequest", () => {
    it("makes authenticated request with Bearer token", async () => {
      const spy = mockFetchSequence([
        {
          status: 200,
          headers: { "X-Authorization-Bearer": "my-jwt" },
          body: {},
        },
        {
          status: 200,
          body: { id: "doc-1", number: "001" },
        },
      ]);

      const result = await apiRequest<Record<string, unknown>>(
        "GET",
        "/documents/doc-1",
      );
      expect(result.id).toBe("doc-1");

      const [, apiCall] = spy.mock.calls[1] as [string, RequestInit];
      const headers = apiCall.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer my-jwt");
    });

    it("retries once on 401 with fresh token", async () => {
      const spy = mockFetchSequence([
        {
          status: 200,
          headers: { "X-Authorization-Bearer": "expired-jwt" },
          body: {},
        },
        { status: 401, text: "Token expired" },
        {
          status: 200,
          headers: { "X-Authorization-Bearer": "fresh-jwt" },
          body: {},
        },
        { status: 200, body: { success: true } },
      ]);

      const result = await apiRequest<Record<string, unknown>>("GET", "/test");
      expect(result.success).toBe(true);
      expect(spy).toHaveBeenCalledTimes(4);
    });

    it("retries on 429 with exponential backoff", async () => {
      const spy = mockFetchSequence([
        {
          status: 200,
          headers: { "X-Authorization-Bearer": "jwt" },
          body: {},
        },
        { status: 429, text: "Rate limited" },
        { status: 200, body: { retried: true } },
      ]);

      const result = await apiRequest<Record<string, unknown>>("GET", "/test");
      expect(result.retried).toBe(true);
      expect(spy).toHaveBeenCalledTimes(3);
    });

    it("respects Retry-After header on 429", async () => {
      const spy = mockFetchSequence([
        {
          status: 200,
          headers: { "X-Authorization-Bearer": "jwt" },
          body: {},
        },
        {
          status: 429,
          headers: { "Retry-After": "1" },
          text: "Rate limited",
        },
        { status: 200, body: { ok: true } },
      ]);

      const result = await apiRequest<Record<string, unknown>>("GET", "/test");
      expect(result.ok).toBe(true);
      expect(spy).toHaveBeenCalledTimes(3);
    });

    it("falls back to exponential backoff when Retry-After is HTTP-date", async () => {
      const spy = mockFetchSequence([
        {
          status: 200,
          headers: { "X-Authorization-Bearer": "jwt" },
          body: {},
        },
        {
          status: 429,
          headers: { "Retry-After": "Wed, 21 Oct 2025 07:28:00 GMT" },
          text: "Rate limited",
        },
        { status: 200, body: { ok: true } },
      ]);

      const result = await apiRequest<Record<string, unknown>>("GET", "/test");
      expect(result.ok).toBe(true);
      expect(spy).toHaveBeenCalledTimes(3);
    });

    it("gives up after MAX_429_RETRIES", async () => {
      mockFetchSequence([
        {
          status: 200,
          headers: { "X-Authorization-Bearer": "jwt" },
          body: {},
        },
        { status: 429, text: "Rate limited" },
        { status: 429, text: "Rate limited" },
        { status: 429, text: "Rate limited" },
        { status: 429, text: "Still rate limited" },
      ]);

      await expect(apiRequest("GET", "/test")).rejects.toThrow("failed (429)");
    });

    it("throws descriptive error on API failure", async () => {
      mockFetchSequence([
        {
          status: 200,
          headers: { "X-Authorization-Bearer": "jwt" },
          body: {},
        },
        {
          status: 400,
          text: '{"errorMessage":"Invalid document type"}',
        },
      ]);

      await expect(apiRequest("POST", "/documents")).rejects.toThrow(
        "Green Invoice API POST /documents failed (400)",
      );
    });

    it("sends JSON body for POST requests", async () => {
      const spy = mockFetchSequence([
        {
          status: 200,
          headers: { "X-Authorization-Bearer": "jwt" },
          body: {},
        },
        { status: 200, body: { created: true } },
      ]);

      await apiRequest("POST", "/documents", { type: 400, lang: "he" });

      const [, apiCall] = spy.mock.calls[1] as [string, RequestInit];
      expect(JSON.parse(apiCall.body as string)).toEqual({
        type: 400,
        lang: "he",
      });
    });
  });
});
