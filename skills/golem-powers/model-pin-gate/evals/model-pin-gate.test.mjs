// Deterministic replay gate for model-pin-gate.
// Pinned RED/GREEN fixtures cover the fleet model policy: Fable seats may spawn
// workers only with explicit cheaper/top-worker model pins; model inheritance is
// forbidden and Fable may not be pinned below apex seats.

import { test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { detectModelPin } from "../src/model-pin-gate.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const redDir = path.join(here, "fixtures", "red");
const greenDir = path.join(here, "fixtures", "green");

function loadFixtures(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ file: f, ...JSON.parse(readFileSync(path.join(dir, f), "utf8")) }));
}

const reds = loadFixtures(redDir);
const greens = loadFixtures(greenDir);

test("fixture coverage: required green and red specimens are present", () => {
  expect(greens.length).toBeGreaterThanOrEqual(6);
  expect(reds.length).toBeGreaterThanOrEqual(3);
});

test("a Fable-seat Agent call without model is blocked", () => {
  const result = detectModelPin({
    transcript: [{ type: "assistant", message: { model: "claude-fable-5" } }],
    tool_name: "Agent",
    tool_input: { prompt: "survey the repo" },
  });
  expect(result.verdict).toBe("FLAG");
  expect(result.violations.map((v) => v.code)).toContain("MODELPIN_AGENT_UNPINNED");
});

test("a non-Fable seat may call Agent without a model pin", () => {
  const result = detectModelPin({
    transcript: [{ type: "assistant", message: { model: "claude-opus-4-8" } }],
    tool_name: "Agent",
    tool_input: { prompt: "survey the repo" },
  });
  expect(result.verdict).toBe("PASS");
});

test("a Workflow with unpinned agent() calls is advisory-only, never block", () => {
  const result = detectModelPin({
    transcript: [{ type: "assistant", message: { model: "claude-fable-5" } }],
    tool_name: "Workflow",
    tool_input: { script: "agent({prompt:'a'}); agent({prompt:'b'}); agent({prompt:'c'});" },
  });
  expect(result.verdict).toBe("ADVISORY");
  expect(result.advisories.map((v) => v.code)).toContain("MODELPIN_WORKFLOW_AGENT_MODEL_ADVISORY");
  expect(result.violations.length).toBe(0);
});

test("a Fable model pin on a Task-style subagent spawn is blocked", () => {
  const result = detectModelPin({
    transcript: [{ type: "assistant", message: { model: "claude-fable-5" } }],
    tool_name: "Task",
    tool_input: { model: "claude-fable-5", prompt: "non-apex code survey" },
  });
  expect(result.verdict).toBe("FLAG");
  expect(result.violations.map((v) => v.code)).toContain("MODELPIN_FABLE_BELOW_APEX");
});

for (const fx of reds) {
  test(`RED ${fx.file} (${fx.specimen}) -> ${fx.expect}`, () => {
    const result = detectModelPin(fx.payload);
    if (fx.expect === "FLAG") {
      expect(result.verdict).toBe("FLAG");
      expect(result.violations.map((v) => v.code)).toContain(fx.violation);
    } else if (fx.expect === "ADVISORY") {
      expect(result.verdict).toBe("ADVISORY");
      expect(result.advisories.map((v) => v.code)).toContain(fx.violation);
      expect(result.violations.length).toBe(0);
    } else {
      throw new Error(`unexpected RED expectation ${fx.expect}`);
    }
  });
}

for (const fx of greens) {
  test(`GREEN ${fx.file} (${fx.specimen}) -> PASS`, () => {
    const result = detectModelPin(fx.payload);
    expect(result.verdict).toBe("PASS");
    expect(result.violations.length).toBe(0);
  });
}

test("replay is deterministic", () => {
  for (const fx of [...reds, ...greens]) {
    expect(JSON.stringify(detectModelPin(fx.payload))).toBe(JSON.stringify(detectModelPin(fx.payload)));
  }
});
