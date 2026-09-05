/**
 * Green Invoice API Client
 *
 * JWT Bearer auth against api.greeninvoice.co.il/api/v1.
 * Handles token acquisition, 401 auto-refresh, 429 retry with backoff,
 * document CRUD, and client management.
 *
 * ENV: GREEN_INVOICE_ID, GREEN_INVOICE_SECRET
 * Optional: GREEN_INVOICE_SANDBOX=true for sandbox environment
 */

import type {
  CreateDocumentRequest,
  DocumentSearchRequest,
  ClientSearchRequest,
  CreateClientRequest,
} from "./types";

const LIVE_BASE = "https://api.greeninvoice.co.il/api/v1";
const SANDBOX_BASE = "https://sandbox.d.greeninvoice.co.il/api/v1";

const MAX_429_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
const FETCH_TIMEOUT_MS = 30_000;

let cachedToken: string | null = null;
let tokenExpiry = 0;

/** Reset token cache (for tests or after auth failure). */
export function resetTokenCache(): void {
  cachedToken = null;
  tokenExpiry = 0;
}

export function getBaseUrl(): string {
  return process.env.GREEN_INVOICE_SANDBOX === "true"
    ? SANDBOX_BASE
    : LIVE_BASE;
}

export function getCredentials(): { id: string; secret: string } {
  const id = process.env.GREEN_INVOICE_ID;
  const secret = process.env.GREEN_INVOICE_SECRET;
  if (!id || !secret) {
    throw new Error(
      "Missing GREEN_INVOICE_ID or GREEN_INVOICE_SECRET env vars. " +
        "Get API keys from Green Invoice Settings → Developer Tools → API Keys. " +
        "1Password path: op://Golems/Green Invoice API/",
    );
  }
  return { id, secret };
}

/**
 * Get JWT token, caching for 25 minutes (tokens last ~30 min).
 */
export async function getToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry) {
    return cachedToken;
  }

  const { id, secret } = getCredentials();
  const base = getBaseUrl();

  const res = await fetch(`${base}/account/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, secret }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Green Invoice auth failed (${res.status}): ${body}`);
  }

  // Token comes from X-Authorization-Bearer header
  const token = res.headers.get("X-Authorization-Bearer");
  if (token) {
    cachedToken = token;
    tokenExpiry = now + 25 * 60 * 1000;
    return cachedToken;
  }

  // Fallback: some versions return it in the body
  const body = await res.json();
  if (body?.token) {
    cachedToken = body.token;
    tokenExpiry = now + 25 * 60 * 1000;
    return cachedToken;
  }

  throw new Error("No JWT token in response header or body");
}

/** Sleep — overridable for tests via `_setSleep`. */
let _sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Override sleep for testing (avoids real delays in 429 retry tests). */
export function _setSleep(fn: (ms: number) => Promise<void>): void {
  _sleep = fn;
}

/**
 * Core API request with:
 * - JWT Bearer auth
 * - 401 auto-refresh (one retry)
 * - 429 retry with exponential backoff (up to MAX_429_RETRIES)
 */
export async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: { _authRetried?: boolean; _rateLimitRetry?: number },
): Promise<T> {
  const token = await getToken();
  const base = getBaseUrl();

  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  // 401/403: invalidate cache and retry once
  if ((res.status === 401 || res.status === 403) && !options?._authRetried) {
    resetTokenCache();
    return apiRequest<T>(method, path, body, {
      ...options,
      _authRetried: true,
    });
  }

  // 429: exponential backoff retry
  const retryCount = options?._rateLimitRetry ?? 0;
  if (res.status === 429 && retryCount < MAX_429_RETRIES) {
    const retryAfter = res.headers.get("Retry-After");
    let waitMs: number;
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      // Fall back to exponential backoff if Retry-After is HTTP-date or unparseable
      waitMs = isNaN(seconds)
        ? INITIAL_BACKOFF_MS * Math.pow(2, retryCount)
        : seconds * 1000;
    } else {
      waitMs = INITIAL_BACKOFF_MS * Math.pow(2, retryCount);
    }
    await _sleep(waitMs);
    return apiRequest<T>(method, path, body, {
      ...options,
      _rateLimitRetry: retryCount + 1,
    });
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Green Invoice API ${method} ${path} failed (${res.status}): ${text}`,
    );
  }

  return res.json() as Promise<T>;
}

// --- Document Operations ---

export async function createDocument(
  doc: CreateDocumentRequest,
): Promise<Record<string, unknown>> {
  return apiRequest("POST", "/documents", {
    ...doc,
    lang: doc.lang ?? "he",
    currency: doc.currency ?? "ILS",
    signed: doc.signed ?? true,
    rounding: doc.rounding ?? false,
  });
}

export async function getDocument(
  documentId: string,
): Promise<Record<string, unknown>> {
  return apiRequest("GET", `/documents/${encodeURIComponent(documentId)}`);
}

export async function searchDocuments(
  params: DocumentSearchRequest,
): Promise<Record<string, unknown>> {
  const { page, pageSize, ...rest } = params;
  return apiRequest("POST", "/documents/search", {
    ...rest,
    page: page ?? 0,
    pageSize: Math.min(pageSize ?? 25, 50),
  });
}

export async function getDocumentDownloadLink(
  documentId: string,
): Promise<Record<string, unknown>> {
  return apiRequest(
    "GET",
    `/documents/${encodeURIComponent(documentId)}/download/links`,
  );
}

// --- Client Operations ---

export async function getClient(
  clientId: string,
): Promise<Record<string, unknown>> {
  return apiRequest("GET", `/clients/${encodeURIComponent(clientId)}`);
}

export async function searchClients(
  params: ClientSearchRequest,
): Promise<Record<string, unknown>> {
  const { page, pageSize, ...rest } = params;
  return apiRequest("POST", "/clients/search", {
    ...rest,
    page: page ?? 0,
    pageSize: Math.min(pageSize ?? 25, 50),
  });
}

export async function createClient(
  client: CreateClientRequest,
): Promise<Record<string, unknown>> {
  return apiRequest("POST", "/clients", client);
}
