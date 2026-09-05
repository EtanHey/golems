import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("public services package sanitation", () => {
  it("keeps active shared schedules without retired personal scheduling", () => {
    const cloudWorker = readFileSync(join(import.meta.dir, "../cloud-worker.ts"), "utf8");
    expect(cloudWorker).toContain('scheduleDaily("CalendarSync"');
    expect(cloudWorker).not.toContain("[7, 10, 14, 17, 20]");

    const repoRoot = join(import.meta.dir, "../../../..");
    expect(
      existsSync(join(repoRoot, "launchd/com.golems.bedtime-guardian.plist")),
    ).toBe(false);
    expect(
      existsSync(join(repoRoot, "packages/services/src/bedtime-guardian.ts")),
    ).toBe(false);
  });
});
