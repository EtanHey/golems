import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, "../..");
const GUARD_SOURCE = join(REPO_ROOT, "scripts/google-drive-oauth-guard.mjs");
const INSTALLER = join(REPO_ROOT, "scripts/install-google-drive-oauth-guard.mjs");
const PLIST_TEMPLATE = join(
  REPO_ROOT,
  "launchd/com.golems.google-drive-oauth-guard.plist.in",
);
const LABEL = "com.golems.google-drive-oauth-guard";

async function run(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
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

async function makeVendorFixture(root, { legacyMarker = false } = {}) {
  const vendorDir = join(root, "Gits/orchestrator/vendor/google-drive-mcp");
  const distDir = join(
    vendorDir,
    "node_modules/@piotr-agier/google-drive-mcp/dist",
  );
  await mkdir(distDir, { recursive: true });
  await writeFile(
    join(vendorDir, "apply-patch.mjs"),
    'process.stderr.write("[fixture-patch] applied\\n");\n',
  );
  await writeFile(
    join(vendorDir, "oauth-token-guard.mjs"),
    [
      'export async function preflightRefresh() { return { status: "no-token" }; }',
      'export async function statusReport() { return { exists: false }; }',
      "",
    ].join("\n"),
  );
  await writeFile(join(vendorDir, "launch.sh"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });
  await writeFile(
    join(distDir, "index.js"),
    [
      "/* GDRIVE_MCP_HEADLESS_AUTH_START_PATCH */",
      "/* GDRIVE_MCP_HEADLESS_AUTH_REQUEST_PATCH */",
      legacyMarker ? "/* GDRIVE_MCP_PORT3000_PREWARM_PATCH */" : "",
      "",
    ].join("\n"),
  );
  return vendorDir;
}

async function makeBrowserSpy(root) {
  const binDir = join(root, "bin");
  const browserLog = join(root, "browser-open.log");
  await mkdir(binDir, { recursive: true });
  await writeFile(
    join(binDir, "open"),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$GOOGLE_DRIVE_MCP_BROWSER_SPY_LOG"\n',
    { mode: 0o755 },
  );
  return { binDir, browserLog };
}

test("missing OAuth degrades once and never opens a browser", async () => {
  const root = await mkdtemp(join(tmpdir(), "gdrive-guard-"));
  const vendorDir = await makeVendorFixture(root);
  const { binDir, browserLog } = await makeBrowserSpy(root);
  const result = await run(
    process.execPath,
    [GUARD_SOURCE, "--vendor-dir", vendorDir],
    {
      env: {
        ...process.env,
        HOME: root,
        PATH: `${binDir}:${process.env.PATH}`,
        GOOGLE_DRIVE_MCP_BROWSER_SPY_LOG: browserLog,
      },
    },
  );

  assert.equal(result.exitCode, 2, result.stderr);
  assert.equal(await readFile(browserLog, "utf8").catch(() => ""), "");
  const degraded = result.stderr.match(/^GDRIVE_MCP_BOOT_DEGRADED .+$/gm) ?? [];
  assert.equal(degraded.length, 1, result.stderr);
  assert.deepEqual(
    JSON.parse(degraded[0].slice("GDRIVE_MCP_BOOT_DEGRADED ".length)),
    {
      code: "gdrive_not_authenticated",
      action: `${join(vendorDir, "launch.sh")} auth`,
    },
  );
  assert.doesNotMatch(result.stderr, /Opening your browser|Starting authentication flow/);
});

test("legacy auto-open marker fails the boot guard closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "gdrive-guard-legacy-"));
  const vendorDir = await makeVendorFixture(root, { legacyMarker: true });
  const result = await run(
    process.execPath,
    [GUARD_SOURCE, "--vendor-dir", vendorDir],
    { env: { ...process.env, HOME: root } },
  );

  assert.equal(result.exitCode, 1, result.stderr);
  assert.match(result.stderr, /^GDRIVE_MCP_BOOT_FAILED /m);
  assert.match(result.stderr, /GDRIVE_MCP_PORT3000_PREWARM_PATCH/);
  assert.doesNotMatch(result.stderr, /^GDRIVE_MCP_BOOT_OK /m);
});

