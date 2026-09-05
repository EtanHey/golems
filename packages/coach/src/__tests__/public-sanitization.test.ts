import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { migrateProtocol } from "../protocol";

const packageRoot = join(import.meta.dir, "../..");

describe("public coach package sanitation", () => {
  it("ships generic defaults rather than the owner's personal protocol", () => {
    const surfaces = [
      "src/protocol.ts",
      "src/coaching-engine.ts",
      "CLAUDE.md",
      "skills/schedule/SKILL.md",
      "skills/schedule/workflows/plan-day.md",
    ];
    const content = surfaces
      .map((path) => readFileSync(join(packageRoot, path), "utf8"))
      .join("\n");

    expect(content).not.toMatch(
      /left shoulder|shoulder injury|lastSmokeBuffer|No breakfast|first meal is Lunch|user's Obsidian notes/i,
    );
  });

  it("migrates the retired personal buffer key without losing its value", () => {
    const migrated = migrateProtocol({
      sleep: { lastSmokeBuffer: 75 },
    });

    expect(migrated.sleep.preSleepBufferMinutes).toBe(75);
    expect("lastSmokeBuffer" in migrated.sleep).toBe(false);
  });

  it("backfills nested defaults for older persisted protocols", () => {
    const migrated = migrateProtocol({
      sleep: { targetBed: "22:45" },
      huberman: { caffeineDelay: { minutesAfterWake: 90 } },
    });

    expect(migrated.sleep.targetBed).toBe("22:45");
    expect(migrated.huberman.caffeineDelay.minutesAfterWake).toBe(90);
    expect(migrated.huberman.supplements.preSleep).toEqual([]);
    expect(migrated.huberman.nsdr.durationMinutes).toBe(10);
  });
});
