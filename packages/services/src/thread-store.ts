/**
 * Thread Storage System for Ollama Bot
 *
 * Stores conversation threads as JSONL files (one line per message).
 * Each thread gets its own file: data/ollama-threads/{threadId}.jsonl
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, readdirSync } from "fs";
import { join } from "path";

const DEFAULT_THREADS_DIR = join(process.cwd(), "data", "ollama-threads");

export interface Message {
  role: string;
  content: string;
  timestamp?: string;
}

/**
 * Thread Storage Class
 */
export class ThreadStore {
  private threadsDir: string;

  constructor(threadsDir: string = DEFAULT_THREADS_DIR) {
    this.threadsDir = threadsDir;
  }

  /**
   * Append a message to a thread
   */
  async append(threadId: string, message: Message): Promise<void> {
    try {
      // Ensure directory exists
      if (!existsSync(this.threadsDir)) {
        mkdirSync(this.threadsDir, { recursive: true });
      }

      // Add timestamp if not present
      const messageWithTimestamp = {
        ...message,
        timestamp: message.timestamp || new Date().toISOString(),
      };

      // Append message as JSONL (one JSON object per line)
      const filePath = join(this.threadsDir, `${threadId}.jsonl`);
      const line = JSON.stringify(messageWithTimestamp) + "\n";
      appendFileSync(filePath, line, "utf-8");
    } catch (error) {
      console.error(`[ThreadStore] Failed to append message to ${threadId}:`, error);
      throw error;
    }
  }

  /**
   * Get the last N messages from a thread
   */
  async getRecent(threadId: string, n: number): Promise<Message[]> {
    const filePath = join(this.threadsDir, `${threadId}.jsonl`);

    // Return empty array if file doesn't exist
    if (!existsSync(filePath)) {
      return [];
    }

    try {
      // Read file and parse JSONL
      const content = readFileSync(filePath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);

      // Parse each line as JSON, skip malformed lines
      const messages: Message[] = [];
      let skippedLines = 0;

      for (const line of lines) {
        try {
          const message = JSON.parse(line);
          messages.push(message);
        } catch (error) {
          // Skip malformed line, log error
          skippedLines++;
          console.error(`[ThreadStore] Skipped malformed line in ${threadId}:`, line.substring(0, 50));
        }
      }

      if (skippedLines > 0) {
        console.warn(`[ThreadStore] Skipped ${skippedLines} malformed lines in ${threadId}`);
      }

      // Return last N messages
      return messages.slice(-n);
    } catch (error) {
      console.error(`[ThreadStore] Failed to read thread ${threadId}:`, error);
      return [];
    }
  }

  /**
   * List all thread IDs
   */
  async listThreads(): Promise<string[]> {
    // Return empty array if directory doesn't exist
    if (!existsSync(this.threadsDir)) {
      return [];
    }

    try {
      // Read directory
      const files = readdirSync(this.threadsDir);

      // Filter for .jsonl files and extract thread IDs
      const threadIds = files
        .filter((file) => file.endsWith(".jsonl"))
        .map((file) => file.replace(/\.jsonl$/, ""));

      return threadIds;
    } catch (error) {
      console.error(`[ThreadStore] Failed to list threads:`, error);
      return [];
    }
  }
}

// Export functional API for backward compatibility
export async function append(
  threadId: string,
  message: Message,
  threadsDir: string = DEFAULT_THREADS_DIR
): Promise<void> {
  const store = new ThreadStore(threadsDir);
  return store.append(threadId, message);
}

export async function getRecent(
  threadId: string,
  n: number,
  threadsDir: string = DEFAULT_THREADS_DIR
): Promise<Message[]> {
  const store = new ThreadStore(threadsDir);
  return store.getRecent(threadId, n);
}

export async function listThreads(
  threadsDir: string = DEFAULT_THREADS_DIR
): Promise<string[]> {
  const store = new ThreadStore(threadsDir);
  return store.listThreads();
}
