import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(here, "pipeline_fixture.py");
const harnessPath = process.env.SKILL_CREATOR_SMOKE_HARNESS;
if (!harnessPath) {
  throw new Error("SKILL_CREATOR_SMOKE_HARNESS must point to smoke-harness.js");
}
const { replaySmoke } = await import(pathToFileURL(harnessPath).href);

async function runFixture() {
  const { stdout } = await execFileAsync(process.env.PYTHON ?? "python3", [fixture], {
    cwd: resolve(here, "..", ".."),
    env: { ...process.env },
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

const first = await runFixture();
const second = await runFixture();
if (first !== second) {
  throw new Error("pipeline fixture is not byte-stable across replay runs");
}

const report = replaySmoke({
  skill: "quick-deep-research",
  withoutTranscript: { result: "baseline search output: sources only, no graph, no conflict, no cited report" },
  withTranscript: { result: first },
  assertions: [
    {
      id: "has-report",
      category: "compliance",
      kind: "includes",
      value: "\"report\"",
    },
    {
      id: "flags-conflict",
      category: "compliance",
      kind: "includes",
      value: "\"conflict\":true",
    },
    {
      id: "cites-s1",
      category: "compliance",
      kind: "includes",
      value: "[S1]",
    },
    {
      id: "cites-s2",
      category: "compliance",
      kind: "includes",
      value: "[S2]",
    },
  ],
});

const output = {
  byteStable: true,
  sha256: createHash("sha256").update(first).digest("hex"),
  verdict: report.verdict,
  withOverall: report.with.overall,
  assertions: report.with.results,
};

console.log(JSON.stringify(output, null, 2));

if (report.verdict.label !== "SHIP") {
  throw new Error(`smoke verdict failed: ${report.verdict.label} ${report.verdict.reason}`);
}
