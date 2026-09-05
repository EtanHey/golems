#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

const LABEL = "com.golems.google-drive-oauth-guard";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const GUARD_SOURCE = join(SCRIPT_DIR, "google-drive-oauth-guard.mjs");
const PLIST_TEMPLATE = join(
  REPO_ROOT,
  "launchd",
  `${LABEL}.plist.in`,
);
const TOKEN_PATTERN = /@[A-Z][A-Z0-9_]*@/;

function usage() {
  return [
    "usage:",
    "  install-google-drive-oauth-guard.mjs install [options]",
    "  install-google-drive-oauth-guard.mjs uninstall [options]",
    "",
    "options:",
    "  --home /absolute/home",
    "  --vendor-dir /absolute/vendor/google-drive-mcp",
    "  --node-bin /absolute/node",
    "  --skip-launchctl",
    "",
  ].join("\n");
}

function optionValue(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return args[index + 1];
}

function absoluteOption(value, name) {
  if (!isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  return resolve(value);
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function atomicCopy(source, destination, mode) {
  const temporary = join(
    dirname(destination),
    `.${basename(destination)}.new-${process.pid}`,
  );
  try {
    await copyFile(source, temporary);
    await chmod(temporary, mode);
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function atomicWrite(destination, content, mode) {
  const temporary = join(
    dirname(destination),
    `.${basename(destination)}.new-${process.pid}`,
  );
  try {
    await writeFile(temporary, content, { mode });
    await chmod(temporary, mode);
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function execute(program, args) {
  const child = spawn(program, args, {
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

function serviceMissing(result) {
  return /could not find (?:specified )?service|service not found|bad request/i.test(
    `${result.stdout}\n${result.stderr}`,
  );
}

async function loadedState(service) {
  const result = await execute("/bin/launchctl", ["print", service]);
  if (result.exitCode === 0) return result;
  if (serviceMissing(result)) return null;
  throw new Error(
    `launchctl print ${service} failed (${result.exitCode}): ${
      result.stderr.trim() || result.stdout.trim()
    }`,
  );
}

async function requireLaunchctl(args) {
  const result = await execute("/bin/launchctl", args);
  if (result.exitCode !== 0) {
    throw new Error(
      `launchctl ${args.join(" ")} failed (${result.exitCode}): ${
        result.stderr.trim() || result.stdout.trim()
      }`,
    );
  }
  return result;
}

function renderTemplate(template, replacements) {
  let rendered = template;
  for (const [token, value] of Object.entries(replacements)) {
    rendered = rendered.replaceAll(token, escapeXml(value));
  }
  const unresolved = rendered.match(TOKEN_PATTERN);
  if (unresolved) throw new Error(`unresolved plist token: ${unresolved[0]}`);
  return rendered;
}

async function parseOptions(argv) {
  const [action, ...args] = argv;
  if (action === "--help" || action === "-h") {
    process.stdout.write(usage());
    return null;
  }
  if (!["install", "uninstall"].includes(action)) {
    throw new Error(usage());
  }

  const home = absoluteOption(optionValue(args, "--home", homedir()), "--home");
  const vendorDir = absoluteOption(
    optionValue(
      args,
      "--vendor-dir",
      join(home, "Gits/orchestrator/vendor/google-drive-mcp"),
    ),
    "--vendor-dir",
  );
  const homebrewNode = "/opt/homebrew/bin/node";
  const defaultNode = await access(homebrewNode, constants.X_OK)
    .then(() => homebrewNode)
    .catch(() => process.execPath);
  const nodeBin = absoluteOption(
    optionValue(args, "--node-bin", defaultNode),
    "--node-bin",
  );
  await access(nodeBin, constants.X_OK);

  return {
    action,
    home,
    nodeBin,
    skipLaunchctl: args.includes("--skip-launchctl"),
    vendorDir,
  };
}

async function install(options, paths) {
  await mkdir(paths.runtimeDir, { recursive: true, mode: 0o700 });
  await mkdir(paths.launchAgentsDir, { recursive: true, mode: 0o755 });
  await mkdir(paths.logDir, { recursive: true, mode: 0o700 });

  const template = await readFile(PLIST_TEMPLATE, "utf8");
  await atomicCopy(GUARD_SOURCE, paths.runtimePath, 0o555);
  await rm(paths.legacyRuntimePath, { force: true });
  await atomicWrite(
    paths.plistPath,
    renderTemplate(template, {
      "@HOME@": options.home,
      "@LOG_DIR@": paths.logDir,
      "@NODE_BIN@": options.nodeBin,
      "@RUNTIME_PATH@": paths.runtimePath,
      "@VENDOR_DIR@": options.vendorDir,
    }),
    0o644,
  );

  process.stdout.write(`installed ${paths.runtimePath}\n`);
  process.stdout.write(`installed ${paths.plistPath}\n`);
  if (options.skipLaunchctl) {
    process.stdout.write(
      `launchctl bootstrap ${paths.domain} ${paths.plistPath}\n`,
    );
    return;
  }

  if (await loadedState(paths.service)) {
    await requireLaunchctl(["bootout", paths.service]);
  }
  await requireLaunchctl(["enable", paths.service]);
  await requireLaunchctl(["bootstrap", paths.domain, paths.plistPath]);
  const proof = await requireLaunchctl(["print", paths.service]);
  process.stdout.write(proof.stdout);
}

async function uninstall(options, paths) {
  if (options.skipLaunchctl) {
    process.stdout.write(`launchctl bootout ${paths.service}\n`);
  } else if (await loadedState(paths.service)) {
    await requireLaunchctl(["bootout", paths.service]);
  }

  await rm(paths.plistPath, { force: true });
  await rm(paths.runtimePath, { force: true });
  await rm(paths.legacyRuntimePath, { force: true });
  await rmdir(paths.runtimeDir).catch((error) => {
    if (!["ENOENT", "ENOTEMPTY"].includes(error?.code)) throw error;
  });
  process.stdout.write(`removed ${paths.plistPath}\n`);
  process.stdout.write(`removed ${paths.runtimePath}\n`);
}

async function main() {
  const options = await parseOptions(process.argv.slice(2));
  if (!options) return;
  const uid = process.getuid?.();
  if (!Number.isInteger(uid)) throw new Error("could not determine current uid");

  const runtimeDir = join(
    options.home,
    "Library/Application Support/Golems/google-drive-oauth-guard",
  );
  const paths = {
    domain: `gui/${uid}`,
    launchAgentsDir: join(options.home, "Library/LaunchAgents"),
    logDir: join(
      options.home,
      "Library/Logs/Golems/google-drive-oauth-guard",
    ),
    legacyRuntimePath: join(runtimeDir, "oauth-boot-guard.mjs"),
    plistPath: join(
      options.home,
      `Library/LaunchAgents/${LABEL}.plist`,
    ),
    runtimeDir,
    runtimePath: join(runtimeDir, "google-drive-oauth-guard.mjs"),
    service: `gui/${uid}/${LABEL}`,
  };

  if (options.action === "install") await install(options, paths);
  else await uninstall(options, paths);
}

main().catch((error) => {
  process.stderr.write(
    `[google-drive-oauth-guard-install] ERROR: ${
      error instanceof Error ? error.message : String(error)
    }\n`,
  );
  process.exitCode = 1;
});
