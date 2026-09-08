import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { afterEach, test } from "node:test";
import { resolveCodexProgram, runDigestCodex } from "../stalker-digest-runner.mjs";

const roots = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function fixture(name, script) {
  const root = join(process.cwd(), `.test-stalker-digest-runner-${process.pid}-${name}`);
  const workDir = join(root, ".digest-work");
  const executable = join(root, "fake-codex.mjs");
  roots.push(root);
  await mkdir(workDir, { recursive: true });
  await writeFile(executable, `#!/usr/bin/env node\n${script}\n`);
  await chmod(executable, 0o755);
  return { root, workDir, executable };
}

async function withCodex(executable, callback) {
  const previous = process.env.CODEX_BIN;
  process.env.CODEX_BIN = executable;
  try {
    return await callback();
  } finally {
    if (previous === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = previous;
  }
}

function options(root, workDir, timeoutMs = 1000) {
  return {
    input: "Create digest.\nSOURCE DATA:\n{\"text\":\"PRIVATE_TRANSCRIPT_DO_NOT_PERSIST\"}\n",
    outputPath: join(workDir, "output.json"),
    schemaPath: join(workDir, "schema.json"),
    cwd: root,
    model: "gpt-5.6-sol",
    reasoningEffort: "medium",
    timeoutMs,
  };
}

test("persists bounded structural diagnostics when codex output contains prompt fragments", async () => {
  const fixtureData = await fixture("timeout", `
process.stderr.write("CLI_STDERR_STARTED\\n");
let input = "";
for await (const chunk of process.stdin) input += chunk;
process.stdout.write("x".repeat(70000) + input.slice(0, -2) + "y".repeat(70000));
process.stderr.write(input);
setInterval(() => {}, 1000);`);
  const { root, workDir, executable } = fixtureData;
  await withCodex(executable, async () => {
    await assert.rejects(
      runDigestCodex(options(root, workDir)),
      /timed out after 1000ms.*human-digest-codex\.stdout\.log.*human-digest-codex\.stderr\.log/s,
    );
  });
  const stdoutPath = join(workDir, "human-digest-codex.stdout.log");
  const stdoutText = await readFile(stdoutPath, "utf8");
  const stderrText = await readFile(join(workDir, "human-digest-codex.stderr.log"), "utf8");
  const stdout = JSON.parse(stdoutText);
  const stderr = JSON.parse(stderrText);
  assert.ok((await stat(stdoutPath)).size < 4096);
  assert.equal(stdout.format, "codex-structural-diagnostics-v1");
  assert.ok(stdout.oversizedLines >= 1);
  assert.equal(stderr.categories.other > 0, true);
  assert.doesNotMatch(stdoutText + stderrText, /PRIVATE_TRANSCRIPT|SOURCE DATA|CLI_STDERR_STARTED/);
});

test("persists stdout and stderr when codex exits successfully", async () => {
  const { root, workDir, executable } = await fixture(
    "success",
    'process.stdout.write("{\\\"type\\\":\\\"thread.started\\\"}\\n{\\\"type\\\":\\\"item.completed\\\",\\\"item\\\":{\\\"type\\\":\\\"agent_message\\\",\\\"text\\\":\\\"never persist me\\\"}}\\n"); process.stderr.write("OpenAI Codex v0.153.4\\n");',
  );
  await withCodex(executable, () => runDigestCodex(options(root, workDir)));
  const stdout = JSON.parse(await readFile(join(workDir, "human-digest-codex.stdout.log"), "utf8"));
  const stderr = JSON.parse(await readFile(join(workDir, "human-digest-codex.stderr.log"), "utf8"));
  assert.deepEqual(stdout.eventTypes, { "thread.started": 1, "item.completed": 1 });
  assert.deepEqual(stdout.itemTypes, { agent_message: 1 });
  assert.deepEqual(stderr.categories, { startup: 1 });
  assert.doesNotMatch(JSON.stringify(stdout), /never persist me/);
});

test("nonzero exits cite persisted structural diagnostics without raw error lines", async () => {
  const { root, workDir, executable } = await fixture(
    "failure",
    'process.stderr.write("CLI failed after startup\\napi_key=never-write\\n"); process.exit(17);',
  );
  await withCodex(executable, async () => {
    await assert.rejects(
      runDigestCodex(options(root, workDir)),
      /codex exec failed \(17\).*human-digest-codex\.stderr\.log/s,
    );
  });
  const stderrText = await readFile(join(workDir, "human-digest-codex.stderr.log"), "utf8");
  const stderr = JSON.parse(stderrText);
  assert.equal(stderr.categories.other, 2);
  assert.doesNotMatch(stderrText, /CLI failed|never-write|api_key/);
});

test("unknown diagnostic keys collapse without storing arbitrary output identifiers", async () => {
  const { root, workDir, executable } = await fixture("unknown-types", `
for (let i = 0; i < 1000; i++) console.log(JSON.stringify({type: 'private-event-' + i, item: {type: 'private-item-' + i}}));`);
  await withCodex(executable, () => runDigestCodex(options(root, workDir)));
  const text = await readFile(join(workDir, "human-digest-codex.stdout.log"), "utf8");
  const result = JSON.parse(text);
  assert.deepEqual(result.eventTypes, {unknown: 1000});
  assert.deepEqual(result.itemTypes, {unknown: 1000});
  assert.ok(Buffer.byteLength(text) < 4096);
  assert.doesNotMatch(text, /private-event|private-item/);
});

test("early child exit while writing large stdin stays a controlled failure", async () => {
  const { root, workDir, executable } = await fixture("epipe", "process.exit(19);");
  const request = { ...options(root, workDir), input: "x".repeat(2_000_000) };
  await withCodex(executable, () => assert.rejects(
    runDigestCodex(request),
    /codex exec failed \(19\).*human-digest-codex\.stderr\.log/s,
  ));
});

test("settles within a bound even when a killed child never closes", async () => {
  const { root, workDir } = await fixture("settlement", "");
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  child.kill = () => true;
  const started = Date.now();
  await assert.rejects(
    runDigestCodex({
      ...options(root, workDir, 20),
      killGraceMs: 20,
      settleGraceMs: 20,
      spawnImpl: () => child,
    }),
    /did not settle after SIGKILL.*human-digest-codex\.stderr\.log/s,
  );
  assert.ok(Date.now() - started < 500);
});

test("resolves CODEX_BIN first, then canonical home binary, then PATH", async () => {
  const executable = async () => {};
  assert.equal(await resolveCodexProgram({ env: { CODEX_BIN: "/override/codex" }, homeDir: "/home/e", accessImpl: executable }), "/override/codex");
  assert.equal(await resolveCodexProgram({ env: {}, homeDir: "/home/e", accessImpl: executable }), "/home/e/.local/bin/codex");
  assert.equal(await resolveCodexProgram({ env: {}, homeDir: "/home/e", accessImpl: async () => { throw new Error("missing"); } }), "codex");
});

test("forced settlement releases pipes retained by a real grandchild", async () => {
  const { root, workDir, executable } = await fixture("inherited-pipe", `
import { spawn } from "node:child_process";
spawn(process.execPath, ["-e", "setTimeout(() => {}, 1500)"], { stdio: ["ignore", process.stdout, process.stderr] });
process.exit(0);`);
  let child;
  let unrefCalled = false;
  const spawnImpl = (...args) => {
    child = spawn(...args);
    const unref = child.unref.bind(child);
    child.unref = () => { unrefCalled = true; return unref(); };
    return child;
  };
  const started = Date.now();
  await withCodex(executable, () => assert.rejects(
    runDigestCodex({ ...options(root, workDir, 500), killGraceMs: 20, settleGraceMs: 20, spawnImpl }),
    /did not settle after SIGKILL/,
  ));
  assert.ok(Date.now() - started < 1000);
  assert.equal(child.stdin.destroyed, true);
  assert.equal(child.stdout.destroyed, true);
  assert.equal(child.stderr.destroyed, true);
  assert.equal(unrefCalled, true);
});
