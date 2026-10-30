import { spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = "EtanHey/golems";
const sources = ["https://github.com/anthropics/claude-plugins-official.git", "https://github.com/emilkowalski/skills.git"];
function command(bin, args, cwd) {
  const env = { ...process.env, PATH: "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin", GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0", GH_NO_UPDATE_NOTIFIER: "1" };
  const r = spawnSync(bin, args, { cwd, env, encoding: "utf8", timeout: 300000, maxBuffer: 8 * 1024 * 1024 });
  if (r.status !== 0) throw Error(`${bin} ${args[0]} failed (${r.status ?? r.error?.code}): ${r.stderr?.trim().slice(-2000) || "no stderr"}`);
  return r.stdout.trim();
}
export function readHost() {
  if (process.platform !== "darwin") return { platform: process.platform };
  const h = JSON.parse(command("/usr/sbin/system_profiler", ["SPHardwareDataType", "-json"])).SPHardwareDataType[0];
  return { platform: process.platform, machine: h.machine_name, chip: h.chip_type };
}
export async function update({ state, logFile, run = command, host = readHost, refresh, tools = { gh: process.env.GOLEMS_GH ?? "/opt/homebrew/bin/gh", git: process.env.GOLEMS_GIT ?? "/usr/bin/git" } } = {}) {
  mkdirSync(state, { recursive: true, mode: 0o700 });
  mkdirSync(path.dirname(logFile), { recursive: true });
  const log = (message) => { const line = `${new Date().toISOString()} ${message}\n`; appendFileSync(logFile, line, { mode: 0o600 }); process.stdout.write(line); };
  let work;
  try {
    const h = host();
    if (h.platform !== "darwin" || h.machine !== "MacBook Pro" || /\bM1\b/.test(h.chip ?? "")) throw Error("MBP only; M1 and other hosts are refused");
    const { gh, git } = tools;
    if (![gh, git].every((bin) => typeof bin === "string" && path.isAbsolute(bin))) throw Error("gh and git must be pinned absolute paths");
    for (const file of [logFile, path.join(state, "launchd.stdout.log"), path.join(state, "launchd.stderr.log")]) {
      // Preserve launchd's open descriptors; retain only one previous log.
      if (existsSync(file) && statSync(file).size >= 1024 * 1024) { copyFileSync(file, file + ".1"); truncateSync(file, 0); }
    }
    log("START design skill update (existing gh login)");
    run(gh, ["auth", "status", "--hostname", "github.com"]);
    work = mkdtempSync(path.join(state, "work-"));
    const project = path.join(work, "golems"), clones = [path.join(work, "anthropic"), path.join(work, "emil")];
    run(git, ["clone", "--depth", "1", "--branch", "master", `https://github.com/${repository}.git`, project]);
    const base = run(git, ["rev-parse", "HEAD"], project);
    for (const [i, url] of sources.entries()) {
      run(git, ["clone", "--depth", "1", url, clones[i]]);
      if (!lstatSync(path.join(clones[i], i === 0 ? "plugins/frontend-design/skills" : "skills")).isDirectory()) throw Error(`upstream skills root is not a regular directory: ${i}`);
    }
    const expected = clones.map((cwd) => run(git, ["rev-parse", "HEAD"], cwd));
    log(`BASE ${base} UPSTREAM ${expected.join(" ")}`);
    const copier = refresh ?? (await import(pathToFileURL(path.join(project, "skills/golem-powers/golem-install/scripts/refresh-vendor.mjs")))).refreshVendor;
    const result = await copier({ vendor: path.join(project, "skills/vendor"), clones, expected, apply: true });
    if (!result.changed) { log("NOOP payload hashes unchanged"); return { status: "NOOP", base }; }
    const branch = `auto/design-skills-${expected.map((s) => s.slice(0, 12)).join("-")}`;
    const existing = JSON.parse(run(gh, ["pr", "list", "--repo", repository, "--head", branch, "--state", "all", "--json", "url"], project));
    if (existing.length) { log(`NOOP proposal already settled: ${existing[0].url}`); return { status: "NOOP", base }; }
    if (!run(git, ["ls-remote", "--heads", "origin", `refs/heads/${branch}`], project)) {
      run(git, ["switch", "-c", branch], project);
      run(git, ["add", "--", "skills/vendor"], project);
      run(git, ["-c", "user.name=designSkillsUpdater", "-c", "user.email=design-skills@users.noreply.github.com", "commit", "-m", "chore(skills): propose design upstream refresh"], project);
      const helper = `!'${gh.replace(/'/g, "'\\''")}' auth git-credential`;
      run(git, ["-c", "credential.helper=", "-c", `credential.helper=${helper}`, "push", "origin", `HEAD:refs/heads/${branch}`], project);
    }
    const body = path.join(work, "PR.md");
    writeFileSync(body, "Refreshes changed design skill payloads and pins from the official upstreams. Copied as inert data; no upstream code ran or was installed. Read every changed instruction before merge and apply normal independent review/CI. No automatic merge or approval.\n\nLoop-record: implementer=automation/upstream-sync/default reviewer=none rounds=0/0 defects=0 role=worker\n\n— designSkillsUpdater (MacBook automation, existing gh login)\n");
    const url = run(gh, ["pr", "create", "--repo", repository, "--base", "master", "--head", branch, "--title", "chore(skills): refresh pinned design upstreams", "--body-file", body], project);
    const number = new URL(url).pathname.match(/\/pull\/(\d+)$/)?.[1];
    if (!number) throw Error(`unexpected PR URL: ${url}`);
    run("/bin/bash", ["scripts/ci/pr-size-labels.sh", "compute", number, "--repo", repository], project);
    log(`PR_OPENED ${url}`); return { status: "PR_OPENED", url, base };
  } catch (error) { log(`ERROR ${error.message}`); throw error; }
  finally { if (work) rmSync(work, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.join(homedir(), ".golems/state/design-skill-updates");
  update({ state: root, logFile: path.join(root, "updates.log") }).catch((error) => { console.error(`ERROR design skill updater: ${error.message}`); process.exitCode = 1; });
}
