#!/usr/bin/env bun
/**
 * Periodic Thread Compaction Runner
 *
 * Runs hourly via launchd to compact old Ollama bot threads.
 * Scans all threads, identifies old turns, and compacts them to ChromaDB.
 */

import { readdirSync } from "fs";
import { join } from "path";
import { compactThread } from "./thread-compactor";
import type { CompactionStats } from "./thread-compactor";

const THREADS_DIR = join(process.cwd(), "data", "ollama-threads");

async function main() {
  console.log("[Compaction] Starting periodic compaction run");
  console.log(`[Compaction] Scanning threads in ${THREADS_DIR}`);

  try {
    // Get all thread files
    const files = readdirSync(THREADS_DIR).filter(f => f.endsWith(".jsonl"));
    const threadIds = files.map(f => f.replace(".jsonl", ""));

    console.log(`[Compaction] Found ${threadIds.length} thread(s) to check`);

    // Compact each thread
    const results: (CompactionStats | null)[] = [];
    for (const threadId of threadIds) {
      console.log(`[Compaction] Checking ${threadId}...`);
      const stats = await compactThread(threadId, THREADS_DIR);
      results.push(stats);

      // Small delay to avoid overwhelming Ollama
      await new Promise(r => setTimeout(r, 1000));
    }

    // Filter out null results (threads with no old turns)
    const compacted = results.filter((r): r is CompactionStats => r !== null);

    // Summary
    console.log(`\n[Compaction] Run complete`);
    console.log(`[Compaction] Threads checked: ${threadIds.length}`);
    console.log(`[Compaction] Threads compacted: ${compacted.length}`);

    if (compacted.length > 0) {
      const totalTurns = compacted.reduce((sum, s) => sum + s.oldTurnsCount, 0);
      const totalTime = compacted.reduce((sum, s) => sum + s.durationMs, 0);
      console.log(`[Compaction] Total turns compacted: ${totalTurns}`);
      console.log(`[Compaction] Total time: ${(totalTime / 1000).toFixed(1)}s`);
    }
  } catch (error) {
    console.error("[Compaction] Failed:", error);
    process.exit(1);
  }
}

main();
