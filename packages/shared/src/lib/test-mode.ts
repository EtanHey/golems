let runningBunTests = false;
// Package-cwd runs do not read the workspace's bunfig; Bun.main names the test file.
const bunTestEntry = typeof Bun !== "undefined" &&
  /[._](?:test|spec)\.[cm]?[jt]sx?$/.test(Bun.main);

/** Set by Bun's test-only preload, even when NODE_ENV is overridden. */
export function markBunTestRuntime(): void {
  runningBunTests = true;
}

export function isTestMode(): boolean {
  return runningBunTests || bunTestEntry || process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test";
}
