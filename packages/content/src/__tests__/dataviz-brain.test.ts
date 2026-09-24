/**
 * Brain dataviz fetcher: reads BrainLayer's published observability document
 * (written every 5 min by BrainLayer's own com.brainlayer.observability job),
 * never the live database.
 */

import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { fetchBrainData } from "../dataviz/fetchers/brain";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function writeDoc(doc: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "brain-obs-"));
  dirs.push(dir);
  const path = join(dir, "observability.json");
  writeFileSync(path, JSON.stringify(doc));
  return path;
}

const PRIVATE_PREVIEW = "private chunk text that must never reach a chart";

const DOC = {
  schema_version: 1,
  generated_at: "2026-09-24T22:45:10Z",
  window_hours: 24,
  stores: {
    state: "measured",
    reason: "",
    total_chunks: 902998,
    by_content_class: [
      { content_class: "cold", count: 385 },
      { content_class: "knowledge", count: 791977 },
      { content_class: "decision", count: 96137 },
    ],
    in_window: {
      count: 165,
      by_hour: [
        { hour: "2026-09-23T22:00:00Z", count: 22 },
        { hour: "2026-09-23T23:00:00Z", count: 143 },
      ],
    },
    latest: [{ chunk_id: "c1", preview: PRIVATE_PREVIEW }],
  },
};

describe("fetchBrainData (BrainLayer observability document)", () => {
  it("reads totals, content classes and the hourly window from the document", async () => {
    const data = await fetchBrainData({ path: writeDoc(DOC) });
    expect(data.state).toBe("measured");
    expect(data.totalChunks).toBe(902998);
    expect(data.contentClasses).toEqual([
      { contentClass: "knowledge", count: 791977 },
      { contentClass: "decision", count: 96137 },
      { contentClass: "cold", count: 385 },
    ]);
    expect(data.storesInWindow).toBe(165);
    expect(data.windowHours).toBe(24);
    expect(data.hourly).toEqual([
      { hour: "2026-09-23T22:00:00Z", count: 22 },
      { hour: "2026-09-23T23:00:00Z", count: 143 },
    ]);
    expect(data.generatedAt).toBe("2026-09-24T22:45:10Z");
  });

  it("never carries chunk previews into chart data", async () => {
    const data = await fetchBrainData({ path: writeDoc(DOC) });
    expect(JSON.stringify(data)).not.toContain(PRIVATE_PREVIEW);
  });

  it("reports a missing document as unavailable, naming the path", async () => {
    const path = join(tmpdir(), "brain-obs-missing", "observability.json");
    const data = await fetchBrainData({ path });
    expect(data.state).toBe("unavailable");
    expect(data.reason).toContain(path);
    expect(data.totalChunks).toBe(0);
  });

  it("passes through an unmeasurable stores section as unavailable", async () => {
    const path = writeDoc({ ...DOC, stores: { state: "unmeasurable", reason: "database locked" } });
    const data = await fetchBrainData({ path });
    expect(data.state).toBe("unavailable");
    expect(data.reason).toContain("database locked");
  });

  it.each([
    ["an unknown schema_version", { ...DOC, schema_version: 2 }, "schema_version 2"],
    ["a missing schema_version", (({ schema_version: _v, ...rest }) => rest)(DOC), "schema_version missing"],
  ])("refuses %s instead of mis-reading it", async (_label, doc, expected) => {
    const path = writeDoc(doc);
    const data = await fetchBrainData({ path });
    expect(data.state).toBe("unavailable");
    expect(data.reason).toContain(expected);
    expect(data.reason).toContain("expected 1");
    expect(data.totalChunks).toBe(0);
  });

  it("never opens a database itself", () => {
    const source = readFileSync(join(import.meta.dir, "../dataviz/fetchers/brain.ts"), "utf8");
    expect(source).not.toMatch(/bun:sqlite|better-sqlite3|\.db["'`]/);
  });
});

describe("renderLineChart x labels", () => {
  it("draws the last label once when it also falls on the label step", async () => {
    const { renderLineChart } = await import("../dataviz/charts/line");
    // 25 hourly points (BrainLayer's 24h window, both ends inclusive): step 4 lands on index 24.
    const data = Array.from({ length: 25 }, (_, i) => ({ date: `h${i}`, value: i }));
    const svg = renderLineChart({ data });
    expect(svg.match(/>h24</g)?.length).toBe(1);
    expect(svg.match(/>h0</g)?.length).toBe(1);
  });
});
