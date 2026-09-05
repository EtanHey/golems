import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const SKILL = join(
  REPO_ROOT,
  "skills",
  "golem-powers",
  "mac-systems",
  "SKILL.md",
);
const EVALS = join(
  REPO_ROOT,
  "skills",
  "golem-powers",
  "mac-systems",
  "evals",
  "evals.json",
);

describe("mac-systems reverse-drift reconciliation", () => {
  test("restores the full tracked systems reference", async () => {
    const content = await readFile(SKILL, "utf8");
    const restoredMarkers = [
      "#### Style Mask Configurations",
      "### 2. State Architecture for Live Dashboards",
      "#### Essential Plist Keys",
      "### 4. Socket Activation via launchd",
      "launch_activate_socket",
      "### 5. Resilient MCP Bridge Patterns",
      "#### TCC (Transparency, Consent, and Control)",
      "tccutil reset All",
      "### 7. Visual Effect Materials for Menu Bar Apps",
      "### 8. Keyboard Shortcuts",
      "KeyboardShortcuts.Recorder",
      "### 9. Deployment Targets (2026)",
    ];

    for (const marker of restoredMarkers) {
      expect(content).toContain(marker);
    }
  });

  test("retains the newer golems fleet safety guidance", async () => {
    const content = await readFile(SKILL, "utf8");
    const fleetMarkers = [
      "Triggers: menu-bar apps",
      "## Mechanical Environment Truths",
      "launchctl submit",
      "/usr/bin/log stream",
      "Memory Leak Watches — footprint, not RSS",
      "/usr/bin/footprint --format bytes",
      "CloudStorage read bounds",
      "Host-identity check first",
    ];

    for (const marker of fleetMarkers) {
      expect(content).toContain(marker);
    }
  });

  test("keeps restored operational examples current and secure", async () => {
    const content = await readFile(SKILL, "utf8");

    expect(content).toContain("Task.sleep(for: .milliseconds(50))");
    expect(content).toContain("one MainActor mutation per batch");
    expect(content).toContain("<integer>384</integer>");
    expect(content).not.toContain("<integer>438</integer>");
    expect(content).not.toContain("/tmp/myservice.sock");
    expect(content).toContain("SELECT service, client, auth_value FROM access");
    expect(content).not.toContain("SELECT service, client, allowed FROM access");
    expect(content).toContain("Requires Full Disk Access");
    expect(content).toContain("KeepAlive=true, launchd relaunches it");
    expect(content).not.toContain("# Start/stop without unloading");
    expect(content).toContain("--ignore-cache --no-cache");
    expect(content).not.toContain("sudo spctl --reset");
    expect(content).not.toContain("spctl --reset-default");
  });

  test("ships structured retrieval and application evals", async () => {
    const manifest = JSON.parse(await readFile(EVALS, "utf8"));

    expect(manifest.skill_name).toBe("mac-systems");
    expect(manifest.evals.length).toBeGreaterThanOrEqual(4);
    for (const evalCase of manifest.evals) {
      expect(evalCase.id).toBeTruthy();
      expect(evalCase.name).toBeTruthy();
      expect(evalCase.prompt).toBeTruthy();
      expect(evalCase.expected_output).toBeTruthy();
      expect(evalCase.assertions.length).toBeGreaterThan(0);
    }
  });
});
