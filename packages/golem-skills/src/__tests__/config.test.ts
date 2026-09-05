import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, createDefaultConfig } from "../config";

describe("config module", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "golem-skills-test-"));
    configPath = join(tmpDir, "config.json");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("loadConfig()", () => {
    test("returns null when config file does not exist", async () => {
      const result = await loadConfig(join(tmpDir, "nonexistent.json"));
      expect(result).toBeNull();
    });

    test("parses existing config correctly", async () => {
      await writeFile(
        configPath,
        JSON.stringify({
          reposPath: "/Users/test/Gits",
          tools: { claude: "/usr/local/bin/claude" },
        }),
      );

      const config = await loadConfig(configPath);
      expect(config).not.toBeNull();
      expect(config!.reposPath).toBe("/Users/test/Gits");
      expect(config!.tools?.claude).toBe("/usr/local/bin/claude");
    });

    test("returns null for malformed JSON", async () => {
      await writeFile(configPath, "this is not json");
      const result = await loadConfig(configPath);
      expect(result).toBeNull();
    });
  });

  describe("createDefaultConfig()", () => {
    test("writes config file with reposPath and tools", async () => {
      await createDefaultConfig(configPath, {
        reposPath: "~/Projects",
        tools: { claude: "/usr/local/bin/claude" },
      });

      const raw = await readFile(configPath, "utf8");
      const parsed = JSON.parse(raw);
      expect(parsed.reposPath).toBe("~/Projects");
      expect(parsed.tools.claude).toBe("/usr/local/bin/claude");
    });

    test("creates parent directory if it doesn't exist", async () => {
      const nestedPath = join(tmpDir, "nested", "dir", "config.json");
      await createDefaultConfig(nestedPath, {
        reposPath: "~/Projects",
        tools: {},
      });

      const raw = await readFile(nestedPath, "utf8");
      expect(JSON.parse(raw).reposPath).toBe("~/Projects");
    });

    test("does NOT overwrite existing config", async () => {
      await writeFile(
        configPath,
        JSON.stringify({ reposPath: "/existing/path" }),
      );
      await createDefaultConfig(configPath, {
        reposPath: "~/Projects",
        tools: {},
      });

      const raw = await readFile(configPath, "utf8");
      expect(JSON.parse(raw).reposPath).toBe("/existing/path");
    });
  });
});
