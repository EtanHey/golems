#!/usr/bin/env bun
/**
 * Morning Briefing CLI — Standalone entry point.
 *
 * Usage:
 *   bun packages/coach/src/morning-briefing-cli.ts --voice
 *
 * Requires --voice and returns voice text for use by VoiceLayer.
 */

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] !== "--voice") {
    console.error("Morning briefing requires --voice; background notifications are retired.");
    process.exit(1);
  }
  await import("@golems/shared/lib/load-env");
  const { runMorningBriefing } = await import("./morning-briefing-runner");
  const mode = "voice";

  const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`[${timestamp}] Running morning briefing (mode: ${mode})...`);

  const result = await runMorningBriefing({ mode });

  if (result.success) {
    console.log(`Morning briefing prepared for ${result.channel}`);
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
