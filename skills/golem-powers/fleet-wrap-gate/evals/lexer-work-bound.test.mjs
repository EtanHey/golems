import { test, expect, setDefaultTimeout } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { effectiveArgv, parseShell, writtenText } from "../lib/shell-commands.mjs";
import { detectFleetWrap } from "../src/fleet-wrap-gate.mjs";

setDefaultTimeout(15_000);

const here = path.dirname(fileURLToPath(import.meta.url));
const command = "<<X;".repeat(100_000);

test("100k pending here-doc redirects parse within 500 ms", () => {
  const start = performance.now();
  const commands = parseShell(command);
  const elapsed = performance.now() - start;
  expect(commands).toHaveLength(100_000);
  expect(elapsed).toBeLessThan(500);
});

test("real Stop hook emits JSON for a 400 KB here-doc command within three seconds", () => {
  const hook = path.join(here, "..", "scripts", "fleet-wrap-gate-hook.mjs");
  const payload = JSON.stringify({
    hook_event_name: "Stop",
    transcript: {
      events: [{ role: "assistant", text: "Working.", tools: [{ name: "Bash", input: { command } }] }],
    },
    state: {},
  });
  expect(Buffer.byteLength(payload)).toBeLessThan(512 * 1024);
  const start = performance.now();
  const run = spawnSync("node", [hook], {
    input: payload,
    encoding: "utf8",
    timeout: 3_000,
  });
  const elapsed = performance.now() - start;
  expect(run.error).toBeUndefined();
  expect(run.status).toBe(0);
  expect(JSON.parse(run.stdout)).toEqual({});
  expect(elapsed).toBeLessThan(3_000);
});

test("newline drains 100k pending here-docs without shifting the queue", () => {
  const start = performance.now();
  const commands = parseShell(`${command}\n`);
  expect(commands).toHaveLength(100_000);
  expect(performance.now() - start).toBeLessThan(500);
});

test("large wrapper argv and here-doc output stay bounded", () => {
  const start = performance.now();
  const argv = effectiveArgv({ argv: [...Array(80_000).fill("env"), "gh", "pr", "merge"] });
  expect(argv).toEqual(["gh", "pr", "merge"]);
  expect(performance.now() - start).toBeLessThan(500);

  const body = writtenText({
    argv: ["cat"],
    redirects: [{ op: ">", target: "/safe/report.md" }],
    heredocs: Array(100_000).fill(""),
  });
  expect(body).toHaveLength(99_999);
});

test("lexer work guard discards partial DONE evidence and fails open", () => {
  expect(parseShell("gh pr merge 88", { maxWork: 1 })).toBeNull();
  const result = detectFleetWrap({
    events: [
      { role: "user", text: "finish" },
      {
        role: "assistant",
        text: "DONE — https://github.com/EtanHey/golems/pull/88 merged.",
        tools: [{ name: "Bash", input: { command: "gh pr merge 88; echo later" } }],
      },
    ],
  }, { lexerOptions: { maxWork: 1 } });
  expect(result).toEqual({ verdict: "PASS", terminal: true, violations: [] });
});

test("lexer abort preserves an independent cron-alive verdict and CLI exit 3", () => {
  const red = JSON.parse(readFileSync(path.join(here, "fixtures", "red", "01-healthwatch-cron-left-armed.json"), "utf8"));
  red.events[1].tools.push({ name: "Bash", input: { command: "gh pr merge 88; echo later" } });
  const forced = detectFleetWrap(red, { lexerOptions: { maxWork: 1 } });
  expect(forced.verdict).toBe("FLAG");
  expect(forced.violations.map((v) => v.code)).toContain("FLEETWRAP_CRON_ALIVE");

  red.events[1].tools.at(-1).input.command = " ".repeat(1_000_100);
  const cli = path.join(here, "..", "scripts", "fleet-wrap-gate-cli.mjs");
  const run = spawnSync(process.execPath, [cli, "-"], {
    input: JSON.stringify(red),
    encoding: "utf8",
    timeout: 5_000,
  });
  expect(run.error).toBeUndefined();
  expect(run.status).toBe(3);
  expect(run.stdout).toContain("FLEETWRAP_CRON_ALIVE");
});

test("150k output redirects do not exceed argument spread limits", () => {
  const result = detectFleetWrap({
    events: [{
      role: "assistant",
      text: "Working.",
      tools: [{ name: "Bash", input: { command: ">x".repeat(150_000) } }],
    }],
  });
  expect(result).toEqual({ verdict: "PASS", terminal: false, violations: [] });
});
