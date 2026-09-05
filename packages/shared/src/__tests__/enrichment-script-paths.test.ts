import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const scriptPaths = [
  "../../../../scripts/enrichment-window.sh",
  "../../../../scripts/enrichment-lazy.sh",
  "../../../../scripts/enrich.sh",
] as const;

describe("enrichment scripts", () => {
  test("use brainlayer state paths instead of stale zikaron locations", async () => {
    for (const scriptPath of scriptPaths) {
      const script = await readFile(new URL(scriptPath, import.meta.url), "utf8");

      expect(script).toContain(".local/share/brainlayer");
      expect(script).toContain("brainlayer.db");
      expect(script).not.toContain("zikaron.db");
      expect(script).not.toContain(".golems-zikaron");
      expect(script).not.toContain("zikaron-enrichment.lock");
    }
  });
});
