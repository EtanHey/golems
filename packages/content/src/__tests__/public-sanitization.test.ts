import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const packageRoot = join(import.meta.dir, "../..");

describe("public content package sanitation", () => {
  it("does not expose the retired private composition or brand preset", () => {
    const retiredBrand = ["dom", "ica"].join("");
    const retiredComposition = `${retiredBrand[0].toUpperCase()}${retiredBrand.slice(1)}Hero`;
    const trackedSurfaces = [
      "src/pipeline/registry.ts",
      "scripts/render.ts",
      "src/remotion/lib/design-tokens.ts",
      "src/remotion/lib/index.ts",
      "remotion/src/Root.tsx",
      "remotion/src/lib/index.ts",
      "remotion/package.json",
      "remotion/tsconfig.json",
    ];

    for (const relativePath of trackedSurfaces) {
      const content = readFileSync(join(packageRoot, relativePath), "utf8");
      expect(content.toLowerCase()).not.toContain(retiredBrand);
    }

    expect(
      existsSync(join(packageRoot, `remotion/src/compositions/${retiredComposition}`)),
    ).toBe(false);
    expect(
      existsSync(join(packageRoot, `remotion/src/types/${retiredBrand}-ui-web.d.ts`)),
    ).toBe(false);
    expect(existsSync(join(packageRoot, "remotion/remotion.config.ts"))).toBe(
      false,
    );
  });
});
