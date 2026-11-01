#!/usr/bin/env bun
/**
 * Data Visualization CLI
 *
 * Usage:
 *   bun run dataviz brain [--format linkedin|instagram|story] [--output path]
 *   bun run dataviz all [--format linkedin|instagram|story] [--output-dir path]
 */

import { parseArgs } from "util";
import { fetchBrainData } from "../src/dataviz/fetchers/brain";
import { renderLineChart } from "../src/dataviz/charts/line";
import { renderStatCards } from "../src/dataviz/charts/stat-card";
import { renderLinkedInCard } from "../src/dataviz/templates/linkedin-card";
import { renderInstagramSquare } from "../src/dataviz/templates/instagram-square";
import { renderStoryFormat } from "../src/dataviz/templates/story-format";
import { renderSvgToPng } from "../src/dataviz/renderer";
import { DEFAULT_THEME } from "../src/dataviz/charts/types";
import { mkdir } from "fs/promises";

const { positionals, values } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    format: { type: "string", short: "f", default: "linkedin" },
    output: { type: "string", short: "o" },
    "output-dir": { type: "string", default: `${process.env.HOME}/golems-content/outputs/dataviz` },
    "svg-only": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help || positionals.length === 0) {
  console.log(`Data Visualization CLI

Usage: bun run dataviz <type> [options]

Types:
  brain      BrainLayer size and store rate (its observability document)
  all        Generate all data viz types

Options:
  -f, --format    Template format: linkedin (1200x627), instagram (1080x1080), story (1080x1920)
  -o, --output    Output file path (auto-generated if omitted)
  --output-dir    Output directory (default: ~/golems-content/outputs/dataviz)
  --svg-only      Output SVG instead of PNG
  -h, --help      Show this help`);
  process.exit(0);
}

const type = positionals[0];
const format = (values.format ?? "linkedin") as "linkedin" | "instagram" | "story";
const outputDir = values["output-dir"] as string;
const svgOnly = values["svg-only"] as boolean;

await mkdir(outputDir, { recursive: true });

const timestamp = new Date().toISOString().slice(0, 10);

async function generateBrainViz(): Promise<string> {
  console.log("Fetching brain data...");
  const data = await fetchBrainData();
  if (data.state !== "measured") throw new Error(`brain data unavailable: ${data.reason}`);
  console.log(`  ${data.totalChunks} chunks, ${data.storesInWindow} stored in ${data.windowHours}h (as of ${data.generatedAt})`);

  const chartSvg = renderLineChart({
    title: `Stores per Hour, Last ${data.windowHours}h`,
    data: data.hourly.map((h) => ({ date: h.hour.slice(11, 16), value: h.count })),
    showArea: true,
    yAxisLabel: "Chunks",
  });

  const statsSvg = renderStatCards({
    stats: [
      { label: "Total Chunks", value: data.totalChunks },
      { label: `Stored (${data.windowHours}h)`, value: data.storesInWindow },
      { label: "Content Classes", value: data.contentClasses.length },
    ],
    columns: 3,
    width: format === "story" ? 1000 : format === "instagram" ? 1000 : 1120,
  });

  return wrapInTemplate("BrainLayer", `as of ${data.generatedAt?.slice(0, 16).replace("T", " ")}Z`, chartSvg, statsSvg);
}

function wrapInTemplate(title: string, dateRange: string, chartSvg: string, statsSvg: string): string {
  const common = {
    title,
    chartSvg,
    statsSvg,
    theme: DEFAULT_THEME,
    brandName: "Golems",
    brandHandle: "@EtanHey",
    dateRange,
  };

  switch (format) {
    case "instagram":
      return renderInstagramSquare(common);
    case "story":
      return renderStoryFormat({ ...common, heroValue: title.split(" ")[0] });
    default:
      return renderLinkedInCard({ ...common, subtitle: dateRange });
  }
}

async function saveSvg(svg: string, name: string): Promise<string> {
  const ext = svgOnly ? "svg" : "png";
  const outputPath = values.output ?? `${outputDir}/${name}-${format}-${timestamp}.${ext}`;

  if (svgOnly) {
    await Bun.write(outputPath, svg);
  } else {
    await renderSvgToPng({ svg, outputPath });
  }

  console.log(`  Saved: ${outputPath}`);
  return outputPath;
}

// Execute
const types = type === "all" ? ["brain"] : [type];

for (const t of types) {
  try {
    let svg: string;
    switch (t) {
      case "brain":
        svg = await generateBrainViz();
        await saveSvg(svg, "brain");
        break;
      default:
        console.error(`Unknown type: ${t}. Use: brain, all`);
    }
  } catch (err) {
    console.error(`Error generating ${t}:`, err);
  }
}

console.log("Done!");
