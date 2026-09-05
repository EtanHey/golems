#!/usr/bin/env bun
/**
 * CLI for Flux image generation via ComfyUI.
 *
 * Usage:
 *   bun packages/content/scripts/generate.ts <prompt> [options]
 *   bun packages/content/scripts/generate.ts "A futuristic city" --style social --quality social
 *   bun packages/content/scripts/generate.ts "Logo design" --style merch --quick
 *   bun packages/content/scripts/generate.ts --status    # Check ComfyUI server
 *   bun packages/content/scripts/generate.ts --models    # List available models
 */

import { parseArgs } from "util";
import { join } from "path";
import {
  generate,
  isServerReady,
  getAvailableModels,
  disconnect,
  type FluxWorkflowStyle,
} from "../src/comfyui";
import type { QualityPreset } from "../src/quality";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    style: { type: "string", short: "s", default: "base" },
    quality: { type: "string", short: "q", default: "social" },
    quick: { type: "boolean", default: false },
    output: { type: "string", short: "o" },
    project: { type: "string", short: "p" },
    retries: { type: "string", short: "r", default: "3" },
    status: { type: "boolean" },
    models: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
  strict: false,
});

async function main() {
  if (values.help) {
    console.log(`
Flux Image Generator (via ComfyUI)

Usage:
  bun generate.ts <prompt> [options]

Options:
  -s, --style <style>     Style: base, social, merch, meme (default: base)
  -q, --quality <preset>  Quality: social, print, draft (default: social)
  --quick                 Quick draft mode (512x512, fewer steps)
  -o, --output <dir>      Output directory
  -p, --project <name>    Project name (loads brand.json)
  -r, --retries <n>       Max retry attempts (default: 3)
  --status                Check ComfyUI server status
  --models                List available models
  -h, --help              Show this help

Examples:
  bun generate.ts "A beautiful sunset" --style social
  bun generate.ts "Logo design, minimalist" --style merch --quality print
  bun generate.ts "Cat meme" --style meme --quick
`);
    return;
  }

  if (values.status) {
    const ready = await isServerReady();
    if (ready) {
      console.log("ComfyUI server: READY (127.0.0.1:8188)");
    } else {
      console.log("ComfyUI server: NOT REACHABLE");
      console.log(
        "Start with: launchctl load ~/Library/LaunchAgents/com.golems.comfyui.plist",
      );
    }
    return;
  }

  if (values.models) {
    const ready = await isServerReady();
    if (!ready) {
      console.error("ComfyUI server not reachable");
      process.exit(1);
    }
    const models = await getAvailableModels();
    for (const [node, list] of Object.entries(models)) {
      console.log(`\n${node}:`);
      for (const m of list) {
        console.log(`  - ${m}`);
      }
    }
    disconnect();
    return;
  }

  const prompt = positionals.join(" ");
  if (!prompt) {
    console.error("Error: No prompt provided. Use --help for usage.");
    process.exit(1);
  }

  // Load brand config if project specified
  let brand: Record<string, unknown> | undefined;
  if (values.project) {
    const brandPath = join(
      process.env.HOME ?? "/tmp",
      "golems-content",
      values.project,
      "brand.json",
    );
    try {
      brand = await Bun.file(brandPath).json();
    } catch {
      console.warn(`No brand.json found at ${brandPath}, generating without brand`);
    }
  }

  console.log(`Generating: "${prompt}"`);
  console.log(
    `Style: ${values.style} | Quality: ${values.quality} | Quick: ${values.quick}`,
  );
  console.log("");

  try {
    const result = await generate({
      prompt,
      style: (values.style as FluxWorkflowStyle) ?? "base",
      quality: (values.quality as QualityPreset) ?? "social",
      quick: values.quick ?? false,
      outputDir: values.output as string | undefined,
      maxRetries: parseInt(values.retries as string, 10),
      brand: brand as any,
      onProgress: ({ value, max, percent }) => {
        const bar = "=".repeat(Math.floor(percent * 30));
        const empty = " ".repeat(30 - bar.length);
        process.stdout.write(`\r  [${bar}${empty}] ${value}/${max}`);
      },
    });

    console.log("\n");
    console.log(`Image saved: ${result.imagePath}`);
    console.log(`Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
    console.log(`Attempts: ${result.attempts}`);
    console.log("");
    console.log(result.scoreSummary);

    if (!result.qualityPassed) {
      console.log("\nNote: Image did not pass all quality gates. Best result returned.");
    }
  } catch (err) {
    console.error(`Generation failed: ${(err as Error).message}`);
    process.exit(1);
  } finally {
    disconnect();
  }
}

main();
