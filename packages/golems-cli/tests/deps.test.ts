import { describe, test, expect } from "bun:test";
import { detectOS, checkDependency } from "../src/lib/deps";

describe("detectOS", () => {
  test("returns a known OS string", () => {
    const os = detectOS();
    expect(["darwin", "linux", "win32"]).toContain(os);
  });

  test("returns 'darwin' on macOS", () => {
    // This test will pass on macOS CI/dev machines
    if (process.platform === "darwin") {
      expect(detectOS()).toBe("darwin");
    }
  });

  test("return type is string", () => {
    expect(typeof detectOS()).toBe("string");
  });
});

describe("checkDependency", () => {
  test("finds 'bun' as installed", async () => {
    const result = await checkDependency("bun");
    expect(result.found).toBe(true);
    expect(result.name).toBe("bun");
    expect(result.path).toBeTruthy();
  });

  test("finds 'git' as installed", async () => {
    const result = await checkDependency("git");
    expect(result.found).toBe(true);
    expect(result.name).toBe("git");
    expect(result.path).toBeTruthy();
  });

  test("returns found=false for nonexistent binary", async () => {
    const result = await checkDependency("__nonexistent_binary_xyz__");
    expect(result.found).toBe(false);
    expect(result.name).toBe("__nonexistent_binary_xyz__");
    expect(result.path).toBeUndefined();
  });

  test("returns version string when available", async () => {
    const result = await checkDependency("bun");
    expect(result.version).toBeTruthy();
    expect(typeof result.version).toBe("string");
  });

  test("version is undefined for missing binary", async () => {
    const result = await checkDependency("__nonexistent_binary_xyz__");
    expect(result.version).toBeUndefined();
  });
});
