import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { validateConfig } from "../src/commands/setup";

const CLI = join(import.meta.dir, "..", "src", "index.ts");

async function run(...args: string[]) {
  const proc = Bun.spawn(["bun", CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

describe("CLI routing", () => {
  test("no args shows help", async () => {
    const { stdout, exitCode } = await run();
    expect(stdout).toContain("golems");
    expect(stdout).toContain("setup");
    expect(exitCode).toBe(0);
  });

  test("--help shows help", async () => {
    const { stdout, exitCode } = await run("--help");
    expect(stdout).toContain("golems");
    expect(exitCode).toBe(0);
  });

  test("--version shows version", async () => {
    const { stdout, exitCode } = await run("--version");
    expect(stdout.trim()).toBe("0.1.0");
    expect(exitCode).toBe(0);
  });

  test("unknown command exits with error", async () => {
    const { stderr, exitCode } = await run("foobar");
    expect(stderr).toContain("Unknown command");
    expect(exitCode).toBe(1);
  });

  test("setup command runs", async () => {
    const { stdout, exitCode } = await run("setup", "--check");
    expect(stdout).toContain("Checking dependencies");
    expect(exitCode).toBe(0);
  });
});

describe("validateConfig", () => {
  test("valid config passes", () => {
    const result = validateConfig({
      reposPath: "~/Gits",
      tools: { bun: "/opt/homebrew/bin/bun" },
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("missing reposPath fails", () => {
    const result = validateConfig({
      tools: { bun: "/opt/homebrew/bin/bun" },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("reposPath");
  });

  test("empty tools is valid", () => {
    const result = validateConfig({
      reposPath: "~/Gits",
      tools: {},
    });
    expect(result.valid).toBe(true);
  });

  test("missing tools object fails", () => {
    const result = validateConfig({
      reposPath: "~/Gits",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("tools"))).toBe(true);
  });

  test("non-string reposPath fails", () => {
    const result = validateConfig({
      reposPath: 42,
      tools: {},
    });
    expect(result.valid).toBe(false);
  });

  test("array tools fails", () => {
    const result = validateConfig({
      reposPath: "~/Gits",
      tools: ["bun"],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("tools"))).toBe(true);
  });

  test("null config fails", () => {
    const result = validateConfig(null);
    expect(result.valid).toBe(false);
  });

  test("undefined config fails", () => {
    const result = validateConfig(undefined);
    expect(result.valid).toBe(false);
  });
});
