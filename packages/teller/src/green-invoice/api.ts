/**
 * Green Invoice API Client
 *
 * JWT Bearer auth against api.greeninvoice.co.il/api/v1.
 * Handles token acquisition, document CRUD, and client search.
 *
 * ENV: GREEN_INVOICE_ID, GREEN_INVOICE_SECRET
 *   — Plain values or op:// references (e.g. op://development/green-invoice/id)
 * Optional: GREEN_INVOICE_SANDBOX=true for sandbox environment
 */

import type {
  CreateDocumentRequest,
  DocumentSearchRequest,
  ClientSearchRequest,
} from "./types";

const LIVE_BASE = "https://api.greeninvoice.co.il/api/v1";
const SANDBOX_BASE = "https://sandbox.d.greeninvoice.co.il/api/v1";

let cachedToken: string | null = null;
let tokenExpiry = 0;

/** Reset token cache (for tests or after auth failure). */
export function resetTokenCache(): void {
  cachedToken = null;
  tokenExpiry = 0;
}

/**
 * Resolve a value that may be an op:// 1Password reference.
 * If the value starts with "op://", runs `op read <ref>` to resolve it.
 * Otherwise returns the value as-is.
 */
export async function resolveOpReference(value: string): Promise<string> {
  if (!value.startsWith("op://")) {
    return value;
  }
  const proc = Bun.spawn(["op", "read", value], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 10_000,
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(
      `Failed to resolve 1Password reference ${value}: ${stderr.trim()}`,
    );
  }
  const resolved = await new Response(proc.stdout).text();
  return resolved.trim();
}

function getBaseUrl(): string {
  return process.env.GREEN_INVOICE_SANDBOX === "true"
    ? SANDBOX_BASE
    : LIVE_BASE;
}

async function getCredentials(): Promise<{ id: string; secret: string }> {
  const rawId = process.env.GREEN_INVOICE_ID;
  const rawSecret = process.env.GREEN_INVOICE_SECRET;
  if (!rawId || !rawSecret) {
    throw new Error(
      "Missing GREEN_INVOICE_ID or GREEN_INVOICE_SECRET env vars. " +
        "Set plain values or op:// references (e.g. op://development/green-invoice/id).",
    );
  }
  const [id, secret] = await Promise.all([
    resolveOpReference(rawId),
    resolveOpReference(rawSecret),
  ]);
  return { id, secret };
}

/**
 * Get JWT token, caching for 25 minutes (tokens last ~30 min).
 */
async function getToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry) {
    return cachedToken;
  }

  const { id, secret } = await getCredentials();
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
  if (!token) {
    // Fallback: some versions return it in the body
    try {
      const body = await res.json();
      if (body?.token) {
        cachedToken = body.token;
        tokenExpiry = now + 25 * 60 * 1000;
        return cachedToken;
      }
    } catch {
      // Body wasn't JSON — fall through to error
    }
    throw new Error("No JWT token in response header or body");
  }

  cachedToken = token;
  tokenExpiry = now + 25 * 60 * 1000;
  return cachedToken;
}

async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  _retry = false,
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
  });

  // On auth failure, invalidate cache and retry once
  if ((res.status === 401 || res.status === 403) && !_retry) {
    resetTokenCache();
    return apiRequest<T>(method, path, body, true);
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

// AIDEV-NOTE: createClient intentionally not exposed as MCP tool yet.
// Add invoice_createClient tool when needed for client management workflows.
export async function createClient(
  client: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return apiRequest("POST", "/clients", client);
}
