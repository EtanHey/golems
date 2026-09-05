import { describe, it, expect } from "bun:test";
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
