#!/usr/bin/env node
// Usage: t3-provider-parity.mjs [remote-host=m1]
// Compares this Mac's T3 provider set and CLI versions with the remote's. Exit 1 on any drift.

import { spawnSync } from "node:child_process";

import { compareParity, formatReport, validateSettings, VERSION_BINARIES } from "./t3-provider-parity-lib.mjs";

const SETTINGS = "~/.t3/userdata/settings.json";

function run(host, command) {
  const result =
    host === "local"
      ? spawnSync("/bin/zsh", ["-c", command], { encoding: "utf8" })
      : spawnSync("ssh", ["-o", "ConnectTimeout=8", host, command], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${host}: \`${command}\` failed (${result.status}): ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function snapshot(host) {
  return {
    settings: validateSettings(JSON.parse(run(host, `cat ${SETTINGS}`)), host),
    versions: Object.fromEntries(VERSION_BINARIES.map((bin) => [bin, run(host, `${bin} --version`)])),
  };
}

const remote = process.argv[2] ?? "m1";
const hosts = ["local", remote];
try {
  const [a, b] = hosts.map(snapshot);
  const settingsDrift = compareParity(a.settings, b.settings);
  const versionDrift = VERSION_BINARIES.filter((bin) => a.versions[bin] !== b.versions[bin]).map((bin) => ({
    path: `version ${bin}`,
    a: a.versions[bin],
    b: b.versions[bin],
  }));
  const report = formatReport({ hosts, settingsDrift, versionDrift });
  const drifted = settingsDrift.length + versionDrift.length > 0;
  (drifted ? console.error : console.log)(report);
  process.exit(drifted ? 1 : 0);
} catch (error) {
  console.error(`T3 PROVIDER PARITY UNKNOWN: ${error.message}`);
  process.exit(2);
}
