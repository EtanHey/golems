// Compat shim (GO-6, 2026-09-25): moved to scripts/ci/release-gate.mjs; remove once fleet briefs and skill copies use the new path.
process.exitCode = (await import("node:child_process")).spawnSync(process.execPath, [(await import("node:url")).fileURLToPath(new URL("./ci/release-gate.mjs", import.meta.url)), ...process.argv.slice(2)], { stdio: "inherit" }).status ?? 1;
