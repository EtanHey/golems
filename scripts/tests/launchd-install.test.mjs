import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");
const labels = ["com.golemszikaron.briefing", "com.golems.worktree-gc"];
const domain = `gui/${process.getuid()}`;

function runInstaller({ loaded = false, failBootstrap = "", failBootout = false, uninstall = false } = {}, check) {
  const scratch = mkdtempSync(join(tmpdir(), "golems-launchd-install-"));
  const bin = join(scratch, "bin");
  const home = join(scratch, "home");
  const agents = join(home, "Library/LaunchAgents");
  const log = join(scratch, "launchctl.log");
  mkdirSync(bin);
  mkdirSync(agents, { recursive: true });
  // The OAuth helper invokes /bin/launchctl directly: never execute it in this fixture.
  writeFileSync(join(bin, "node"), '#!/bin/bash\nprintf "%s\\n" "$2" >> "$NODE_LOG"\n', { mode: 0o755 });
  writeFileSync(join(bin, "launchctl"), `#!/bin/bash
printf '%s\\n' "$*" >> "$LAUNCHCTL_LOG"
case "$1" in
  list) if [[ "$LOADED" == 1 ]]; then printf '%s\\n' '${labels.join("' '")}'; fi ;;
  print) [[ "$LOADED" == 1 ]] ;;
  bootout) [[ "$FAIL_BOOTOUT" != 1 ]] ;;
  bootstrap) [[ "$3" != *"$FAIL_BOOTSTRAP.plist" ]] ;;
  load|unload) exit 0 ;;
  *) exit 99 ;;
esac
`, { mode: 0o755 });
  for (const label of labels) writeFileSync(join(agents, `${label}.plist`), "old definition");

  try {
    const result = Bun.spawnSync(["bash", join(repoRoot, "launchd/install.sh"), ...(uninstall ? ["--uninstall"] : [])], {
      cwd: repoRoot,
      env: {
        ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`,
        LAUNCHCTL_LOG: log, NODE_LOG: join(scratch, "node.log"),
        LOADED: loaded ? "1" : "0", FAIL_BOOTSTRAP: failBootstrap || "no-such-label",
        FAIL_BOOTOUT: failBootout ? "1" : "0",
      },
      stdout: "pipe", stderr: "pipe",
    });
    check({
      result, agents,
      calls: readFileSync(log, "utf8").trim().split("\n"),
      helperAction: readFileSync(join(scratch, "node.log"), "utf8").trim(),
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

describe("launchd installer lifecycle (stubbed launchctl)", () => {
  test("already loaded labels boot out before bootstrapping the rendered definition", () => {
    runInstaller({ loaded: true }, ({ result, agents, calls, helperAction }) => {
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      expect(helperAction).toBe("install");
      expect(calls.filter((call) => !call.startsWith("print ") && call !== "list")).toEqual(labels.flatMap((label) => [
        `bootout ${domain}/${label}`, `bootstrap ${domain} ${join(agents, `${label}.plist`)}`,
      ]));
      for (const label of labels) {
        expect(readFileSync(join(agents, `${label}.plist`), "utf8")).toContain(resolve(agents, "../.."));
      }
      expect(result.stdout.toString()).toContain("Installed!");
    });
  });

  test("not loaded labels bootstrap without bootout", () => {
    runInstaller({}, ({ result, agents, calls }) => {
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      expect(calls.filter((call) => !call.startsWith("print ") && call !== "list")).toEqual(labels.map((label) =>
        `bootstrap ${domain} ${join(agents, `${label}.plist`)}`));
    });
  });

  for (const label of labels) {
    test(`bootstrap failure for ${label} exits nonzero and never reports Installed!`, () => {
      runInstaller({ failBootstrap: label }, ({ result }) => {
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr.toString()).toContain(label);
        expect(result.stdout.toString()).not.toContain("Installed!");
      });
    });
  }

  test("a label disappearing before bootout does not prevent bootstrap", () => {
    runInstaller({ loaded: true, failBootout: true }, ({ result, calls }) => {
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      expect(calls.filter((call) => call.startsWith("bootstrap "))).toHaveLength(labels.length);
    });
  });

  test("--uninstall still unloads loaded labels and removes their plists", () => {
    runInstaller({ loaded: true, uninstall: true }, ({ result, agents, calls, helperAction }) => {
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      expect(helperAction).toBe("uninstall");
      expect(calls).toEqual(labels.flatMap((label) => ["list", `unload ${join(agents, `${label}.plist`)}`]));
      for (const label of labels) expect(existsSync(join(agents, `${label}.plist`))).toBe(false);
      expect(result.stdout.toString()).toContain("Uninstalled!");
    });
  });
});

