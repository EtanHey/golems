// Deterministic replay gate for tailnet-sync-gate (gen-18 Track 2 #5).
// Pinned RED (orphaned / unverified dashboard) + GREEN (mirrored+200 / N-A)
// transcript fixtures ARE the replayable gate — same fixtures in → same
// pass/fail out (R-003/R-014 pattern, T6 smoke-spec shape). Runs under
// `bun test` and `node --test`.

import { test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { detectTailnetSync } from "../src/tailnet-sync-gate.mjs";

process.env.TAILNET_HUB_HOST = "hub.example.invalid";

const here = path.dirname(fileURLToPath(import.meta.url));
const redDir = path.join(here, "fixtures", "red");
const greenDir = path.join(here, "fixtures", "green");

function loadFixtures(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ file: f, ...JSON.parse(readFileSync(path.join(dir, f), "utf8")) }));
}

const reds = loadFixtures(redDir);
const greens = loadFixtures(greenDir);

test("fixture coverage: 2 specimens + evasion REDs + GREEN references present", () => {
  expect(reds.length).toBeGreaterThanOrEqual(7);
  expect(greens.length).toBeGreaterThanOrEqual(6);
});

for (const fx of reds) {
  test(`RED ${fx.file} (${fx.specimen}) → FLAG ${fx.violation}`, () => {
    const result = detectTailnetSync(fx);
    expect(result.verdict).toBe("FLAG");
    const codes = result.violations.map((v) => v.code);
    expect(codes).toContain(fx.violation);
  });
}

for (const fx of greens) {
  test(`GREEN ${fx.file} (${fx.specimen}) → PASS`, () => {
    const result = detectTailnetSync(fx);
    expect(result.verdict).toBe("PASS");
    expect(result.violations.length).toBe(0);
  });
}

test("replay is deterministic", () => {
  for (const fx of [...reds, ...greens]) {
    expect(JSON.stringify(detectTailnetSync(fx))).toBe(JSON.stringify(detectTailnetSync(fx)));
  }
});

test("dashboard Write + 'published' with NO mirror and NO probe is always a FLAG (both codes)", () => {
  const bare = {
    events: [
      { role: "user", text: "publish it" },
      {
        role: "assistant",
        text: "Published ✅ — live on the hub.",
        tools: [{ name: "Write", input: { file_path: "docs.local/dashboards/x.html", content: "<html></html>" } }],
      },
    ],
  };
  const r = detectTailnetSync(bare);
  expect(r.verdict).toBe("FLAG");
  const codes = r.violations.map((v) => v.code);
  expect(codes).toContain("DASHBOARD_NOT_MIRRORED");
  expect(codes).toContain("DASHBOARD_NOT_200");
});

test("no dashboard Write → PASS (N/A) even with a loud 'published' claim", () => {
  const t = {
    events: [
      { role: "user", text: "publish the report" },
      { role: "assistant", text: "Published ✅ — it's live on the hub at the tailnet URL." },
    ],
  };
  const r = detectTailnetSync(t);
  expect(r.verdict).toBe("PASS");
  expect(r.dashboardWrite).toBe(false);
});

test("prose claiming a mirror + 200 (no real tools) does NOT clear the gate", () => {
  const t = {
    events: [
      { role: "user", text: "ship it" },
      {
        role: "assistant",
        text: "Mirrored to dashboards-serve/dashboards/x and curl https://hub.example.invalid/x.html returned 200. Published ✅.",
        tools: [{ name: "Write", input: { file_path: "docs.local/dashboards/x.html", content: "<html></html>" } }],
      },
    ],
  };
  expect(detectTailnetSync(t).verdict).toBe("FLAG");
});
