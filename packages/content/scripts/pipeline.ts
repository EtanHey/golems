#!/usr/bin/env bun
/**
 * Pipeline Intelligence CLI
 *
 * Usage:
 *   bun run pipeline route "Create a weekly job market infographic"
 *   bun run pipeline route "Animated code demo of the new API" --execute
 *   bun run pipeline stats
 *   bun run pipeline list
 */

import { getRegistry, routeIdea, executePlan, getPerformanceStats } from "../src/pipeline";
import type { OutputFormat } from "../src/pipeline";

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === "--help") {
  console.log(`
Pipeline Intelligence CLI

Commands:
  route <idea> [--format png|mp4|...] [--project name] [--execute]
    Route an idea to the best pipeline. Add --execute to also run it.

  stats
    Show pipeline performance statistics.

  list
    List all available pipelines.

Examples:
  bun run pipeline route "Weekly job market bar chart"
  bun run pipeline route "Animated code demo" --execute
  bun run pipeline route "Generate a meme about TypeScript" --format png
  bun run pipeline stats
`);
  process.exit(0);
}

async function main() {
  switch (command) {
    case "route": {
      const idea = args[1];
      if (!idea) {
        console.error("Error: idea is required. Usage: bun run pipeline route \"your idea\"");
        process.exit(1);
      }

      const format = args.includes("--format")
        ? args[args.indexOf("--format") + 1] as OutputFormat
        : undefined;
      const project = args.includes("--project")
        ? args[args.indexOf("--project") + 1]
        : undefined;
      const shouldExecute = args.includes("--execute");

      console.log(`Routing: "${idea}"`);
      if (format) console.log(`  Preferred format: ${format}`);
      if (project) console.log(`  Project: ${project}`);
      console.log();

      const result = await routeIdea({
        idea,
        preferredFormat: format,
        project,
      });

      console.log(`Confidence: ${(result.confidence * 100).toFixed(0)}%`);
      console.log(`Multi-pipeline: ${result.isMultiPipeline ? "yes" : "no"}`);
      console.log(`Reasoning: ${result.reasoning}`);
      console.log();

      for (const step of result.steps) {
        console.log(`  Pipeline: ${step.pipelineId}`);
        console.log(`  Reason: ${step.reason}`);
        console.log(`  Output: ${step.outputFormat}`);
        if (Object.keys(step.params).length > 0) {
          console.log(`  Params: ${JSON.stringify(step.params)}`);
        }
        console.log();
      }

      if (shouldExecute) {
        console.log("Executing pipeline...");
        const execResult = await executePlan(result, {
          project,
          trackRun: true,
        });

        if (execResult.success) {
          console.log(`Done in ${execResult.totalDurationMs}ms`);
          for (const output of execResult.outputs) {
            console.log(`  ${output.pipelineId}: ${output.outputPath ?? "(base64)"} [${output.mimeType}]`);
          }
        } else {
          console.error(`Execution failed: ${execResult.error}`);
          process.exit(1);
        }
      }
      break;
    }

    case "stats": {
      const stats = await getPerformanceStats();
      if (stats.length === 0) {
        console.log("No pipeline runs recorded yet.");
        break;
      }

      console.log("Pipeline Performance Stats\n");
      for (const s of stats) {
        console.log(`  ${s.pipelineId}`);
        console.log(`    Runs: ${s.totalRuns} (${s.successfulRuns} successful)`);
        console.log(`    Success rate: ${(s.successRate * 100).toFixed(0)}%`);
        console.log(`    Avg quality: ${s.avgQualityScore.toFixed(1)}`);
        console.log(`    Avg duration: ${(s.avgDurationMs / 1000).toFixed(1)}s`);
        console.log(`    Top types: ${s.topIdeaTypes.join(", ")}`);
        console.log();
      }
      break;
    }

    case "list": {
      const registry = getRegistry();
      console.log("Available Pipelines\n");
      for (const p of registry.pipelines) {
        console.log(`  ${p.id} — ${p.name}`);
        console.log(`    ${p.description}`);
        console.log(`    Inputs: ${p.inputs.join(", ")}`);
        console.log(`    Outputs: ${p.outputs.join(", ")}`);
        console.log(`    Speed: ${p.speed}/10  Quality: ${p.quality}/10  Cost: ${p.cost}/10`);
        console.log(`    Best for: ${p.bestFor.join(", ")}`);
        console.log();
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}. Use --help for usage.`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
