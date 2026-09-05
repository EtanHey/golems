/**
 * Gmail Client for EmailGolem
 *
 * Handles OAuth authentication and email fetching from Gmail API.
 * Uses googleapis npm package with OAuth2 refresh token.
 */

import { google, type gmail_v1 } from "googleapis";

/** Parsed Gmail email with extracted header fields */
export interface GmailEmail {
  id: string;
  subject: string;
  from: string;
  fromName?: string;
  snippet: string;
  bodyText?: string;
  receivedAt: Date;
  labelIds?: string[];
  listUnsubscribe?: string;
}

interface RawEmailPayload {
  headers?: Array<{ name: string; value: string }>;
}

interface RawEmail {
  id?: string | null;
  internalDate?: string | null;
  snippet?: string | null;
  labelIds?: string[] | null;
  payload?: RawEmailPayload | null;
}

// Module-level gmail client (lazy initialized)
let gmailClient: gmail_v1.Gmail | null = null;

/**
 * Create and return a Gmail API client.
 * Uses OAuth2 with refresh token from environment variables.
 */
export function createGmailClient(): gmail_v1.Gmail {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Missing Gmail credentials. Required: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN",
    );
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);

  oauth2Client.setCredentials({
    refresh_token: refreshToken,
  });

  gmailClient = google.gmail({ version: "v1", auth: oauth2Client });
  return gmailClient;
}

/**
 * Get or create Gmail client (singleton pattern).
 */
export function getGmailClient(): gmail_v1.Gmail {
  if (!gmailClient) {
    return createGmailClient();
  }
  return gmailClient;
}

/**
 * Parse raw Gmail API response into GmailEmail.
 */
export function parseEmail(raw: RawEmail): GmailEmail {
  const headers = raw.payload?.headers || [];

  const getHeader = (name: string): string => {
    const header = headers.find(
      (h) => h.name.toLowerCase() === name.toLowerCase(),
    );
    return header?.value || "";
  };

  // Parse "From" header - can be "Name <email>" or just "email"
  const fromRaw = getHeader("From");
  let from = fromRaw;
  let fromName: string | undefined;

  const emailMatch = fromRaw.match(/<([^>]+)>/);
  if (emailMatch) {
    from = emailMatch[1];
    fromName = fromRaw.replace(/<[^>]+>/, "").trim();
  }

  // Parse date from internalDate (Unix timestamp in milliseconds)
  const receivedAt = raw.internalDate
    ? new Date(parseInt(raw.internalDate, 10))
    : new Date();

  // Extract List-Unsubscribe header (RFC 2369)
  const listUnsubscribe = getHeader("List-Unsubscribe") || undefined;

  return {
    id: raw.id || "",
    subject: getHeader("Subject"),
    from,
    fromName,
    snippet: raw.snippet || "",
    receivedAt,
    labelIds: raw.labelIds || undefined,
    listUnsubscribe,
  };
}

/**
 * Fetch recent emails from Gmail.
 *
 * @param maxResults - Maximum number of emails to fetch (default: 20)
 * @param labelIds - Filter by labels (default: ["INBOX"])
 * @returns Array of parsed emails
 */
export async function fetchRecentEmails(
  maxResults: number = 20,
  labelIds: string[] = ["INBOX"],
): Promise<GmailEmail[]> {
  const gmail = getGmailClient();

  // List message IDs
  const listResponse = await gmail.users.messages.list({
    userId: "me",
    maxResults,
    labelIds,
  });

  const messageIds = listResponse.data.messages;
  if (!messageIds || messageIds.length === 0) {
    return [];
  }

  // Fetch full message data for each
  const emails: GmailEmail[] = [];

  for (const msg of messageIds) {
    if (!msg.id) continue;

    const fullMessage = await gmail.users.messages.get({
      userId: "me",
      id: msg.id,
      format: "metadata",
      metadataHeaders: ["From", "Subject", "Date", "List-Unsubscribe"],
    });

    emails.push(parseEmail(fullMessage.data));
  }

  return emails;
}

/**
 * Fetch emails since a specific timestamp.
 * Useful for polling new emails since last check.
 */
export async function fetchEmailsSince(
  sinceTimestamp: Date,
  maxResults: number = 50,
): Promise<GmailEmail[]> {
  const gmail = getGmailClient();

  // Gmail query format: after:YYYY/MM/DD
  const afterDate = sinceTimestamp
    .toISOString()
    .split("T")[0]
    .replace(/-/g, "/");

  const listResponse = await gmail.users.messages.list({
    userId: "me",
    maxResults,
    q: `after:${afterDate}`,
    labelIds: ["INBOX"],
  });

  const messageIds = listResponse.data.messages;
  if (!messageIds || messageIds.length === 0) {
    return [];
  }

  const emails: GmailEmail[] = [];

  for (const msg of messageIds) {
    if (!msg.id) continue;

    const fullMessage = await gmail.users.messages.get({
      userId: "me",
      id: msg.id,
      format: "metadata",
      metadataHeaders: ["From", "Subject", "Date", "List-Unsubscribe"],
    });

    const parsed = parseEmail(fullMessage.data);

    // Double-check timestamp (Gmail query is date-only, not time)
    if (parsed.receivedAt >= sinceTimestamp) {
      emails.push(parsed);
    }
  }

  return emails;
}

/**
 * Search emails using Gmail query syntax.
 *
 * @param query - Gmail search query (e.g., "from:united.com confirmation", "subject:receipt")
 * @param maxResults - Maximum number of emails to return (default: 20)
 * @returns Array of matching emails
 *
 * @example
 * // Find flight confirmations
 * searchEmails("from:united.com confirmation")
 * searchEmails("from:britishairways.com")
 *
 * // Find receipts
 * searchEmails("subject:receipt after:2025/01/01")
 */
