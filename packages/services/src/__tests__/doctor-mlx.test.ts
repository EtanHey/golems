import { describe, expect, it } from "bun:test";

import { evaluateMLXModelResponse } from "../doctor";

const GOLEMS_MLX_MODEL =
  "mlx-community/Qwen2.5-Coder-14B-Instruct-4bit";

describe("MLX endpoint identity", () => {
  it("reports the configured backend unhealthy when another model is served", () => {
    const result = evaluateMLXModelResponse(
      { data: [{ id: "mlx-community/Qwen3-4B-Instruct-2507-4bit" }] },
      GOLEMS_MLX_MODEL,
      true,
    );

    expect(result.status).toBe("fail");
    expect(result.message).toContain("Qwen3-4B-Instruct-2507-4bit");
    expect(result.message).toContain("expected");
    expect(result.message).toContain(GOLEMS_MLX_MODEL);
  });
});
