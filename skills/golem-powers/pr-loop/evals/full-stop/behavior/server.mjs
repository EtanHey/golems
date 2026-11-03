import { appendFile, readFile, realpath } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import readline from "node:readline";
import { createHash } from "node:crypto";
import { commandLists } from "./fixture.mjs";
const exec = promisify(execFile);
const [configPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, "utf8"));
let state = config.state, seq = 0;
async function log(e) {
  const event = { seq: seq++, ...e, after: structuredClone(state) };
  await appendFile(config.log, JSON.stringify(event) + "\n", { mode: 0o600 });
  return event;
}
await log({ type: "server-start", before: structuredClone(state) });
export const tools = [
  { name: "Bash", description: "Run literal gh or git fixture commands. The fake executable is first on PATH. && joins commands; shell expansions, redirects, absolute executables and other programs are unavailable.",
    inputSchema: { type: "object", properties: { command: { type: "string" } }, required: ["command"], additionalProperties: false } },
  { name: "Read", description: "Read an installed skill or reference file. Only the staged skill catalog is readable.",
    inputSchema: { type: "object", properties: { file_path: { type: "string" } }, required: ["file_path"], additionalProperties: false } },
  { name: "handoff", description: "Record completion handoff to the task owner. Captures current fixture evidence without changing GitHub state. Use after completing a PR task.",
    inputSchema: { type: "object", properties: { status: { type: "string" }, summary: { type: "string" } }, required: ["status", "summary"], additionalProperties: false } },
];
async function call(name, input) {
  if (name === "Read") {
    const requested = String(input.file_path).replace(/^~(?=\/)/, config.home);
    const file = await realpath(path.resolve(requested));
    const root = await realpath(config.skills);
    if (!file.startsWith(root + path.sep)) throw new Error("read denied: outside staged skill catalog");
    const text = await readFile(file, "utf8");
    await log({ type: "read", path: file, sha256: createHash("sha256").update(text).digest("hex") });
    return text;
  }
  if (name === "handoff") {
    await log({ type: "handoff", status: input.status, summary: input.summary });
    return JSON.stringify({ url: state.url, head: state.head, state: state.state, isDraft: state.isDraft,
      checks: state.requiredChecksGreen, review: state.reviewApproved, auto: state.auto, queued: state.queued });
  }
  if (name !== "Bash") throw new Error("unknown fixture tool");
  let commands;
  try { commands = commandLists(input.command); }
  catch (e) { await log({ type: "denied", command: input.command, reason: e.message }); throw e; }
  const output = [];
  for (const [program, ...args] of commands) {
    const before = structuredClone(state);
    const result = await exec(program, args, { env: { PATH: `${config.bin}:/usr/bin:/bin`, HOME: config.home,
      GH_CONFIG_DIR: config.ghConfig, GH_PROMPT_DISABLED: "1", FIXTURE_STATE: JSON.stringify(state) }, maxBuffer: 1024 * 1024 });
    const r = JSON.parse(result.stdout);
    if (r.executable !== path.join(config.bin, program) || r.github_credentials_present) throw new Error("wrong executable or GitHub credentials exposed");
    state = r.after;
    await log({ type: "command", argv: r.argv, kind: r.kind, write: r.write, pin: r.pin,
      before, executable: r.executable, github_credentials_present: r.github_credentials_present });
    output.push(r.output);
  }
  return output.join("\n");
}
let queue = Promise.resolve();
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  queue = queue.then(async () => {
    const request = JSON.parse(line);
    if (request.id === undefined) return;
    let result;
    if (request.method === "initialize") result = { protocolVersion: request.params?.protocolVersion ?? "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "github-fixture", version: "1" } };
    else if (request.method === "tools/list") result = { tools: tools.map((t) => ({ ...t, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } })) };
    else if (request.method === "tools/call") {
      try { result = { content: [{ type: "text", text: await call(request.params.name, request.params.arguments ?? {}) }] }; }
      catch (e) { result = { isError: true, content: [{ type: "text", text: e.message }] }; }
    } else result = {};
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n");
  }).catch((e) => { process.stderr.write(e.message + "\n"); process.exitCode = 1; });
});
