/**
 * Thread Compaction System for Ollama Bot
 *
 * Compacts old thread turns (>24h) into summaries:
 * 1. Identify old turns
 * 2. Summarize via Ollama
 * 3. Embed with nomic-embed-text
 * 4. Store in ChromaDB
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { Message } from "./thread-store";
import { runOllama, getEmbedding } from "@golems/shared/lib/ollama-helper";

const CHROMA_API_URL = "http://127.0.0.1:8000/api/v1";
const FETCH_TIMEOUT_MS = 10000; // 10 second timeout for ChromaDB operations

const DEFAULT_THREADS_DIR = join(process.cwd(), "data", "ollama-threads");
const AGE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Fetch with timeout helper
 */
async function fetchWithTimeout(url: string, options: RequestInit & { timeout?: number } = {}): Promise<Response> {
  const { timeout = FETCH_TIMEOUT_MS, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Identify messages older than 24 hours
 */
export async function identifyOldTurns(
  threadId: string,
  threadsDir: string = DEFAULT_THREADS_DIR
): Promise<Message[]> {
  const filePath = join(threadsDir, `${threadId}.jsonl`);

  // Return empty array if file doesn't exist
  if (!existsSync(filePath)) {
    return [];
  }

  try {
    // Read file and parse JSONL
    const content = readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    // Parse each line and check age
    const oldMessages: Message[] = [];
    const now = Date.now();

    for (const line of lines) {
      try {
        const message = JSON.parse(line) as Message;

        // Check if message is older than 24 hours
        if (message.timestamp) {
          const messageTime = new Date(message.timestamp).getTime();

          // Validate timestamp
          if (!Number.isFinite(messageTime)) {
            console.error(`[ThreadCompactor] Invalid timestamp in ${threadId}:`, message.timestamp);
            continue;
          }

          const age = now - messageTime;

          if (age > AGE_THRESHOLD_MS) {
            oldMessages.push(message);
          }
        }
      } catch (error) {
        // Skip malformed line
        console.error(`[ThreadCompactor] Skipped malformed line in ${threadId}:`, line.substring(0, 50));
      }
    }

    return oldMessages;
  } catch (error) {
    console.error(`[ThreadCompactor] Failed to identify old turns in ${threadId}:`, error);
    return [];
  }
}

/**
 * Summarize messages via Ollama. Returns null when generation fails.
 */
export async function summarizeTurns(messages: Message[]): Promise<string | null> {
  // Return empty string for empty input
  if (messages.length === 0) {
    return "";
  }

  try {
    // Format messages into a conversation string
    const conversation = messages
      .filter(msg => msg?.role && msg?.content) // Filter out invalid messages
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join("\n");

    // Create summarization prompt
    const prompt = `Summarize the following conversation concisely (3-4 sentences max):

${conversation}

Summary:`;

    // Call Ollama
    const summary = await runOllama(prompt);
    if (summary === null) {
      console.error("[ThreadCompactor] Ollama failed to generate a summary");
      return null;
    }
    return summary;
  } catch (error) {
    console.error("[ThreadCompactor] Failed to summarize turns:", error);
    return null;
  }
}

/**
 * Generate embedding for summary text. Returns null when embedding fails.
 */
export async function embedSummary(summary: string): Promise<number[] | null> {
  // Return empty array for empty input
  if (!summary || summary.trim().length === 0) {
    return [];
  }

  try {
    // Use the existing getEmbedding helper (mxbai-embed-large model)
    const embedding = await getEmbedding(summary);
    if (embedding === null) {
      console.error("[ThreadCompactor] Ollama failed to generate an embedding");
      return null;
    }
    return embedding;
  } catch (error) {
    console.error("[ThreadCompactor] Failed to embed summary:", error);
    return null;
  }
}

/**
 * Store summary and embedding in ChromaDB using direct HTTP API
 */
export async function storeInChroma(
  threadId: string,
  summary: string,
  embedding: number[]
): Promise<boolean> {
  // Validate input
  if (!threadId || !summary || embedding.length === 0) {
    return false;
  }

  try {
    // Step 1: Get or create the 'ollama-golem' collection
    let collectionId: string;

    // Try to get existing collection
    const listResponse = await fetchWithTimeout(`${CHROMA_API_URL}/collections`);

    if (!listResponse.ok) {
      console.error("[ThreadCompactor] ChromaDB list collections failed:", listResponse.status);
      return false;
    }

    const collections = await listResponse.json();
    const existing = collections.find((c: any) => c.name === "ollama-golem");

    if (existing) {
      collectionId = existing.id;
    } else {
      // Create new collection
      const createResponse = await fetchWithTimeout(`${CHROMA_API_URL}/collections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "ollama-golem",
          metadata: { description: "Compacted Ollama bot conversation summaries" },
        }),
      });

      if (!createResponse.ok) {
        const error = await createResponse.text();
        console.error("[ThreadCompactor] ChromaDB create collection failed:", error);
        return false;
      }

      const created = await createResponse.json();
      collectionId = created.id;
    }

    // Step 2: Add the summary to the collection
    const summaryId = `${threadId}-${Date.now()}`;
    const timestamp = new Date().toISOString();

    const addResponse = await fetchWithTimeout(`${CHROMA_API_URL}/collections/${collectionId}/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ids: [summaryId],
        documents: [summary],
        embeddings: [embedding],
        metadatas: [{ threadId, timestamp }],
      }),
    });

    if (!addResponse.ok) {
      const error = await addResponse.text();
      console.error("[ThreadCompactor] ChromaDB add failed:", error);
      return false;
    }

    console.log(`[ThreadCompactor] Stored summary ${summaryId} in ChromaDB`);
    return true;
  } catch (error) {
    console.error("[ThreadCompactor] Failed to store in ChromaDB:", error);
    return false;
  }
}

