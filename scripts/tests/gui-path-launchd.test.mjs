import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
test("GUI PATH install, dry-run and uninstall are repeatable without real launchctl", {
  skip: process.platform !== "darwin" && "requires macOS plutil",
}, () => {
  mkdirSync(join(root, "docs.local"), { recursive: true });
  const fixture = mkdtempSync(join(root, "docs.local/gui-path-test-"));
  try {
    const home = join(fixture, "Home & Team");
    const bin = join(fixture, "bin");
    const log = join(fixture, "launchctl.log");
    const state = join(fixture, "loaded");
    const plist = join(home, "Library/LaunchAgents/com.golems.gui-path.plist");
    mkdirSync(bin);
    writeFileSync(join(bin, "launchctl"), `#!/bin/bash
printf '%s\\n' "$*" >> "$TEST_LOG"
case "$1" in
  print) test -f "$TEST_STATE" ;;
  bootout) rm -f "$TEST_STATE" ;;
  bootstrap) touch "$TEST_STATE" ;;
  *) exit 99 ;;
esac
`, { mode: 0o755 });
    const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`,
      NODE_BIN: process.execPath, TEST_LOG: log, TEST_STATE: state };
    const run = (args = []) => {
      const result = spawnSync("bash", [join(root, "launchd/install-gui-path.sh"), ...args], { env, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout;
    };
    const dry = run(["--dry-run"]);
    assert.equal(run(["--dry-run"]), dry);
    assert.equal(existsSync(home), false);
    assert.equal(existsSync(log), false);
    run();
    const rendered = readFileSync(plist, "utf8");
    assert.equal(spawnSync("plutil", ["-lint", plist]).status, 0);
    const parsed = JSON.parse(spawnSync("plutil", ["-convert", "json", "-o", "-", plist], { encoding: "utf8" }).stdout);
    assert.equal(parsed.Label, "com.golems.gui-path");
    assert.equal(parsed.RunAtLoad, true);
    assert.deepEqual(parsed.ProgramArguments, ["/bin/launchctl", "setenv", "PATH",
      `${home}/.local/bin:${home}/.bun/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`]);
    assert.doesNotMatch(rendered, /@[A-Z_]+@/);
    assert.doesNotMatch(rendered.replaceAll(home.replaceAll("&", "&amp;"), "HOME"), /\/Users\/[^/]+/);
    assert.doesNotMatch(readFileSync(join(root, "launchd/com.golems.gui-path.plist.in"), "utf8"), /\/Users\/[^/]+/);
    run();
    assert.equal(readFileSync(plist, "utf8"), rendered);
    const calls = readFileSync(log, "utf8");
    const domain = `gui/${process.getuid()}`;
    assert.equal(calls, `print ${domain}/com.golems.gui-path\nbootstrap ${domain} ${plist}\nprint ${domain}/com.golems.gui-path\nbootout ${domain}/com.golems.gui-path\nbootstrap ${domain} ${plist}\n`);
    run(["--uninstall", "--dry-run"]);
    assert.equal(readFileSync(log, "utf8"), calls);
    assert.equal(readFileSync(plist, "utf8"), rendered);
    run(["--uninstall"]);
    assert.equal(existsSync(plist), false);
    assert.equal(existsSync(state), false);
    run(["--uninstall"]);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