export async function searchEmails(
  query: string,
  maxResults: number = 20,
  options?: { includeSpamTrash?: boolean },
): Promise<GmailEmail[]> {
  const gmail = getGmailClient();
  const includeSpamTrash = options?.includeSpamTrash ?? false;

  // Gmail API caps at 500 per page — paginate if maxResults > 500
  const allMessageIds: Array<{ id: string }> = [];
  let pageToken: string | undefined;

  while (allMessageIds.length < maxResults) {
    const pageSize = Math.min(maxResults - allMessageIds.length, 500);
    const listResponse = await gmail.users.messages.list({
      userId: "me",
      maxResults: pageSize,
      q: query,
      includeSpamTrash,
      pageToken,
    });

    const messages = listResponse.data.messages;
    if (!messages || messages.length === 0) break;

    for (const msg of messages) {
      if (msg.id) allMessageIds.push({ id: msg.id });
    }

    pageToken = listResponse.data.nextPageToken ?? undefined;
    if (!pageToken) break;
  }

  if (allMessageIds.length === 0) return [];

  // Fetch full message data for each
  const emails: GmailEmail[] = [];

  for (const msg of allMessageIds) {
    const fullMessage = await gmail.users.messages.get({
      userId: "me",
      id: msg.id,
      format: "metadata",
      metadataHeaders: ["From", "Subject", "Date", "List-Unsubscribe"],
    });

    emails.push(parseEmail(fullMessage.data));
  }

  return emails;
}

/**
 * List email IDs matching a query without fetching full message data.
 * Much faster than searchEmails() for counting or lazy fetching.
 *
 * @example
 * const ids = await listEmailIds("after:2025/01/01", 2000);
 * console.log(`Found ${ids.length} emails`);
 */
export async function listEmailIds(
  query: string,
  maxResults: number = 500,
  options?: { includeSpamTrash?: boolean },
): Promise<string[]> {
  const gmail = getGmailClient();
  const includeSpamTrash = options?.includeSpamTrash ?? false;

  const allIds: string[] = [];
  let pageToken: string | undefined;

  while (allIds.length < maxResults) {
    const pageSize = Math.min(maxResults - allIds.length, 500);
    const listResponse = await gmail.users.messages.list({
      userId: "me",
      maxResults: pageSize,
      q: query,
      includeSpamTrash,
      pageToken,
    });

    const messages = listResponse.data.messages;
    if (!messages || messages.length === 0) break;

    for (const msg of messages) {
      if (msg.id) allIds.push(msg.id);
    }

    pageToken = listResponse.data.nextPageToken ?? undefined;
    if (!pageToken) break;
  }

  return allIds;
}

/**
 * Fetch a single email by ID.
 *
 * @example
 * const email = await getEmailById("msg-id-123");
 */
export async function getEmailById(id: string): Promise<GmailEmail> {
  const gmail = getGmailClient();
  const fullMessage = await gmail.users.messages.get({
    userId: "me",
    id,
    format: "metadata",
    metadataHeaders: ["From", "Subject", "Date", "List-Unsubscribe"],
  });
  return parseEmail(fullMessage.data);
}

/**
 * Extract plain text body from a Gmail message's MIME parts.
 * Handles both simple and multipart messages.
 */
function extractBodyText(payload: gmail_v1.Schema$MessagePart): string {
  // Simple message — body directly on payload (text/plain only, skip HTML)
  if (payload?.body?.data && payload.mimeType === "text/plain") {
    return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  }

  // Multipart — find text/plain part
  if (payload?.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return Buffer.from(part.body.data, "base64url").toString("utf-8");
      }
      // Recurse into nested multipart (e.g., multipart/alternative inside multipart/mixed)
      if (part.parts) {
        const nested = extractBodyText(part);
        if (nested) return nested;
      }
    }
  }

  return "";
}

/**
 * Fetch the plain text body of an email by ID.
 * Returns truncated body text (first maxChars characters).
 *
 * @param id - Gmail message ID
 * @param maxChars - Maximum characters to return (default: 1000)
 */
export async function getEmailBodyText(
  id: string,
  maxChars: number = 1000,
): Promise<string> {
  const gmail = getGmailClient();
  const fullMessage = await gmail.users.messages.get({
    userId: "me",
    id,
    format: "full",
  });

  const body = extractBodyText(fullMessage.data.payload);
  return body.slice(0, maxChars).trim();
}

/**
 * Get or create a Gmail label by name.
 * Returns the label ID.
 */
export async function getOrCreateLabel(labelName: string): Promise<string> {
  const gmail = getGmailClient();

  // Check if label already exists
  const { data } = await gmail.users.labels.list({ userId: "me" });
  const existing = data.labels?.find((l) => l.name === labelName);
  if (existing?.id) return existing.id;

  // Create it
  const { data: created } = await gmail.users.labels.create({
    userId: "me",
    requestBody: {
      name: labelName,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    },
  });

  if (!created.id) throw new Error(`Failed to create label "${labelName}"`);
  return created.id;
}

/**
 * Create a Gmail filter to auto-label + skip inbox for a sender.
 * Used when unsubscribing — future emails get labeled and archived.
 */
export async function createSenderFilter(
  senderEmail: string,
  labelId: string,
): Promise<void> {
  const gmail = getGmailClient();

  await gmail.users.settings.filters.create({
    userId: "me",
    requestBody: {
      criteria: { from: senderEmail },
      action: {
        addLabelIds: [labelId],
        removeLabelIds: ["INBOX"],
      },
    },
  });
}

/**
 * Reset or inject the Gmail client (for testing).
 */
export function resetGmailClient(mockClient?: gmail_v1.Gmail | null): void {
  gmailClient = mockClient ?? null;
}
