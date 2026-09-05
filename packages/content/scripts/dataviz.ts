#!/usr/bin/env bun
/**
 * Data Visualization CLI
 *
 * Usage:
 *   bun run dataviz jobs [--format linkedin|instagram|story] [--output path]
 *   bun run dataviz finance [--format linkedin|instagram|story] [--output path]
 *   bun run dataviz brain [--format linkedin|instagram|story] [--output path]
 *   bun run dataviz activity [--format linkedin|instagram|story] [--output path]
 *   bun run dataviz all [--format linkedin|instagram|story] [--output-dir path]
 */

import { parseArgs } from "util";
import { fetchJobMarketData } from "../src/dataviz/fetchers/jobs";
import { fetchFinanceData } from "../src/dataviz/fetchers/finance";
import { fetchBrainData } from "../src/dataviz/fetchers/brain";
import { fetchActivityData } from "../src/dataviz/fetchers/activity";
import { renderBarChart } from "../src/dataviz/charts/bar";
import { renderDonutChart } from "../src/dataviz/charts/donut";
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
  jobs       Job market stats (top tags, status distribution)
  finance    LLM costs, subscriptions, email categories
  brain      Zikaron knowledge base growth and coverage
  activity   Golem events, service run stats
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

async function generateJobsViz(): Promise<string> {
  console.log("Fetching job market data...");
  const data = await fetchJobMarketData();
  console.log(`  ${data.totalJobs} jobs, ${data.topTags.length} tags`);

  const chartSvg = renderBarChart({
    title: "Top Job Tags",
    data: data.topTags.map((t) => ({ label: t.tag, value: t.count })),
    horizontal: true,
    maxBars: 8,
  });

  const statsSvg = renderStatCards({
    stats: [
      { label: "Total Jobs", value: data.totalJobs },
      { label: "Sources", value: data.scrapeStats.length },
      { label: "This Week", value: data.weeklyTrend[data.weeklyTrend.length - 1]?.newJobs ?? 0, deltaLabel: "new" },
    ],
    columns: 3,
    width: format === "story" ? 1000 : format === "instagram" ? 1000 : 1120,
  });

  return wrapInTemplate("Job Market Overview", `Week of ${timestamp}`, chartSvg, statsSvg);
}

async function generateFinanceViz(): Promise<string> {
  console.log("Fetching finance data...");
  const data = await fetchFinanceData();
  console.log(`  $${data.totalLLMCost} total LLM cost, ${data.llmCostsByModel.length} models`);

  const chartSvg = renderDonutChart({
    title: "LLM Costs by Model",
    data: data.llmCostsByModel
      .filter((m) => m.totalCost > 0)
      .map((m) => ({ label: m.model, value: Math.round(m.totalCost * 100) / 100 })),
    centerValue: `$${data.totalLLMCost.toFixed(2)}`,
    centerLabel: "Total",
  });

  const statsSvg = renderStatCards({
    stats: [
      { label: "Total LLM Cost", value: `$${data.totalLLMCost.toFixed(2)}` },
      { label: "Subscriptions/mo", value: `$${data.monthlySubscriptionTotal.toFixed(0)}` },
      { label: "Emails Processed", value: data.totalEmails },
    ],
    columns: 3,
    width: format === "story" ? 1000 : format === "instagram" ? 1000 : 1120,
  });

  return wrapInTemplate("Monthly Finance", timestamp.slice(0, 7), chartSvg, statsSvg);
}

async function generateBrainViz(): Promise<string> {
  console.log("Fetching brain data...");
  const data = await fetchBrainData();
  console.log(`  ${data.totalChunks} chunks, ${data.totalSessions} sessions, ${data.totalProjects} projects`);

  const chartSvg = renderLineChart({
    title: "Knowledge Base Growth",
    data: data.monthlyGrowth.map((g) => ({ date: g.month, value: g.chunks })),
    showArea: true,
    yAxisLabel: "Chunks",
  });

  const statsSvg = renderStatCards({
    stats: [
      { label: "Total Chunks", value: data.totalChunks },
      { label: "Sessions", value: data.totalSessions },
      { label: "Projects", value: data.totalProjects },
      { label: "Enriched", value: `${data.enrichmentPercent}%` },
    ],
    columns: 4,
    width: format === "story" ? 1000 : format === "instagram" ? 1000 : 1120,
  });

  return wrapInTemplate("Brain Growth", `${data.enrichmentPercent}% enriched`, chartSvg, statsSvg);
}

async function generateActivityViz(): Promise<string> {
  console.log("Fetching activity data...");
  const data = await fetchActivityData();
  console.log(`  ${data.totalEvents} events, ${data.golemActivity.length} golems`);

  const chartSvg = renderBarChart({
    title: "Golem Activity",
    data: data.golemActivity.slice(0, 8).map((g) => ({ label: g.actor, value: g.eventCount })),
    horizontal: true,
  });

  const statsSvg = renderStatCards({
    stats: [
      { label: "Total Events", value: data.totalEvents },
      { label: "Active Golems", value: data.golemActivity.length },
      { label: "Service Runs", value: data.serviceRuns.reduce((s, r) => s + r.totalRuns, 0) },
    ],
    columns: 3,
    width: format === "story" ? 1000 : format === "instagram" ? 1000 : 1120,
  });

  return wrapInTemplate("Golem Activity", `Last 30 days`, chartSvg, statsSvg);
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
const types = type === "all" ? ["jobs", "finance", "brain", "activity"] : [type];

for (const t of types) {
  try {
    let svg: string;
    switch (t) {
      case "jobs":
        svg = await generateJobsViz();
        await saveSvg(svg, "jobs");
        break;
      case "finance":
        svg = await generateFinanceViz();
        await saveSvg(svg, "finance");
        break;
      case "brain":
        svg = await generateBrainViz();
        await saveSvg(svg, "brain");
        break;
      case "activity":
        svg = await generateActivityViz();
        await saveSvg(svg, "activity");
        break;
      default:
        console.error(`Unknown type: ${t}. Use: jobs, finance, brain, activity, all`);
    }
  } catch (err) {
    console.error(`Error generating ${t}:`, err);
  }
}

console.log("Done!");
