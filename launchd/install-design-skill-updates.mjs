import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readHost } from "../scripts/design-skill-updates.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const marker = "golems design skill updater installer";
function command(bin, args) {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  if (r.status !== 0) throw Error(`${bin} ${args[0]} failed: ${r.stderr || r.error?.message}`);
  return r.stdout;
}
const xml = (s) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
export function install({ home = homedir(), nodeBin = existsSync("/opt/homebrew/bin/node") ? "/opt/homebrew/bin/node" : process.execPath, host = readHost, run = command } = {}) {
  const h = host();
  if (h.platform !== "darwin" || h.machine !== "MacBook Pro" || /\bM1\b/.test(h.chip ?? "")) throw Error("MBP only; refusing this host");
  accessSync(nodeBin, constants.X_OK);
  const label = "com.golems.design-skill-updates", service = `gui/${process.getuid()}/${label}`;
  const state = path.join(home, ".golems/state/design-skill-updates");
  const bytes = readFileSync(path.join(root, "scripts/design-skill-updates.mjs"));
  const runner = path.join(home, ".golems/design-skill-updates", createHash("sha256").update(bytes).digest("hex"), "runner.mjs");
  const plist = path.join(home, "Library/LaunchAgents", label + ".plist");
  const prior = existsSync(plist) ? readFileSync(plist, "utf8") : null;
  if (prior && !prior.includes(marker)) throw Error(`refusing unrelated existing plist: ${plist}`);
  mkdirSync(state, { recursive: true, mode: 0o700 });
  mkdirSync(path.dirname(runner), { recursive: true });
  if (existsSync(runner) && !readFileSync(runner).equals(bytes)) throw Error("installed runner hash drift");
  writeFileSync(runner, bytes, { mode: 0o644 });
  const values = { NODE_BIN: nodeBin, RUNNER: runner, HOME: home, STATE: state, PATH: `${path.dirname(nodeBin)}:/opt/homebrew/bin:${home}/.local/bin:${home}/.bun/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin` };
  const text = readFileSync(path.join(root, "launchd", label + ".plist"), "utf8").replace(/@([A-Z_]+)@/g, (_, key) => xml(values[key]));
  mkdirSync(path.dirname(plist), { recursive: true });
  writeFileSync(plist + ".candidate", text, { mode: 0o600 });
  run("/usr/bin/plutil", ["-lint", plist + ".candidate"]);
  if (prior) copyFileSync(plist, plist + `.backup-${Date.now()}`);
  renameSync(plist + ".candidate", plist);
  if (prior) {
    try { run("/bin/launchctl", ["print", service]); run("/bin/launchctl", ["bootout", service]); }
    catch (error) { if (!error.message.includes("Could not find service")) throw error; }
  }
  run("/bin/launchctl", ["bootstrap", `gui/${process.getuid()}`, plist]);
  return { plist, runner, state, service };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(install(), null, 2)); }
  catch (error) { console.error(`ERROR install design skill updater: ${error.message}`); process.exitCode = 1; }
}
