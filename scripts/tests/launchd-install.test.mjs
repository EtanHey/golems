import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");
const retired = "com.golemszikaron.briefing";
const activeLabels = ["com.golems.worktree-gc", "com.golems.agent-browser-reap"];
const labels = [retired, ...activeLabels];
const domain = `gui/${process.getuid()}`;

function runInstaller({ loaded = false, failBootstrap = "", failBootout = false, uninstall = false, unloadDelay = 0, prefixOnly = false } = {}, check) {
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
  list) if [[ "$PREFIX_ONLY" == 1 ]]; then printf '%s\\n' 'com.golemszikaron.briefing.extra' 'com.golems.worktree-gc.extra'; elif [[ "$LOADED" == 1 ]]; then printf '%s\\n' '${labels.join("' '")}'; fi ;;
  print)
    [[ "$PREFIX_ONLY" != 1 ]] || exit 1
    [[ "$LOADED" == 1 ]] || exit 1
    state="$LAUNCHCTL_LOG.$(basename "$2")"
    [[ -f "$state" ]] || exit 0
    remaining=$(cat "$state")
    [[ "$remaining" -gt 0 ]] || exit 1
    echo "$((remaining - 1))" > "$state"
    ;;
  bootout)
    echo "$UNLOAD_DELAY" > "$LAUNCHCTL_LOG.$(basename "$2")"
    [[ "$FAIL_BOOTOUT" != 1 ]] ;;
  bootstrap)
    state="$LAUNCHCTL_LOG.$(basename "$3" .plist)"
    if [[ -f "$state" && $(cat "$state") -gt 0 ]]; then exit 5; fi
    [[ "$3" != *"$FAIL_BOOTSTRAP.plist" ]] ;;
  load|unload) exit 0 ;;
  *) exit 99 ;;
esac
`, { mode: 0o755 });
  // Fail if a loaded job's plist is removed before bootout has completed.
  writeFileSync(join(bin, "rm"), `#!/bin/bash
printf '%s\\n' "rm $*" >> "$LAUNCHCTL_LOG"
if [[ "$LOADED" == 1 && "$PREFIX_ONLY" != 1 ]]; then
  state="$LAUNCHCTL_LOG.$(basename "$1" .plist)"
  [[ -f "$state" && $(cat "$state") == 0 ]] || exit 88
fi
/bin/rm "$@"
`, { mode: 0o755 });
  for (const label of labels) writeFileSync(join(agents, `${label}.plist`), "old definition");

  try {
    const result = Bun.spawnSync(["bash", join(repoRoot, "launchd/install.sh"), ...(uninstall ? ["--uninstall"] : [])], {
      cwd: repoRoot,
      env: {
        ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`,
        LAUNCHCTL_LOG: log, NODE_LOG: join(scratch, "node.log"),
        LOADED: loaded ? "1" : "0", PREFIX_ONLY: prefixOnly ? "1" : "0", FAIL_BOOTSTRAP: failBootstrap || "no-such-label",
        FAIL_BOOTOUT: failBootout ? "1" : "0", UNLOAD_DELAY: String(unloadDelay),
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
  test("install removes the stale briefing agent and never bootstraps it", () => {
    runInstaller({ loaded: true }, ({ result, agents, calls }) => {
      const label = "com.golemszikaron.briefing";
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      expect(calls).toContain(`bootout ${domain}/${label}`);
      expect(existsSync(join(agents, `${label}.plist`))).toBe(false);
      expect(calls.some((call) => call.startsWith("bootstrap ") && call.endsWith(`${label}.plist`))).toBe(false);
    });
  });

  test("already loaded labels boot out before bootstrapping the rendered definition", () => {
    runInstaller({ loaded: true }, ({ result, agents, calls, helperAction }) => {
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      expect(helperAction).toBe("install");
      expect(calls.filter((call) => !call.startsWith("print ") && call !== "list")).toEqual([
        `bootout ${domain}/${retired}`, `rm ${join(agents, `${retired}.plist`)}`,
        ...activeLabels.flatMap((label) => [`bootout ${domain}/${label}`, `bootstrap ${domain} ${join(agents, `${label}.plist`)}`]),
      ]);
      for (const label of activeLabels) {
        expect(readFileSync(join(agents, `${label}.plist`), "utf8")).toContain(resolve(agents, "../.."));
      }
      expect(result.stdout.toString()).toContain("Installed!");
    });
  });

  test("waits for delayed unload before bootstrapping each label once", () => {
    runInstaller({ loaded: true, unloadDelay: 2 }, ({ result, calls }) => {
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      for (const label of labels) expect(calls.filter((call) => call === `print ${domain}/${label}`)).toHaveLength(5);
      for (const label of activeLabels) expect(calls.filter((call) => call.startsWith("bootstrap ") && call.endsWith(`${label}.plist`))).toHaveLength(1);
      expect(result.stdout.toString()).toContain("Installed!");
    });
  });

  test("not loaded labels bootstrap without bootout", () => {
    runInstaller({}, ({ result, agents, calls }) => {
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      expect(calls.filter((call) => !call.startsWith("print ") && call !== "list")).toEqual([
        `rm ${join(agents, `${retired}.plist`)}`,
        ...activeLabels.map((label) => `bootstrap ${domain} ${join(agents, `${label}.plist`)}`),
      ]);
    });
  });

  for (const label of activeLabels) {
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
      expect(calls.filter((call) => call.startsWith("bootstrap "))).toHaveLength(activeLabels.length);
    });
  });

  test("--uninstall waits for bootout before removing each loaded plist", () => {
    runInstaller({ loaded: true, uninstall: true, unloadDelay: 2 }, ({ result, agents, calls, helperAction }) => {
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      expect(helperAction).toBe("uninstall");
      expect(calls).toEqual(labels.flatMap((label) => [
        `print ${domain}/${label}`, `bootout ${domain}/${label}`,
        ...Array(4).fill(`print ${domain}/${label}`),
        `rm ${join(agents, `${label}.plist`)}`,
      ]));
      for (const label of labels) expect(existsSync(join(agents, `${label}.plist`))).toBe(false);
      expect(result.stdout.toString()).toContain("Uninstalled!");
    });
  });

  test("--uninstall retains plists and fails when a label stays loaded after bootout", () => {
    runInstaller({ loaded: true, uninstall: true, unloadDelay: 100 }, ({ result, agents, calls }) => {
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain(`ERROR: ${labels[0]} still loaded after bootout`);
      expect(result.stdout.toString()).not.toContain("Uninstalled!");
      expect(calls.filter((call) => call === `print ${domain}/${labels[0]}`)).toHaveLength(27);
      expect(calls.filter((call) => !call.startsWith("print "))).toEqual([`bootout ${domain}/${labels[0]}`]);
      for (const label of labels) expect(readFileSync(join(agents, `${label}.plist`), "utf8")).toBe("old definition");
    });
  }, 10000);

  for (const prefixOnly of [false, true]) {
    test(`--uninstall removes unloaded labels without bootout (prefix-only jobs: ${prefixOnly})`, () => {
      runInstaller({ uninstall: true, prefixOnly }, ({ result, agents, calls }) => {
        expect(result.exitCode, result.stderr.toString()).toBe(0);
        expect(calls).toEqual(labels.flatMap((label) => [
          `print ${domain}/${label}`, `rm ${join(agents, `${label}.plist`)}`,
        ]));
        for (const label of labels) expect(existsSync(join(agents, `${label}.plist`))).toBe(false);
        expect(result.stdout.toString()).toContain("Uninstalled!");
      });
    });
  }
});
