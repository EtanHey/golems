#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function parseVendorDir(argv) {
  const index = argv.indexOf("--vendor-dir");
  if (index === -1 || !argv[index + 1]) {
    throw new Error(
      "usage: google-drive-oauth-guard.mjs --vendor-dir /absolute/vendor/google-drive-mcp",
    );
  }
  if (!isAbsolute(argv[index + 1])) {
    throw new Error("--vendor-dir must be an absolute path");
  }
  return resolve(argv[index + 1]);
}

async function runNode(scriptPath, cwd) {
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: process.env,
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
  const stdoutText = Buffer.concat(stdout).toString("utf8");
  const stderrText = Buffer.concat(stderr).toString("utf8");
  if (stdoutText) process.stdout.write(stdoutText);
  if (stderrText) process.stderr.write(stderrText);
  if (exitCode !== 0) {
    throw new Error(`${scriptPath} exited ${exitCode}`);
  }
}

function emit(label, payload) {
  process.stderr.write(`${label} ${JSON.stringify(payload)}\n`);
}

async function main() {
  const vendorDir = parseVendorDir(process.argv.slice(2));
  const applyPatchPath = join(vendorDir, "apply-patch.mjs");
  const tokenGuardPath = join(vendorDir, "oauth-token-guard.mjs");
  const launchPath = join(vendorDir, "launch.sh");
  const distPath = join(
    vendorDir,
    "node_modules",
    "@piotr-agier",
    "google-drive-mcp",
    "dist",
    "index.js",
  );

  await runNode(applyPatchPath, vendorDir);

  const dist = await readFile(distPath, "utf8");
  const forbiddenMarkers = [
    "GDRIVE_MCP_PORT3000_PREWARM_PATCH",
    "GDRIVE_MCP_REARM_ON_CLEAR_PATCH",
    "__gdriveMcpPrewarmAuthServer",
  ];
  const present = forbiddenMarkers.filter((marker) => dist.includes(marker));
  if (present.length > 0) {
    throw new Error(
      `legacy OAuth auto-open code remains in installed dist: ${present.join(", ")}`,
    );
  }
  if (
    !dist.includes("GDRIVE_MCP_HEADLESS_AUTH_START_PATCH") ||
    !dist.includes("GDRIVE_MCP_HEADLESS_AUTH_REQUEST_PATCH")
  ) {
    throw new Error("installed dist is missing the headless OAuth guard");
  }

  const { preflightRefresh, statusReport } = await import(
    pathToFileURL(tokenGuardPath)
  );
  const preflight = await preflightRefresh();
  const report = await statusReport();
  if (
    ["no-token", "missing-refresh-token", "revoked"].includes(preflight.status) ||
    !report.exists ||
    !report.hasAccessToken ||
    !report.hasRefreshToken ||
    report.expired === true
  ) {
    emit("GDRIVE_MCP_BOOT_DEGRADED", {
      code: "gdrive_not_authenticated",
      action: `${launchPath} auth`,
    });
    process.exitCode = 2;
    return;
  }

  process.stdout.write(
    `GDRIVE_MCP_BOOT_OK ${JSON.stringify({
      code: "gdrive_oauth_guard_healthy",
      tokenStatus: preflight.status,
      legacyAutoOpenMarkers: 0,
    })}\n`,
  );
}

main().catch((error) => {
  emit("GDRIVE_MCP_BOOT_FAILED", {
    code: "gdrive_oauth_guard_failed",
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
