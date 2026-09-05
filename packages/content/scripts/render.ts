#!/usr/bin/env bun
/**
 * Content render CLI — render Remotion compositions with brand-aware defaults.
 *
 * Usage:
 *   bun run render <compositionId> [--project <name>] [--platform youtube|linkedin|gif] [--output <path>]
 *   bun run render list
 *   bun run render preview [compositionId]
 */

import path from "path";
import { renderVideo, renderThumbnail, buildBrandProps, type PlatformPreset } from "../src/render/render-service";

const PROJECTS_DIR = path.resolve(__dirname, "../projects");

// Available compositions (from Root.tsx)
const COMPOSITIONS = [
  "CodeShowcase", "CodeShowcase-LinkedIn",
  "ArchDiagram", "ArchDiagram-LinkedIn",
  "MetricsDashboard", "MetricsDashboard-LinkedIn", "MetricsDashboard-GIF",
  "ProductHero", "ProductHero-LinkedIn",
];

// Platform suffix mapping
const PLATFORM_SUFFIX: Record<PlatformPreset, string> = {
  youtube: "",
  linkedin: "-LinkedIn",
  gif: "-GIF",
};

const PLATFORM_FORMAT: Record<PlatformPreset, { ext: string; codec?: string; everyNth?: number }> = {
  youtube: { ext: "mp4", codec: "h264" },
  linkedin: { ext: "mp4", codec: "h264" },
  gif: { ext: "gif", everyNth: 2 },
};

// --- Commands ---

function printUsage() {
  console.log(`
Content Render CLI

Commands:
  render <compositionId>  Render a composition to video/image
  list                    List available compositions and projects
  still <compositionId>   Render a single frame (thumbnail)
  preview [compositionId] Open Remotion Studio

Options:
  --project <name>    Use brand.json from projects/<name>/
  --platform <preset> youtube (default), linkedin, gif
  --output <path>     Custom output path
  --frame <number>    Frame for still (default: 60)

Examples:
  bun run scripts/render.ts render CodeShowcase --project golems-showcase
  bun run scripts/render.ts list
  bun run scripts/render.ts still MetricsDashboard --project golems-showcase --frame 90
  `);
}

async function listCommand() {
  console.log("\nAvailable Compositions:");
  console.log("─".repeat(50));
  for (const id of COMPOSITIONS) {
    console.log(`  ${id}`);
  }

  console.log("\nAvailable Projects:");
  console.log("─".repeat(50));

  const glob = new Bun.Glob("*/brand.json");
  for await (const match of glob.scan(PROJECTS_DIR)) {
    const projectName = path.dirname(match);
    console.log(`  ${projectName}`);
  }
  console.log();
}

