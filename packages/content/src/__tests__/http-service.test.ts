/**
 * HTTP Service — Route Contract Tests
 *
 * Tests HTTP route validation (400 for missing fields), 404 fallback, CORS headers, health endpoint.
 * Uses the exported handleRequest function directly — no server startup needed.
 *
 * Moved from packages/orchestrator/ during Phase 9 componentization.
 */

import { describe, it, expect } from "bun:test";
import { handleRequest } from "../http-service";

function makeRequest(method: string, path: string, body?: unknown): Request {
  const opts: RequestInit = { method };
  if (body !== undefined) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  return new Request(`http://localhost:3001${path}`, opts);
}

describe("Health endpoint", () => {
  it("GET /api/health returns 200 with correct shape", async () => {
    const res = await handleRequest(makeRequest("GET", "/api/health"));
    expect(res.status).toBe(200);

    const data = (await res.json()) as Record<string, unknown>;
    expect(data.status).toBe("ok");
    expect(data.service).toBe("golems-render-service");
    expect(data.pipelines).toBeDefined();
    expect(Array.isArray(data.pipelines)).toBe(true);
  });
});

describe("CORS headers", () => {
  it("OPTIONS returns 204 with CORS headers", async () => {
    const req = new Request("http://localhost:3001/api/health", {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:3001" },
    });
    const res = await handleRequest(req);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:3001",
    );
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  it("same-origin responses echo the exact allowed origin", async () => {
    const req = new Request("http://localhost:3001/api/health", {
      headers: { Origin: "http://localhost:3001" },
    });
    const res = await handleRequest(req);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:3001",
    );
  });

  it("non-browser responses do not advertise cross-origin access", async () => {
    const res = await handleRequest(makeRequest("GET", "/api/nonexistent"));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("Local service request boundary", () => {
  it("rejects a browser request from a cross-site origin", async () => {
    const req = new Request("http://localhost:3001/api/health", {
      headers: { Origin: "https://attacker.example" },
    });

    const res = await handleRequest(req);

    expect(res.status).toBe(403);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("rejects a request carrying a non-loopback Host header", async () => {
    const req = new Request("http://localhost:3001/api/health", {
      headers: { Host: "attacker.example" },
    });

    const res = await handleRequest(req);

    expect(res.status).toBe(403);
  });
});

describe("404 fallback", () => {
  it("returns 404 for unknown routes", async () => {
    const res = await handleRequest(makeRequest("GET", "/api/nonexistent"));
    expect(res.status).toBe(404);

    const data = (await res.json()) as Record<string, unknown>;
    expect(data.error).toBe("Not found");
    expect(data.path).toBe("/api/nonexistent");
  });

  it("returns 404 for wrong method on known route", async () => {
    const res = await handleRequest(makeRequest("DELETE", "/api/health"));
    expect(res.status).toBe(404);
  });
});

describe("Input validation — ComfyUI", () => {
  it("POST /api/comfyui/generate without prompt returns 400", async () => {
    const res = await handleRequest(
      makeRequest("POST", "/api/comfyui/generate", {}),
    );
    expect(res.status).toBe(400);

    const data = (await res.json()) as Record<string, unknown>;
    expect(data.error).toBe("prompt is required");
  });

  it("POST /api/comfyui/generate with empty prompt returns 400", async () => {
    const res = await handleRequest(
      makeRequest("POST", "/api/comfyui/generate", { prompt: "" }),
    );
    expect(res.status).toBe(400);
  });
});

describe("Input validation — Pipeline", () => {
  it("POST /api/pipeline/route without idea returns 400", async () => {
    const res = await handleRequest(
      makeRequest("POST", "/api/pipeline/route", {}),
    );
    expect(res.status).toBe(400);

    const data = (await res.json()) as Record<string, unknown>;
    expect(data.error).toBe("idea is required");
  });

  it("POST /api/pipeline/execute without idea returns 400", async () => {
    const res = await handleRequest(
      makeRequest("POST", "/api/pipeline/execute", {}),
    );
    expect(res.status).toBe(400);

    const data = (await res.json()) as Record<string, unknown>;
    expect(data.error).toBe("idea is required");
  });
});

describe("Input validation — DataViz", () => {
  it("POST /api/dataviz/render with unknown type returns 400", async () => {
    const res = await handleRequest(
      makeRequest("POST", "/api/dataviz/render", { type: "invalid-type" }),
    );
    expect(res.status).toBe(400);

    const data = (await res.json()) as Record<string, unknown>;
    expect(data.error).toContain("Unknown type");
  });
});
