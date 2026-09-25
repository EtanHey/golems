#!/usr/bin/env bun
// Write cmuxlayer's fleet config for a golems machine, only when it is absent.
//
// cmuxlayer (CX-2 G1) reads $CMUXLAYER_FLEET_CONFIG, else ~/.config/cmuxlayer/fleet.json;
// absent means a generic install. A golems machine needs these values or its live
// monitors in ~/.golems-zikaron are orphaned and the outbox drainer stops. An
// existing file is never touched, since it may carry a machine's own edits.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function golemsFleetConfig(home, { withWorktreeBootstrap = false } = {}) {
  const config = {
    coordinationDir: path.join(home, ".golems-zikaron"),
    outbox: true,
    outboxTitle: "golems outbox",
    seatRegistryPath: path.join(home, ".golems", "config.yaml"),
    mcpLauncher: path.join(home, ".golems", "bin", "cmuxlayer-mcp"),
    sleepGuardLabel: "com.golems.cmux-caffeinate",
    notifyUrl: "http://127.0.0.1:3847/notify",
  };
  // cmuxlayer W3 (#807): golems supplies its worktree bootstrap. Opt-in only: a
  // cmuxlayer loader older than #857 rejects unknown keys and drops the WHOLE
  // file to generic defaults, so the lead passes --with-worktree-bootstrap once
  // the installed cmuxlayer supports the key (after CX-4).
  if (withWorktreeBootstrap) {
    config.worktreeBootstrap = path.join(home, ".config", "ralphtools", "worktree-bootstrap.sh");
  }
  return config;
}

export function installCmuxlayerFleet({ home = homedir(), env = process.env, withWorktreeBootstrap = false } = {}) {
  const target = env.CMUXLAYER_FLEET_CONFIG || path.join(home, ".config", "cmuxlayer", "fleet.json");
  if (existsSync(target)) return { path: target, written: false };
  mkdirSync(path.dirname(target), { recursive: true });
  const config = golemsFleetConfig(home, { withWorktreeBootstrap });
  writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx" });
  return { path: target, written: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== "--with-worktree-bootstrap");
  if (unknown.length) {
    console.error(`install-cmuxlayer-fleet: unknown argument(s): ${unknown.join(" ")}`);
    process.exit(64);
  }
  const result = installCmuxlayerFleet({ withWorktreeBootstrap: args.includes("--with-worktree-bootstrap") });
  console.log(result.written ? `wrote ${result.path}` : `exists, left untouched: ${result.path}`);
}
