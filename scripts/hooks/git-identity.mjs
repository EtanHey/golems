#!/usr/bin/env node
// AIDEV-NOTE: machine-setup identity line. GitHub never links a `.local` (or
// empty) email to an account, so commits made without a configured identity
// never count for their author. Reads the effective identity from a neutral
// directory (no repo-local config) and never prints the address itself.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { existsSync, realpathSync } from "node:fs";

export const MISSING = "git identity: MISSING (commits would be <user>@<host>.local)";

export function gitIdentityStatus(env = process.env) {
  const run = (...args) => spawnSync("git", args, { cwd: "/", env, encoding: "utf8" });
  const ident = run("var", "GIT_AUTHOR_IDENT");
  const match = ident.status === 0 ? /^(.*?)\s*<([^<>]*)>\s+\d+\s+[+-]\d{4}\s*$/.exec(ident.stdout.trim()) : null;
  const email = match?.[2].trim();
  // Git's hostname fallback is not always `.local` (Linux CI hosts), so an
  // identity that no config or environment variable supplies counts as missing.
  const explicit = Boolean(env.GIT_AUTHOR_EMAIL || env.EMAIL) || run("config", "--get", "user.email").stdout.trim() !== "";
  if (!match || !email || /\.local\.?$/i.test(email) || !explicit) return { ok: false, line: MISSING };
  return { ok: true, line: `git identity: ok ${match[1].trim() || "(no name)"}` };
}

if (process.argv[1] && existsSync(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const { ok, line } = gitIdentityStatus();
  console.log(line);
  process.exitCode = ok ? 0 : 1;
}
