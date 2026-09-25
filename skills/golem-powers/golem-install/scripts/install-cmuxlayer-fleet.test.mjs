import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { golemsFleetConfig, installCmuxlayerFleet } from "./install-cmuxlayer-fleet.mjs";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "install-cmuxlayer-fleet.mjs");
const dirs = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function fakeHome() {
  const home = mkdtempSync(path.join(tmpdir(), "fleet-home-"));
  dirs.push(home);
  return home;
}

const G1_KEYS = [
  "coordinationDir", "outbox", "outboxTitle", "seatRegistryPath", "mcpLauncher", "sleepGuardLabel", "notifyUrl",
];

test("by default only the 7 G1 keys are written: an older cmuxlayer loader drops the whole file on an unknown key", () => {
  // Lead ruling (#231): cmuxlayer before #857 rejects unknown keys and falls back to
  // generic defaults for EVERYTHING, so worktreeBootstrap is opt-in.
  expect(Object.keys(golemsFleetConfig("/home/someone"))).toEqual(G1_KEYS);
  const home = fakeHome();
  installCmuxlayerFleet({ home, env: {} });
  const written = JSON.parse(readFileSync(path.join(home, ".config", "cmuxlayer", "fleet.json"), "utf8"));
  expect("worktreeBootstrap" in written).toBe(false);
});

test("--with-worktree-bootstrap adds the key once cmuxlayer supports it", () => {
  const config = golemsFleetConfig("/home/someone", { withWorktreeBootstrap: true });
  expect(config).toEqual({
    coordinationDir: "/home/someone/.golems-zikaron",
    outbox: true,
    outboxTitle: "golems outbox",
    seatRegistryPath: "/home/someone/.golems/config.yaml",
    mcpLauncher: "/home/someone/.golems/bin/cmuxlayer-mcp",
    sleepGuardLabel: "com.golems.cmux-caffeinate",
    notifyUrl: "http://127.0.0.1:3847/notify",
    worktreeBootstrap: "/home/someone/.config/ralphtools/worktree-bootstrap.sh",
  });
  for (const value of Object.values(config)) {
    if (typeof value === "string" && value.includes("/")) expect(value.includes("~")).toBe(false);
  }
});

test("writes ~/.config/cmuxlayer/fleet.json only when it is absent", () => {
  const home = fakeHome();
  const target = path.join(home, ".config", "cmuxlayer", "fleet.json");
  expect(installCmuxlayerFleet({ home, env: {} })).toEqual({ path: target, written: true });
  expect(JSON.parse(readFileSync(target, "utf8"))).toEqual(golemsFleetConfig(home));
});

test("never overwrites an existing fleet.json, byte for byte", () => {
  const home = fakeHome();
  const target = path.join(home, ".config", "cmuxlayer", "fleet.json");
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, '{"outbox":false}\n');
  expect(installCmuxlayerFleet({ home, env: {} })).toEqual({ path: target, written: false });
  expect(readFileSync(target, "utf8")).toBe('{"outbox":false}\n');
});

test("honours CMUXLAYER_FLEET_CONFIG, and the CLI reports what it did", () => {
  const home = fakeHome();
  const custom = path.join(home, "custom", "fleet.json");
  const first = spawnSync("bun", [script, "--with-worktree-bootstrap"], { encoding: "utf8", env: { ...process.env, HOME: home, CMUXLAYER_FLEET_CONFIG: custom } });
  expect(first.status).toBe(0);
  expect(first.stdout).toContain(`wrote ${custom}`);
  expect(JSON.parse(readFileSync(custom, "utf8")).worktreeBootstrap).toBe(
    path.join(home, ".config", "ralphtools", "worktree-bootstrap.sh"),
  );
  expect(existsSync(path.join(home, ".config", "cmuxlayer", "fleet.json"))).toBe(false);
  const second = spawnSync("bun", [script], { encoding: "utf8", env: { ...process.env, HOME: home, CMUXLAYER_FLEET_CONFIG: custom } });
  expect(second.stdout).toContain(`exists, left untouched: ${custom}`);
});
