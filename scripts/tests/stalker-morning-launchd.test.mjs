import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function run(program, args, env) {
  const child = spawn(program, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", resolveExit);
  });
  return {
    exitCode,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
  };
}

test("morning launchd job runs at login and 07:30 with durable repo logs", async () => {
  const plist = await readFile(
    join(root, "launchd/com.golems.stalker-morning-digest.plist"),
    "utf8",
  );
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(
    plist,
    /<key>StartCalendarInterval<\/key>\s*<dict>\s*<key>Hour<\/key>\s*<integer>7<\/integer>\s*<key>Minute<\/key>\s*<integer>30<\/integer>/,
  );
  assert.match(plist, /docs\.local\/stalker-golem\/morning-digest\.stdout\.log/);
  assert.match(plist, /docs\.local\/stalker-golem\/morning-digest\.stderr\.log/);
  assert.match(plist, /@NODE_BIN@/);
  assert.match(plist, /@GOLEMS_ROOT@/);
  assert.doesNotMatch(plist, /client_secret|refresh_token|access_token/);
});

test("focused installer renders a valid host plist without launchctl", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "stalker-launchd-install-"));
  const home = join(fixture, "Home & Team");
  await mkdir(home);
  const installer = join(root, "launchd/install-stalker-morning-digest.sh");
  const result = await run(installer, ["--skip-launchctl"], {
    ...process.env,
    HOME: home,
    GOLEMS_ROOT: root,
    NODE_BIN: process.execPath,
  });
  assert.equal(result.exitCode, 0, result.stderr);
  const rendered = await readFile(
    join(home, "Library/LaunchAgents/com.golems.stalker-morning-digest.plist"),
    "utf8",
  );
  assert.ok(rendered.includes(`<string>${process.execPath}</string>`));
  assert.ok(rendered.includes(`<string>${root}/scripts/stalker-morning-digest.mjs</string>`));
  assert.match(rendered, /Home &amp; Team\/Gits\/orchestrator/);
  assert.doesNotMatch(rendered, /@[A-Z][A-Z0-9_]*@/);

  const uninstall = await run(installer, ["--skip-launchctl", "--uninstall"], {
    ...process.env,
    HOME: home,
    GOLEMS_ROOT: root,
    NODE_BIN: process.execPath,
  });
  assert.equal(uninstall.exitCode, 0, uninstall.stderr);
  await assert.rejects(
    access(join(home, "Library/LaunchAgents/com.golems.stalker-morning-digest.plist")),
    { code: "ENOENT" },
  );
});
