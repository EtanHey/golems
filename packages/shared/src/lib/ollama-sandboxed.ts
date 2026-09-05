/**
 * Sandboxed Ollama Client
 *
 * Talks to Ollama running in Docker container.
 * All outputs go to validation queue before use.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const MODEL = process.env.OLLAMA_MODEL || "qwen3-coder-64k";
const VALIDATION_DIR =
  process.env.VALIDATION_DIR || `${process.env.HOME}/.golems-zikaron/validation-queue`;

interface ValidationEntry {
  id: string;
  timestamp: string;
  source: string;
  prompt: string;
  response: string;
  model: string;
  status: "pending" | "approved" | "rejected";
  reviewedAt?: string;
  reviewNotes?: string;
}

interface BlocklistConfig {
  enabled: boolean;
  caseInsensitive: boolean;
  critical: string[];
  suspicious: string[];
}

interface ValidationConfig {
  validation: {
    enabled: boolean;
    model: string;
    maxPendingAge: number;
    autoApproveScore: number;
    timeoutMs: number;
  };
  blocklist: BlocklistConfig;
  allowlist: {
    sources: string[];
    maxLength: number;
    trustedPatterns: string[];
  };
}

/**
 * Load validation config
 */
function loadConfig(): ValidationConfig {
  const configPath = join(VALIDATION_DIR, "config.json");
  if (existsSync(configPath)) {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  }
  // Default config
  return {
    validation: {
      enabled: true,
      model: "claude-sonnet-4-20250514",
      maxPendingAge: 3600,
      autoApproveScore: 0.95,
      timeoutMs: 30000,
    },
    blocklist: {
      enabled: true,
      caseInsensitive: true,
      critical: [],
      suspicious: [],
    },
    allowlist: {
      sources: [],
      maxLength: 10000,
      trustedPatterns: [],
    },
  };
}

/**
 * Check response against blocklist patterns
 */
function checkBlocklist(
  response: string,
  blocklist: BlocklistConfig
): { blocked: boolean; reason?: string } {
  if (!blocklist.enabled) return { blocked: false };

  const flags = blocklist.caseInsensitive ? "i" : "";

  // Check critical patterns (immediate reject)
  for (const pattern of blocklist.critical) {
    const regex = new RegExp(pattern, flags);
    if (regex.test(response)) {
      return { blocked: true, reason: `Critical pattern: ${pattern}` };
    }
  }

  // Check suspicious patterns (flag but allow)
  for (const pattern of blocklist.suspicious) {
    const regex = new RegExp(pattern, flags);
    if (regex.test(response)) {
      console.warn(`[Ollama] Suspicious pattern detected: ${pattern}`);
    }
  }

  return { blocked: false };
}

/**
 * Save output to validation queue
 */
function saveToQueue(entry: ValidationEntry): string {
  const dir = join(VALIDATION_DIR, entry.status);
  const filename = `${entry.id}.json`;
  const path = join(dir, filename);

  writeFileSync(path, JSON.stringify(entry, null, 2));
  console.log(`[Ollama] Saved to ${entry.status}/: ${entry.id}`);

  return entry.id;
}

/**
 * Call Ollama API (Docker container)
 */
async function callOllamaAPI(
  prompt: string,
  options: { stream?: boolean; model?: string } = {}
): Promise<string> {
  const model = options.model || MODEL;

  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Ollama API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.response || "";
}

/**
 * Run Ollama with validation queue
 *
 * Returns the validation entry ID. Use getApprovedResponse() to retrieve approved output.
 */
export async function runOllamaSandboxed(
  prompt: string,
  source: string
): Promise<{ id: string; response: string; autoApproved: boolean }> {
  const config = loadConfig();
  const id = randomUUID().slice(0, 8);

  console.log(`[Ollama] Running sandboxed query (${source}): ${id}`);

  // Call Ollama
  let response: string;
  try {
    response = await callOllamaAPI(prompt);
  } catch (err) {
    console.error(`[Ollama] API error:`, err);
    throw err;
  }

  // Check blocklist
  const blockCheck = checkBlocklist(response, config.blocklist);

  // Create validation entry
  const entry: ValidationEntry = {
    id,
    timestamp: new Date().toISOString(),
    source,
    prompt: prompt.slice(0, 500) + (prompt.length > 500 ? "..." : ""),
    response,
    model: MODEL,
    status: blockCheck.blocked ? "rejected" : "pending",
    reviewNotes: blockCheck.reason,
  };

  // Auto-reject if blocklist hit
  if (blockCheck.blocked) {
    console.warn(`[Ollama] Auto-rejected: ${blockCheck.reason}`);
    saveToQueue(entry);
    return { id, response: "", autoApproved: false };
  }

  // Check for trusted patterns (auto-approve)
  const hasTrustedPattern = config.allowlist.trustedPatterns.some((pattern) =>
    response.toLowerCase().includes(pattern.toLowerCase())
  );

  const isTrustedSource = config.allowlist.sources.includes(source);
  const isShortEnough = response.length <= config.allowlist.maxLength;

  // Auto-approve if trusted source + trusted pattern + reasonable length
  if (hasTrustedPattern && isTrustedSource && isShortEnough) {
    entry.status = "approved";
    entry.reviewedAt = new Date().toISOString();
    entry.reviewNotes = "Auto-approved: trusted source + pattern";
    saveToQueue(entry);
    return { id, response, autoApproved: true };
  }

  // Otherwise, save as pending for Claude review
  saveToQueue(entry);
  return { id, response, autoApproved: false };
}

