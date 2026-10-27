import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dirs = [];
afterEach(() => dirs.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));
function fixture({ changed = false, existing = false, fail = false, symlink = false } = {}) {
  const state = mkdtempSync(path.join(tmpdir(), "design-runner-")); dirs.push(state);
  const calls = [], logFile = path.join(state, "run.log");
  const run = (bin, args, cwd) => {
    calls.push([bin, ...args]);
    if (fail) throw Error("simulated command failure");
    if (args[0] === "clone") {
      const dir = args.at(-1); mkdirSync(path.join(dir, "skills/vendor"), { recursive: true });
      if (symlink && dir.endsWith("anthropic")) {
        rmSync(path.join(dir, "skills"), { recursive: true });
        mkdirSync(path.join(state, "outside")); symlinkSync(path.join(state, "outside"), path.join(dir, "skills"));
      }
    }
    if (args[0] === "rev-parse") return "a".repeat(40);
    if (args[0] === "pr" && args[1] === "list") return existing ? '[{"url":"https://example.test/existing"}]' : '[]';
    if (args[0] === "pr" && args[1] === "create") return "https://github.com/EtanHey/golems/pull/123";
    if (args[0] === "diff") return "5\t2\tskills/vendor/example.md\n";
    return "";
  };
  return { state, logFile, calls, run, host: () => ({ platform: "darwin", machine: "MacBook Pro", chip: "Apple M4 Max" }), refresh: async () => ({ changed }) };
}

test("unchanged payload is a logged no-op with no GitHub writes", async () => {
  const { update } = await import("../design-skill-updates.mjs"), f = fixture();
  const result = await update(f);
  expect(result.status).toBe("NOOP");
  expect(readFileSync(f.logFile, "utf8")).toContain("NOOP");
  expect(f.calls.some((c) => c.includes("create") || c.includes("push"))).toBe(false);
});

test("changed payload creates one normal PR with gh credentials, no merge/approve/force", async () => {
  const { update } = await import("../design-skill-updates.mjs"), f = fixture({ changed: true });
  expect((await update(f)).status).toBe("PR_OPENED");
  expect(f.calls.filter((c) => c[0] === "gh" && c[2] === "create")).toHaveLength(1);
  expect(f.calls.flat()).toContain("credential.helper=!gh auth git-credential");
  expect(f.calls.find((c) => c[0] === "bash" && c[2] === "compute")?.[3]).toBe("123");
  expect(f.calls.flat()).not.toContain("--force");
  expect(f.calls.flat()).not.toContain("merge");
  expect(f.calls.flat()).not.toContain("approve");
  expect(f.calls.flat()).not.toContain("token");
});

test("an existing proposal is not reopened or pushed", async () => {
  const { update } = await import("../design-skill-updates.mjs"), f = fixture({ changed: true, existing: true });
  expect((await update(f)).status).toBe("NOOP");
  expect(f.calls.some((c) => c.includes("create") || c.includes("push"))).toBe(false);
});

test("failures log ERROR and propagate to the CLI's nonzero exit", async () => {
  const { update } = await import("../design-skill-updates.mjs"), f = fixture({ fail: true });
  await expect(update(f)).rejects.toThrow("simulated command failure");
  expect(readFileSync(f.logFile, "utf8")).toContain("ERROR simulated command failure");
});

test("M1 and non-MacBook hosts are refused before commands", async () => {
  const { update } = await import("../design-skill-updates.mjs");
  for (const machine of [{ platform: "darwin", machine: "MacBook Pro", chip: "Apple M1 Pro" }, { platform: "linux", machine: "server", chip: "x86" }]) {
    const f = fixture(); f.host = () => machine;
    await expect(update(f)).rejects.toThrow("MBP");
    expect(f.calls).toHaveLength(0);
  }
});

test("upstream skills-root symlinks are refused before the copier", async () => {
  const { update } = await import("../design-skill-updates.mjs"), f = fixture({ symlink: true });
  let copied = false; f.refresh = async () => { copied = true; return { changed: false }; };
  await expect(update(f)).rejects.toThrow("skills root"); expect(copied).toBe(false);
});

test("CLI exits nonzero and prints ERROR even if its state directory is unusable", () => {
  const f = fixture();
  writeFileSync(f.logFile, "not a directory");
  const r = Bun.spawnSync([process.execPath, path.resolve(import.meta.dir, "../design-skill-updates.mjs")], { env: { ...process.env, HOME: f.logFile }, stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode).not.toBe(0);
  expect(r.stderr.toString()).toContain("ERROR");
});

test("installer renders daily durable MBP job and loads only its own label", async () => {
  const { install } = await import("../../launchd/install-design-skill-updates.mjs");
  const f = fixture(), calls = [];
  const result = install({ home: f.state, nodeBin: process.execPath, host: f.host, run: (bin, args) => { calls.push([bin, ...args]); return ""; } });
  const plist = readFileSync(result.plist, "utf8");
  expect(plist).toContain("<integer>10</integer>");
  expect(plist).toContain("<integer>43</integer>");
  expect(plist).not.toContain(".worktrees");
  expect(plist).not.toMatch(/@[A-Z_]+@/);
  expect(readFileSync(result.runner, "utf8")).toContain("export async function update");
  expect(calls.some((c) => c.includes("bootstrap"))).toBe(true);
  expect(calls.some((c) => c.includes("bootout"))).toBe(false);
});
