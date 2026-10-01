import { describe, it, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { getHealthChecks } from "@golems/services/healthcheck";

describe("healthcheck", () => {
  it("runs only local service health checks after Railway retirement", () => {
    const checks = getHealthChecks();
    const names = checks.map((check) => check.name);

    expect(names).not.toContain("Telegram Bot");
    expect(names).not.toContain("Notify Server");
    expect(names).toContain("Ollama");
    expect(names).toContain("State File");
    expect(names).toContain("Launchd Jobs");
    expect(names).not.toContain("Railway Cloud");
  });
});

  it("accepts state without a destination ID and rejects invalid state", async () => {
    const home = mkdtempSync(join(import.meta.dir, ".state-home-"));
    try {
      mkdirSync(join(home, ".golems-zikaron"));
      for (const [state, expected] of [["{}", true], ["[]", false], ["null", false], ["invalid", false]] as const) {
        writeFileSync(join(home, ".golems-zikaron/state.json"), state);
        const script = `const { getHealthChecks } = await import(${JSON.stringify(join(import.meta.dir, "../healthcheck.ts"))}); console.log(JSON.stringify(await getHealthChecks().find(c => c.name === "State File").run()));`;
        const child = Bun.spawn([process.execPath, "--eval", script], {
          env: { HOME: home, PATH: process.env.PATH ?? "" }, stdout: "pipe", stderr: "pipe",
        });
        const output = await new Response(child.stdout).text();
        expect(await child.exited).toBe(0);
        expect(JSON.parse(output).ok).toBe(expected);
      }
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
