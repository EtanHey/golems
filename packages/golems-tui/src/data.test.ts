import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { fetchGolemStatuses, type StatusProbe } from "./data.js";

function probe(cloudWorker: boolean): StatusProbe {
  return {
    checkPort: async () => false,
    checkCloudWorker: async () => cloudWorker,
    countClaudeSessions: async () => 0,
  };
}

function row(rows: Awaited<ReturnType<typeof fetchGolemStatuses>>, name: string) {
  const found = rows.find((r) => r.name === name);
  if (!found) throw new Error(`no ${name} row`);
  return found;
}

describe("golem status rows", () => {
  // EmailGolem runs inside the cloud worker, without its own LaunchAgent.
  it("reports EmailGolem from the cloud worker", async () => {
    const up = await fetchGolemStatuses(probe(true));
    expect(row(up, "EmailGolem").status).toBe("running");

    const down = await fetchGolemStatuses(probe(false));
    expect(row(down, "EmailGolem").status).toBe("stopped");
    expect(row(down, "EmailGolem").detail).toBe("cloud worker not running");
    expect(down.some((item) => item.name === "JobGolem")).toBe(false);
  });

  it("no longer looks for the nonexistent LaunchAgents", () => {
    const source = readFileSync(join(import.meta.dir, "data.ts"), "utf8");
    expect(source).not.toContain('"email-golem"');
  });
});