test("installer deploys tracked source and a rendered RunAtLoad plist", async () => {
  const home = await mkdtemp(join(tmpdir(), "gdrive-guard-install-"));
  const vendorDir = await makeVendorFixture(home);
  const runtimeDir = join(
    home,
    "Library/Application Support/Golems/google-drive-oauth-guard",
  );
  const legacyRuntimePath = join(runtimeDir, "oauth-boot-guard.mjs");
  await mkdir(runtimeDir, { recursive: true });
  await writeFile(legacyRuntimePath, "legacy untracked runtime\n");
  const result = await run(process.execPath, [
    INSTALLER,
    "install",
    "--home",
    home,
    "--vendor-dir",
    vendorDir,
    "--node-bin",
    process.execPath,
    "--skip-launchctl",
  ]);
  assert.equal(result.exitCode, 0, result.stderr);

  const runtimePath = join(runtimeDir, "google-drive-oauth-guard.mjs");
  const plistPath = join(home, `Library/LaunchAgents/${LABEL}.plist`);
  assert.equal(await readFile(runtimePath, "utf8"), await readFile(GUARD_SOURCE, "utf8"));
  assert.ok((await stat(runtimePath)).mode & 0o111);
  await assert.rejects(access(legacyRuntimePath), { code: "ENOENT" });

  const plist = await readFile(plistPath, "utf8");
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(plist, /<key>StartInterval<\/key>\s*<integer>300<\/integer>/);
  assert.ok(plist.includes(`<string>${process.execPath}</string>`), plist);
  assert.ok(plist.includes(`<string>${runtimePath}</string>`), plist);
  assert.ok(plist.includes(`<string>${vendorDir}</string>`), plist);
  assert.doesNotMatch(plist, /@[A-Z][A-Z0-9_]*@/);
  assert.doesNotMatch(plist, /client_secret|refresh_token|access_token/);
  assert.match(
    result.stdout,
    new RegExp(`launchctl bootstrap gui/${process.getuid()} .*${LABEL}\\.plist`),
  );
});

test("uninstall removes only the installed plist and stable runtime copy", async () => {
  const home = await mkdtemp(join(tmpdir(), "gdrive-guard-uninstall-"));
  const vendorDir = await makeVendorFixture(home);
  const common = [
    "--home",
    home,
    "--vendor-dir",
    vendorDir,
    "--node-bin",
    process.execPath,
    "--skip-launchctl",
  ];
  assert.equal((await run(process.execPath, [INSTALLER, "install", ...common])).exitCode, 0);

  const result = await run(process.execPath, [INSTALLER, "uninstall", ...common]);
  assert.equal(result.exitCode, 0, result.stderr);
  await assert.rejects(
    access(join(home, `Library/LaunchAgents/${LABEL}.plist`)),
    { code: "ENOENT" },
  );
  await assert.rejects(
    access(
      join(
        home,
        "Library/Application Support/Golems/google-drive-oauth-guard/google-drive-oauth-guard.mjs",
      ),
    ),
    { code: "ENOENT" },
  );
  assert.match(
    result.stdout,
    new RegExp(`launchctl bootout gui/${process.getuid()}/${LABEL}`),
  );
});

test("standard launchd installer wires both guard install and uninstall", async () => {
  const installer = await readFile(join(REPO_ROOT, "launchd/install.sh"), "utf8");
  assert.match(
    installer,
    /install-google-drive-oauth-guard\.mjs"\s+uninstall/,
  );
  assert.match(
    installer,
    /install-google-drive-oauth-guard\.mjs"\s+install/,
  );
  assert.match(
    installer,
    /mkdir -p "\$LAUNCH_AGENTS"[\s\S]*install-google-drive-oauth-guard\.mjs"\s+install[\s\S]*for plist/,
  );
  assert.doesNotMatch(await readFile(PLIST_TEMPLATE, "utf8"), /client_secret|refresh_token|access_token/);
});
