import { mkdir, copyFile, writeFile, readFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { initialState } from "./fixture.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const exec = promisify(execFile);
export async function prepareFixture({ root, home, skills, testCase, output, realGh }) {
  if (output === root || output.startsWith(root + path.sep)) throw new Error("fixture log must be outside the cell");
  const bin = path.join(root, "bin"), ghConfig = path.join(home, ".empty-gh");
  await mkdir(bin, { recursive: true }); await mkdir(ghConfig, { recursive: true }); await mkdir(output, { recursive: true });
  for (const name of ["fixture.mjs", "server.mjs", "skill-gate.mjs"]) await copyFile(path.join(here, name), path.join(bin, name));
  for (const name of ["gh", "git"]) await writeFile(path.join(bin, name), `#!${process.execPath}\nif (!process.env.FIXTURE_STATE) { console.error('Use the fixture Bash tool'); process.exit(64); }\nawait import('./fixture.mjs');\n`, { mode: 0o700 });
  const config = { home, skills, bin, ghConfig, log: path.join(output, "operations.jsonl"), state: initialState(testCase) };
  const configPath = path.join(bin, "fixture-config.json");
  await writeFile(configPath, JSON.stringify(config));
  const mcp = { mcpServers: { fixture: { command: process.execPath, args: [path.join(bin, "server.mjs"), configPath],
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, GH_CONFIG_DIR: ghConfig, GH_TOKEN: "", GITHUB_TOKEN: "", GH_ENTERPRISE_TOKEN: "", GITHUB_ENTERPRISE_TOKEN: "" } } } };
  const mcpPath = path.join(bin, "fixture-mcp.json"); await writeFile(mcpPath, JSON.stringify(mcp));
  const preflight = { path_first: bin, real_gh: realGh, github_credentials_present: false };
  try {
    await exec(realGh, ["api", "user"], { env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, GH_CONFIG_DIR: ghConfig, GH_PROMPT_DISABLED: "1" }, timeout: 10000 });
    throw new Error("real gh unexpectedly had a callable authenticated route");
  } catch (e) {
    if (e.code !== 4 || !/auth login|GH_TOKEN/.test(e.stderr ?? "")) throw e;
    preflight.real_gh_canary = { exit_code: e.code, error: e.stderr };
  }
  const checkPath = path.join(bin, "preflight-config.json");
  await writeFile(checkPath, JSON.stringify({ ...config, log: path.join(output, "preflight-operations.jsonl") }));
  const client = await startClient(checkPath);
  try {
    const absolute = await client.call("Bash", { command: `${realGh} api user` });
    const tamper = await client.call("Bash", { command: `rm -f ${config.log}` });
    const read = await client.call("Read", { file_path: configPath });
    const genuine = await client.call("Bash", { command: "gh pr view 731 --json headRefOid,state,autoMergeRequest" });
    if (!absolute.isError || !tamper.isError || !read.isError || genuine.isError) throw new Error("fixture command/read guard failed");
    const events = (await readFile(path.join(output, "preflight-operations.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    const invocation = events.find((e) => e.type === "command");
    if (invocation?.executable !== path.join(bin, "gh") || invocation.github_credentials_present) throw new Error("fake gh PATH/auth canary failed");
    preflight.absolute_route_denied = true; preflight.log_tamper_denied = true; preflight.config_read_denied = true;
    preflight.wrapper_executable = invocation.executable;
  } finally { await client.close(); }
  await writeFile(path.join(output, "preflight.json"), JSON.stringify(preflight, null, 2) + "\n");
  return { config, configPath, mcpPath, bin, preflight };
}
export async function startClient(configPath) {
  const child = spawn(process.execPath, [path.join(here, "server.mjs"), configPath], { stdio: ["pipe", "pipe", "pipe"] });
  let next = 1; const pending = new Map(); let stderr = "";
  child.stderr.on("data", (b) => { stderr += b; });
  readline.createInterface({ input: child.stdout }).on("line", (l) => {
    const r = JSON.parse(l); const p = pending.get(r.id); if (p) { pending.delete(r.id); p.resolve(r.result); }
  });
  const rejectPending = (reason) => { for (const p of pending.values()) p.reject(new Error(`${reason}: ${stderr}`)); pending.clear(); };
  child.once("error", (e) => rejectPending(e.message));
  const closed = new Promise((resolve) => child.once("close", (rc) => { rejectPending(`fixture server exited ${rc}`); resolve(rc); }));
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = next++; pending.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  await request("initialize", { protocolVersion: "2024-11-05" });
  return { list: () => request("tools/list", {}), call: (name, args) => request("tools/call", { name, arguments: args }),
    close: async () => { child.stdin.end(); const rc = await closed; if (rc !== 0) throw new Error(`fixture server failed: ${stderr}`); } };
}
