import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function runPipeline(mode: string) {
  const home = mkdtempSync(join(tmpdir(), "email-pipeline-fixture-"));
  try {
    const result = Bun.spawnSync(
      [process.execPath, join(import.meta.dir, "pipeline.fixture.ts"), mode],
      {
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, STATE_BACKEND: "supabase" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(result.exitCode).toBe(0);
    const output = result.stdout.toString();
    const receipt = output
      .split("\n")
      .find((line) => line.startsWith("PIPELINE_EFFECTS="));
    if (!receipt) throw new Error("Synthetic pipeline receipt missing");
    return {
      effects: JSON.parse(receipt.slice("PIPELINE_EFFECTS=".length)),
      output,
    };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

describe("email triage without delivery", () => {
  it("scores, stores, routes and tracks payments without a send or notified mutation", () => {
    const { effects } = runPipeline("live-fixture");
    expect(
      effects.saved.map((email: any) => [
        email.gmail_id,
        email.score,
        email.notified,
      ]),
    ).toEqual([
      ["urgent", 10, false],
      ["subscription", 6, false],
    ]);
    expect(effects.routed).toHaveLength(1);
    expect(effects.routed[0].type).toBe("email_routed");
    expect(effects.routed[0].data.targetGolem).toBe("recruitergolem");
    expect(effects.senders).toHaveLength(2);
    expect(effects.subscriptions[0].service_name).toBe("Fixture");
    expect(effects.payments[0].amount).toBe(12);
    expect(effects.syncs).toBe(1);
    expect(effects.state.processedEmailIds).toEqual(["urgent", "subscription"]);
    expect(effects.runs).toBe(1);
    expect([effects.requests, effects.marked]).toEqual([0, 0]);
  });

  it("dry-run keeps scoring and returns without writes or a delivery promise", () => {
    const { effects, output } = runPipeline("dry-run");
    expect(effects.saved).toEqual([]);
    expect(effects.state).toEqual({});
    expect(effects.syncs).toBe(0);
    expect(effects.runs).toBe(0);
    expect([effects.requests, effects.marked]).toEqual([0, 0]);
    expect(output).toContain("Urgent: 1");
    expect(output).not.toContain("Would notify");
  });
});
