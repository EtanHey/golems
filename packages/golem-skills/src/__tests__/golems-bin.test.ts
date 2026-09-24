import { describe, test, expect, setDefaultTimeout } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// These tests spawn bun; a cold CI runner can exceed bun's 5s default.
setDefaultTimeout(15_000);

const PKG_DIR = join(import.meta.dir, "..", "..");
const REPO_ROOT = join(PKG_DIR, "..", "..");
const CLI = join(PKG_DIR, "src", "index.ts");

async function run(...args: string[]) {
  const proc = Bun.spawn(["bun", CLI, ...args], { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { stdout, stderr, exitCode: await proc.exited };
}

describe("one public CLI: npm golems-cli, bins golems + golems-cli", () => {
  test("package.json bin maps both names to the same entry", () => {
    const pkg = JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf8"));
    expect(pkg.name).toBe("golems-cli");
    expect(pkg.bin).toEqual({ golems: "./src/index.ts", "golems-cli": "./src/index.ts" });
  });

  test("setup --check dispatches to the dependency check", async () => {
    const { stdout, exitCode } = await run("setup", "--check");
    expect(stdout).toContain("Checking dependencies");
    expect(exitCode).toBe(0);
  });

  test("setup without --check prints setup usage", async () => {
    const { stdout, exitCode } = await run("setup");
    expect(stdout).toContain("golems setup --check");
    expect(exitCode).toBe(0);
  });

  // Every `golems <cmd>` the repo tells a user to run must be a real command.
  test("every quoted `golems <cmd>` in package sources and docs is a CLI command", async () => {
    const { stdout } = await run("--help");
    const commands = new Set(
      stdout
        .slice(stdout.indexOf("Commands:"), stdout.indexOf("Options:"))
        .split("\n")
        .map((line) => /^ {2}([a-z]+)\s/.exec(line)?.[1])
        .filter(Boolean),
    );
    expect(commands.has("setup")).toBe(true);

    const git = Bun.spawnSync(
      ["git", "grep", "-nE", "[`\"']golems [a-z][a-z-]*|Run: golems [a-z]|^golems [a-z][a-z-]*",
        "--", "packages/*.ts", "packages/*.md", "README.md", "CONTRIBUTING.md", ":!*.test.ts"],
      { cwd: REPO_ROOT },
    );
    const unknown = git.stdout
      .toString()
      .split("\n")
      .flatMap((hit) => [...hit.matchAll(/(?:[`"']|Run: |:\d+:)golems ([a-z][a-z-]*)/g)].map((m) => ({ hit, cmd: m[1] })))
      .filter(({ cmd }) => !commands.has(cmd))
      .map(({ hit, cmd }) => `${cmd} ← ${hit.slice(0, 120)}`);
    expect(unknown).toEqual([]);
  });
});
