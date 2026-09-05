import { describe, test, expect } from "bun:test";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "index.ts");

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

describe("golems-cli routing", () => {
  test("no args shows help", async () => {
    const { stdout, exitCode } = await run();
    expect(stdout).toContain("golems-cli");
    expect(stdout).toContain("skills");
    expect(stdout).toContain("mcp");
    expect(stdout).toContain("agent");
    expect(stdout).toContain("wizard");
    expect(exitCode).toBe(0);
  });

  test("--help shows help", async () => {
    const { stdout, exitCode } = await run("--help");
    expect(stdout).toContain("golems-cli");
    expect(exitCode).toBe(0);
  });

  test("-h shows help", async () => {
    const { stdout, exitCode } = await run("-h");
    expect(stdout).toContain("golems-cli");
    expect(exitCode).toBe(0);
  });

  test("--version shows version", async () => {
    const { stdout, exitCode } = await run("--version");
    expect(stdout.trim()).toBe("0.1.0");
    expect(exitCode).toBe(0);
  });

  test("-v shows version", async () => {
    const { stdout, exitCode } = await run("-v");
    expect(stdout.trim()).toBe("0.1.0");
    expect(exitCode).toBe(0);
  });

  test("unknown command shows error + help", async () => {
    const { stderr, exitCode } = await run("foobar");
    expect(stderr).toContain("Unknown command: foobar");
    expect(exitCode).toBe(1);
  });

  test("mcp explains different install workflow", async () => {
    const { stdout, exitCode } = await run("mcp");
    expect(stdout).toContain("Coming soon");
    expect(stdout).toContain(".mcp.json");
    expect(exitCode).toBe(0);
  });

  test("agent explains composite install", async () => {
    const { stdout, exitCode } = await run("agent");
    expect(stdout).toContain("Coming soon");
    expect(stdout).toContain("skills + MCPs");
    expect(exitCode).toBe(0);
  });

  test("wizard starts interactive setup", async () => {
    // Use temp HOME so we always get fresh-machine flow regardless of host config
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const tmpHome = await mkdtemp(join(tmpdir(), "wizard-cli-"));
    try {
      const proc = Bun.spawn(["bun", CLI, "wizard"], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, HOME: tmpHome },
      });
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;
      expect(stdout).toContain("Golems Setup Wizard");
      expect(stdout).toContain("Detecting installed AI CLIs");
    } finally {
      await rm(tmpHome, { recursive: true, force: true });
    }
  });

  test("help text distinguishes install workflows", async () => {
    const { stdout } = await run("--help");
    expect(stdout).toContain("~/.claude/skills/");
    expect(stdout).not.toContain("~/.claude/commands/");
    expect(stdout).toContain(".mcp.json");
    expect(stdout).toContain("Composite install");
  });

  test("backward compat: 'install' without 'skills' suggests correct command", async () => {
    const { stdout, exitCode } = await run("install", "commit");
    expect(stdout).toContain("Did you mean: golems-cli skills install commit?");
    expect(exitCode).toBe(1);
  });

  test("backward compat: 'list' without 'skills' suggests correct command", async () => {
    const { stdout, exitCode } = await run("list");
    expect(stdout).toContain("Did you mean: golems-cli skills list?");
    expect(exitCode).toBe(1);
  });

  test("skills with no subcommand shows skills help", async () => {
    const { stdout, exitCode } = await run("skills");
    expect(stdout).toContain("golems-cli skills");
    expect(stdout).toContain("install");
    expect(stdout).toContain("uninstall");
    expect(exitCode).toBe(0);
  });

  test("skills unknown subcommand shows error", async () => {
    const { stderr, exitCode } = await run("skills", "foobar");
    expect(stderr).toContain("Unknown skills command: foobar");
    expect(exitCode).toBe(1);
  });
});
