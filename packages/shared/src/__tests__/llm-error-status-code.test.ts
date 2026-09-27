import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as axiom from "@golems/shared/lib/axiom";
import { runMLX } from "@golems/shared/lib/mlx-llm";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});

describe("LLM error events carry the HTTP status code", () => {
  it("MLX passes resp.status as status_code", async () => {
    const logError = spyOn(axiom, "logError").mockImplementation(() => {});
    globalThis.fetch = mock(async () =>
      Response.json({ error: { message: "bad request" } }, { status: 503 }),
    ) as unknown as typeof globalThis.fetch;

    expect(await runMLX("hello", "test")).toBeNull();
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ error_type: "mlx_api_error", status_code: 503 }),
    );
  });
});
