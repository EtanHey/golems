import { describe, it, expect } from "bun:test";

import { getHealthChecks } from "@golems/services/healthcheck";

describe("healthcheck", () => {
  it("runs only local service health checks after Railway retirement", () => {
    const checks = getHealthChecks();
    const names = checks.map((check) => check.name);

    expect(names).toContain("Telegram Bot");
    expect(names).toContain("Notify Server");
    expect(names).toContain("Ollama");
    expect(names).toContain("State File");
    expect(names).toContain("Launchd Jobs");
    expect(names).not.toContain("Railway Cloud");
  });
});
