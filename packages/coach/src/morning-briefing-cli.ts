#!/usr/bin/env bun
/**
 * Morning Briefing CLI — Standalone entry point.
 *
 * Usage:
 *   bun packages/coach/src/morning-briefing-cli.ts [--voice]
 *
 * Runs the morning briefing and outputs to Telegram (default) or returns
 * voice text (with --voice flag) for use by VoiceLayer.
 */

import "@golems/shared/lib/load-env";

import { runMorningBriefing } from "./morning-briefing-runner";
import { existsSync } from "fs";

const VOICELAYER_ACTIVE_FLAG = "/tmp/voicelayer-active";

async function main() {
  const args = process.argv.slice(2);
  const forceVoice = args.includes("--voice");

  // Auto-detect voice mode: CLI flag or VoiceLayer active
  const voiceActive = forceVoice || existsSync(VOICELAYER_ACTIVE_FLAG);
  const mode = voiceActive ? "voice" : "telegram";

  const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`[${timestamp}] Running morning briefing (mode: ${mode})...`);

  const result = await runMorningBriefing({ mode });

  if (result.success) {
    console.log(`Morning briefing sent via ${result.channel}`);
    if (result.voiceText) {
      // Output voice text to stdout for VoiceLayer to consume
      console.log("\n--- VOICE OUTPUT ---");
      console.log(result.voiceText);
    }
  } else {
    console.error(`Morning briefing failed: ${result.error}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Morning briefing crashed:", err);
  process.exit(1);
});
