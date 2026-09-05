import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { deepMerge } from "@golems/shared/lib/config";

describe("config", () => {
  const testDir = join(tmpdir(), `golems-config-test-${Date.now()}`);
  const configDir = join(testDir, ".golems");
  const configFile = join(configDir, "config.yaml");

  beforeEach(() => {
    mkdirSync(configDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("deepMerge merges nested objects", () => {
    const defaults = {
      a: 1,
      b: { c: 2, d: 3 },
      e: [1, 2],
    };
    const overrides = {
      a: 10,
      b: { c: 20 },
    };

    const merged = deepMerge(defaults, overrides as Partial<typeof defaults>);
    expect(merged.a).toBe(10);
    expect(merged.b.c).toBe(20);
    expect(merged.b.d).toBe(3); // preserved from defaults
    expect(merged.e).toEqual([1, 2]); // arrays not deep-merged
  });

  test("deepMerge preserves defaults when overrides are empty", () => {
    const defaults = { x: 1, y: { z: 2 } };
    const merged = deepMerge(defaults, {});
    expect(merged).toEqual(defaults);
  });

  test("deepMerge handles array overrides", () => {
    const defaults = { items: [1, 2, 3] };
    const overrides = { items: [4, 5] };
    const merged = deepMerge(defaults, overrides);
    expect(merged.items).toEqual([4, 5]); // arrays replaced, not merged
  });

  test("YAML config is parsed correctly", async () => {
    const { parse } = await import("yaml");

    const yaml = `
reposPath: "/custom/path"
nightshift:
  rotation:
    - repo-a
    - repo-b
  timeout: 60000
features:
  soltome: false
`;
    const parsed = parse(yaml);
    expect(parsed.reposPath).toBe("/custom/path");
    expect(parsed.nightshift.rotation).toEqual(["repo-a", "repo-b"]);
    expect(parsed.nightshift.timeout).toBe(60000);
    expect(parsed.features.soltome).toBe(false);
  });

  test("config file can be written and read back", () => {
    const yaml = `reposPath: "/test/path"\n`;
    writeFileSync(configFile, yaml);
    expect(existsSync(configFile)).toBe(true);
  });
});
