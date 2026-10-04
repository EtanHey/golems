import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import {
  buildHealthResponse,
  buildReadyResponse,
} from "@golems/services/health";

describe("cloud-worker health endpoints", () => {
  describe("buildHealthResponse", () => {
    it("returns 200 when golem status is running", () => {
      const { status, body } = buildHealthResponse({
        golemStatus: "running",
        startTime: Date.now() - 60_000,
      });
      expect(status).toBe(200);
      expect(body.status).toBe("ok");
      expect(body.golemStatus).toBe("running");
    });

    it("returns 503 when golem status is loading", () => {
      const { status, body } = buildHealthResponse({
        golemStatus: "loading",
        startTime: Date.now(),
      });
      expect(status).toBe(503);
      expect(body.status).toBe("degraded");
    });

    it("returns 503 when golem status starts with error", () => {
      const { status, body } = buildHealthResponse({
        golemStatus: "error: Failed to load",
        startTime: Date.now() - 60_000,
      });
      expect(status).toBe(503);
      expect(body.status).toBe("error");
      expect(body.golemStatus).toContain("error");
    });
  });

  describe("buildReadyResponse", () => {
    it("returns 200 when running and DB is connected", () => {
      const { status, body } = buildReadyResponse({
        golemStatus: "running",
        dbConnected: true,
      });
      expect(status).toBe(200);
      expect(body.ready).toBe(true);
    });

    it("returns 503 when DB is not connected", () => {
      const { status, body } = buildReadyResponse({
        golemStatus: "running",
        dbConnected: false,
      });
      expect(status).toBe(503);
      expect(body.ready).toBe(false);
      expect(body.checks.db).toBe(false);
    });

    it("returns 503 when golem status is not running", () => {
      const { status, body } = buildReadyResponse({
        golemStatus: "loading",
        dbConnected: true,
      });
      expect(status).toBe(503);
      expect(body.ready).toBe(false);
    });
  });
});

// Capture the production handler before scheduler startup; no listener or service runs.
describe("retired webhook", () => {
  it("returns 404 even with a configured old secret, without sending", async () => {
    const worker = join(import.meta.dir, "../cloud-worker.ts");
    const script = `
      let handler;
      let sends = 0;
      const stop = new Error("handler captured");
      Bun.serve = (options) => { handler = options.fetch; throw stop; };
      globalThis.fetch = async () => { sends++; throw new Error("network forbidden"); };
      try { await import(${JSON.stringify(worker)}); } catch (error) {
        if (error !== stop) throw error;
      }
      const result = await handler(new Request("http://fixture/webhook/uptimerobot/synthetic-token", {
        method: "POST", body: "alertType=1", headers: { "content-type": "application/x-www-form-urlencoded" }
      }));
      const health = await handler(new Request("http://fixture/health"));
      console.log(JSON.stringify({ status: result.status, sends, health: health.status, body: await health.json() }));
    `;
    const child = Bun.spawn([process.execPath, "--eval", script], {
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", UPTIMEROBOT_WEBHOOK_SECRET: "synthetic-token" },
      stdout: "pipe", stderr: "pipe",
    });
    const output = await new Response(child.stdout).text();
    const errors = await new Response(child.stderr).text();
    expect(await child.exited, errors).toBe(0);
    const result = JSON.parse(output.trim().split("\n").at(-1)!);
    expect(result.status).toBe(404);
    expect(result.sends).toBe(0);
    expect(result.health).toBe(503);
    expect(result.body).not.toHaveProperty("telegramMode");
  });
});
