import { describe, expect, it } from "bun:test";

import { resolveMLXBaseURL } from "../lib/mlx-llm";

describe("MLX endpoint configuration", () => {
  it("defaults to port 8081 while preserving the MLX_URL override", () => {
    expect(resolveMLXBaseURL({})).toBe("http://127.0.0.1:8081");
    expect(resolveMLXBaseURL({ MLX_URL: "http://127.0.0.1:9090" })).toBe(
      "http://127.0.0.1:9090",
    );
  });
});