/**
 * Get approved response by ID
 */
export function getApprovedResponse(id: string): string | null {
  const approvedPath = join(VALIDATION_DIR, "approved", `${id}.json`);

  if (existsSync(approvedPath)) {
    const entry: ValidationEntry = JSON.parse(readFileSync(approvedPath, "utf-8"));
    return entry.response;
  }

  return null;
}

/**
 * Wait for response to be approved (with timeout)
 */
export async function waitForApproval(
  id: string,
  timeoutMs = 60000,
  pollIntervalMs = 1000
): Promise<string | null> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const response = getApprovedResponse(id);
    if (response !== null) {
      return response;
    }

    // Check if rejected
    const rejectedPath = join(VALIDATION_DIR, "rejected", `${id}.json`);
    if (existsSync(rejectedPath)) {
      console.warn(`[Ollama] Response ${id} was rejected`);
      return null;
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  console.warn(`[Ollama] Timeout waiting for approval: ${id}`);
  return null;
}

/**
 * Get all pending entries
 */
export function getPendingEntries(): ValidationEntry[] {
  const pendingDir = join(VALIDATION_DIR, "pending");
  if (!existsSync(pendingDir)) return [];

  const files = readdirSync(pendingDir).filter((f) => f.endsWith(".json"));
  return files.map((f) => JSON.parse(readFileSync(join(pendingDir, f), "utf-8")));
}

/**
 * Approve a pending entry (called by validation service)
 */
export function approveEntry(id: string, notes?: string): boolean {
  const pendingPath = join(VALIDATION_DIR, "pending", `${id}.json`);
  if (!existsSync(pendingPath)) return false;

  const entry: ValidationEntry = JSON.parse(readFileSync(pendingPath, "utf-8"));
  entry.status = "approved";
  entry.reviewedAt = new Date().toISOString();
  entry.reviewNotes = notes || "Approved by validation service";

  // Move to approved
  writeFileSync(join(VALIDATION_DIR, "approved", `${id}.json`), JSON.stringify(entry, null, 2));
  unlinkSync(pendingPath);

  console.log(`[Ollama] Approved: ${id}`);
  return true;
}

/**
 * Reject a pending entry
 */
export function rejectEntry(id: string, reason: string): boolean {
  const pendingPath = join(VALIDATION_DIR, "pending", `${id}.json`);
  if (!existsSync(pendingPath)) return false;

  const entry: ValidationEntry = JSON.parse(readFileSync(pendingPath, "utf-8"));
  entry.status = "rejected";
  entry.reviewedAt = new Date().toISOString();
  entry.reviewNotes = reason;

  // Move to rejected
  writeFileSync(join(VALIDATION_DIR, "rejected", `${id}.json`), JSON.stringify(entry, null, 2));
  unlinkSync(pendingPath);

  console.log(`[Ollama] Rejected: ${id} - ${reason}`);
  return true;
}

// ═══════════════════════════════════════════════════════
// EMBEDDINGS (passthrough - no validation needed)
// ═══════════════════════════════════════════════════════

const EMBED_MODEL = "mxbai-embed-large";

/**
 * Get embedding vector - embeddings don't need validation.
 * Returns null when the embedding request fails.
 */
export async function getEmbedding(text: string): Promise<number[] | null> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: EMBED_MODEL,
        prompt: text.slice(0, 2000),
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[Embed] API error ${response.status}: ${text}`);
      console.error(`[Embed] Is Ollama running? Check: curl ${OLLAMA_URL}/api/tags`);
      return null;
    }

    const data = await response.json();
    return data.embedding || [];
  } catch (err) {
    console.error("[Embed] Connection failed:", err);
    console.error("[Embed] Is Ollama running? Try: ollama serve");
    return null;
  }
}

/**
 * Batch embed multiple texts.
 * Returns null if any element fails so successful results stay index-aligned.
 */
export async function batchEmbed(texts: string[]): Promise<number[][] | null> {
  const embeddings: number[][] = [];

  for (let i = 0; i < texts.length; i++) {
    console.log(`[Embed] ${i + 1}/${texts.length}`);
    const embedding = await getEmbedding(texts[i]);
    if (embedding === null) return null;
    embeddings.push(embedding);

    if (i < texts.length - 1) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return embeddings;
}

// Re-export utility functions
export { cosineSimilarity, findSimilar } from "./ollama-helper";
