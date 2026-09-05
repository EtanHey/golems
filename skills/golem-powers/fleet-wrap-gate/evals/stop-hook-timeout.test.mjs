import { test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const skillsRoot = path.resolve(here, "..", "..");
const stopPolicyGates = [
  "idle-dwell-gate",
  "fleet-wrap-gate",
  "monitor-law-gate",
  "false-green-gate",
  "qa-verdict-gate",
];

test("all five stop-policy gates budget five seconds for cold/contention startup", () => {
  for (const gate of stopPolicyGates) {
    const snippetPath = path.join(skillsRoot, gate, "install-snippet.json");
    expect(existsSync(snippetPath), `${gate} must publish its hook wiring`).toBe(true);
    const snippet = JSON.parse(readFileSync(snippetPath, "utf8"));
    expect(snippet.entry.hooks[0].timeout, gate).toBeGreaterThanOrEqual(5);
  }
});
