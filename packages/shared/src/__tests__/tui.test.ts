import { describe, test, expect } from "bun:test";
import {
  colors,
  formatDashboard,
  formatCompactStatus,
  box,
  detectConfig,
  type GolemStatus,
  type SystemHealth,
  type ServiceStatus,
  type ConfigStatus,
} from "@golems/shared/lib/tui";

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

describe("colors", () => {
  test("bold wraps text with ANSI codes", () => {
    const result = colors.bold("hello");
    expect(result).toContain("hello");
    expect(result).toContain("\x1b[1m");
    expect(result).toContain("\x1b[0m");
  });

  test("all color functions return strings", () => {
    const fns = [colors.bold, colors.dim, colors.red, colors.green, colors.yellow, colors.blue, colors.magenta, colors.cyan, colors.gray];
    for (const fn of fns) {
      expect(typeof fn("test")).toBe("string");
      expect(fn("test")).toContain("test");
    }
  });
});

// ---------------------------------------------------------------------------
// Format dashboard
// ---------------------------------------------------------------------------

describe("formatDashboard", () => {
  const mockHealth: SystemHealth = {
    golems: [
      { name: "ClaudeGolem", emoji: "🤖", status: "running", detail: "Telegram active" },
      { name: "EmailGolem", emoji: "📧", status: "scheduled", detail: "Launchd" },
      { name: "JobGolem", emoji: "🎯", status: "stopped", detail: "Not running" },
    ],
    services: [
      { name: "Notify Server", running: true, port: 3847 },
      { name: "Ollama", running: false, port: 11434 },
    ],
    config: {
      configFile: true,
      stateDir: true,
      envFile: true,
      wizardRun: false,
    },
  };

  test("includes header", () => {
    const output = formatDashboard(mockHealth);
    expect(output).toContain("GOLEMS DASHBOARD");
  });

  test("shows all golems", () => {
    const output = formatDashboard(mockHealth);
    expect(output).toContain("ClaudeGolem");
    expect(output).toContain("EmailGolem");
    expect(output).toContain("JobGolem");
  });

  test("shows services section", () => {
    const output = formatDashboard(mockHealth);
    expect(output).toContain("Notify Server");
    expect(output).toContain("Ollama");
  });

  test("shows config section", () => {
    const output = formatDashboard(mockHealth);
    expect(output).toContain("config.yaml");
    expect(output).toContain("state directory");
    expect(output).toContain(".env file");
    expect(output).toContain("wizard state");
  });

  test("shows summary line with counts", () => {
    const output = formatDashboard(mockHealth);
    // 2 active (running + scheduled), 1 stopped; 1 service up, 1 down
    expect(output).toContain("2/3 golems active");
    expect(output).toContain("1/2 services up");
  });

  test("includes golem emojis", () => {
    const output = formatDashboard(mockHealth);
    expect(output).toContain("🤖");
    expect(output).toContain("📧");
    expect(output).toContain("🎯");
  });
});

// ---------------------------------------------------------------------------
// Format compact
// ---------------------------------------------------------------------------

describe("formatCompactStatus", () => {
  test("shows active golems", () => {
    const health: SystemHealth = {
      golems: [
        { name: "ClaudeGolem", emoji: "🤖", status: "running" },
        { name: "EmailGolem", emoji: "📧", status: "stopped" },
      ],
      services: [],
      config: { configFile: false, stateDir: false, envFile: false, wizardRun: false },
    };
    const output = formatCompactStatus(health);
    expect(output).toContain("Active:");
    expect(output).toContain("ClaudeGolem");
  });

  test("shows stopped golems", () => {
    const health: SystemHealth = {
      golems: [
        { name: "ClaudeGolem", emoji: "🤖", status: "stopped" },
      ],
      services: [],
      config: { configFile: false, stateDir: false, envFile: false, wizardRun: false },
    };
    const output = formatCompactStatus(health);
    expect(output).toContain("Stopped:");
    expect(output).toContain("ClaudeGolem");
  });

  test("shows down services", () => {
    const health: SystemHealth = {
      golems: [],
      services: [
        { name: "Ollama", running: false },
      ],
      config: { configFile: false, stateDir: false, envFile: false, wizardRun: false },
    };
    const output = formatCompactStatus(health);
    expect(output).toContain("Services down:");
    expect(output).toContain("Ollama");
  });

  test("empty when no golems or services", () => {
    const health: SystemHealth = {
      golems: [],
      services: [],
      config: { configFile: false, stateDir: false, envFile: false, wizardRun: false },
    };
    const output = formatCompactStatus(health);
    expect(output).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Box drawing
// ---------------------------------------------------------------------------

describe("box", () => {
  test("creates bordered box with title", () => {
    const result = box("Test Title", ["Line 1", "Line 2"]);
    expect(result).toContain("┌");
    expect(result).toContain("┘");
    expect(result).toContain("Test Title");
    expect(result).toContain("Line 1");
    expect(result).toContain("Line 2");
  });

  test("respects custom width", () => {
    const result = box("Title", ["Hello"], 30);
    const lines = result.split("\n");
    // Top border should be width-4+2 = 28 dashes
    expect(lines[0]).toContain("─".repeat(28));
  });

  test("handles empty content", () => {
    const result = box("Empty", []);
    expect(result).toContain("Empty");
    expect(result).toContain("┐");
    expect(result).toContain("└");
  });
});

// ---------------------------------------------------------------------------
// Config detection
// ---------------------------------------------------------------------------

describe("detectConfig", () => {
  test("returns boolean flags for all config items", () => {
    const config = detectConfig();
    expect(typeof config.configFile).toBe("boolean");
    expect(typeof config.stateDir).toBe("boolean");
    expect(typeof config.envFile).toBe("boolean");
    expect(typeof config.wizardRun).toBe("boolean");
  });
});