/**
 * Compact a thread: identify old turns, summarize, embed, and store
 * Returns stats about the compaction operation
 */
export interface CompactionStats {
  threadId: string;
  oldTurnsCount: number;
  summaryLength: number;
  embeddingDimensions: number;
  storedInChroma: boolean;
  durationMs: number;
}

export async function compactThread(
  threadId: string,
  threadsDir: string = DEFAULT_THREADS_DIR
): Promise<CompactionStats | null> {
  const startTime = Date.now();

  try {
    console.log(`[ThreadCompactor] Starting compaction for ${threadId}`);

    // Step 1: Identify old turns
    const oldTurns = await identifyOldTurns(threadId, threadsDir);
    if (oldTurns.length === 0) {
      console.log(`[ThreadCompactor] No old turns found for ${threadId}, skipping`);
      return null;
    }

    console.log(`[ThreadCompactor] Found ${oldTurns.length} old turns to compact`);

    // Step 2: Summarize
    const summary = await summarizeTurns(oldTurns);
    if (summary === null) {
      console.error(`[ThreadCompactor] Failed to summarize ${threadId}`);
      return null;
    }
    if (summary.length === 0) {
      console.error(`[ThreadCompactor] Ollama returned an empty summary for ${threadId}`);
      return null;
    }

    console.log(`[ThreadCompactor] Generated summary (${summary.length} chars)`);

    // Step 3: Embed
    const embedding = await embedSummary(summary);
    if (embedding === null) {
      console.error(`[ThreadCompactor] Failed to embed summary for ${threadId}`);
      return null;
    }
    if (embedding.length === 0) {
      console.error(`[ThreadCompactor] Ollama returned an empty embedding for ${threadId}`);
      return null;
    }

    console.log(`[ThreadCompactor] Generated embedding (${embedding.length} dimensions)`);

    // Step 4: Store in ChromaDB
    const stored = await storeInChroma(threadId, summary, embedding);

    const durationMs = Date.now() - startTime;

    const stats: CompactionStats = {
      threadId,
      oldTurnsCount: oldTurns.length,
      summaryLength: summary.length,
      embeddingDimensions: embedding.length,
      storedInChroma: stored,
      durationMs,
    };

    console.log(`[ThreadCompactor] Compaction complete for ${threadId} in ${durationMs}ms`);
    console.log(`[ThreadCompactor] Stats:`, JSON.stringify(stats, null, 2));

    return stats;
  } catch (error) {
    console.error(`[ThreadCompactor] Failed to compact thread ${threadId}:`, error);
    return null;
  }
}