async function renderCommand(args: string[]) {
  const compositionArg = args[0];
  if (!compositionArg) {
    console.error("Error: composition ID required");
    printUsage();
    process.exit(1);
  }

  // Parse flags
  const flags: Record<string, string> = {};
  for (let i = 1; i < args.length; i += 2) {
    if (args[i].startsWith("--") && args[i + 1]) {
      flags[args[i].slice(2)] = args[i + 1];
    }
  }

  const platform = (flags.platform ?? "youtube") as PlatformPreset;
  const projectName = flags.project;

  // Build composition ID with platform suffix
  const suffix = PLATFORM_SUFFIX[platform] ?? "";
  let compositionId = compositionArg;
  if (suffix && !compositionId.endsWith(suffix)) {
    const platformVariant = `${compositionId}${suffix}`;
    if (COMPOSITIONS.includes(platformVariant)) {
      compositionId = platformVariant;
    }
  }

  // Check composition exists
  if (!COMPOSITIONS.includes(compositionId)) {
    console.error(`Error: Unknown composition "${compositionId}"`);
    console.error(`Available: ${COMPOSITIONS.join(", ")}`);
    process.exit(1);
  }

  // Build output path
  const platFormat = PLATFORM_FORMAT[platform];
  const outputDir = projectName
    ? path.join(PROJECTS_DIR, projectName, "outputs")
    : path.resolve(__dirname, "../out");
  await Bun.write(path.join(outputDir, ".gitkeep"), "");
  const outputPath = flags.output ?? path.join(outputDir, `${compositionId}.${platFormat.ext}`);

  // Load brand if project specified
  let inputProps: Record<string, unknown> = {};
  if (projectName) {
    const projectPath = path.join(PROJECTS_DIR, projectName);
    const brandResult = await buildBrandProps(projectPath);
    if (brandResult) {
      inputProps.brand = brandResult.brand;
      console.log(`Using brand from ${projectName}`);
    } else {
      console.warn(`Warning: Could not load brand from ${projectName}, using defaults`);
    }
  }

  console.log(`Rendering ${compositionId} → ${outputPath}`);
  console.log(`Platform: ${platform}, Format: ${platFormat.ext}`);

  const job = await renderVideo({
    compositionId,
    inputProps,
    outputPath,
    format: platFormat.ext as any,
    codec: platFormat.codec as any,
    everyNthFrame: platFormat.everyNth,
    onProgress: (p) => {
      process.stdout.write(`\rProgress: ${p}%`);
    },
  });

  console.log();
  if (job.status === "done") {
    const duration = ((job.completedAt! - job.startedAt) / 1000).toFixed(1);
    console.log(`Done in ${duration}s → ${job.outputPath}`);
  } else {
    console.error(`Failed: ${job.error}`);
    process.exit(1);
  }
}

async function stillCommand(args: string[]) {
  const compositionId = args[0];
  if (!compositionId) {
    console.error("Error: composition ID required");
    process.exit(1);
  }

  const flags: Record<string, string> = {};
  for (let i = 1; i < args.length; i += 2) {
    if (args[i].startsWith("--") && args[i + 1]) {
      flags[args[i].slice(2)] = args[i + 1];
    }
  }

  const frame = parseInt(flags.frame ?? "60", 10);
  const projectName = flags.project;
  const outputDir = projectName
    ? path.join(PROJECTS_DIR, projectName, "outputs")
    : path.resolve(__dirname, "../out");
  await Bun.write(path.join(outputDir, ".gitkeep"), "");
  const outputPath = flags.output ?? path.join(outputDir, `${compositionId}-frame${frame}.png`);

  let inputProps: Record<string, unknown> = {};
  if (projectName) {
    const projectPath = path.join(PROJECTS_DIR, projectName);
    const brandResult = await buildBrandProps(projectPath);
    if (brandResult) {
      inputProps.brand = brandResult.brand;
    }
  }

  console.log(`Rendering still: ${compositionId} frame ${frame} → ${outputPath}`);

  const job = await renderThumbnail({
    compositionId,
    inputProps,
    outputPath,
    frame,
  });

  if (job.status === "done") {
    console.log(`Done → ${job.outputPath}`);
  } else {
    console.error(`Failed: ${job.error}`);
    process.exit(1);
  }
}

async function previewCommand(args: string[]) {
  const compositionId = args[0] ?? "";
  const remotionDir = path.resolve(__dirname, "../remotion");
  const cmd = compositionId
    ? `cd ${remotionDir} && bunx remotion studio src/index.ts --props '{"compositionId":"${compositionId}"}'`
    : `cd ${remotionDir} && bunx remotion studio src/index.ts`;

  console.log(`Opening Remotion Studio...`);
  console.log(`Run: ${cmd}`);

  const proc = Bun.spawn(["sh", "-c", cmd], {
    stdio: ["inherit", "inherit", "inherit"],
    cwd: remotionDir,
  });
  await proc.exited;
}

// --- Main ---

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case "render":
    await renderCommand(rest);
    break;
  case "list":
    await listCommand();
    break;
  case "still":
    await stillCommand(rest);
    break;
  case "preview":
    await previewCommand(rest);
    break;
  default:
    printUsage();
}
