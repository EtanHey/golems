import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyPane,
  formatMarkdown,
  runPaneLivenessSweep,
} from "../src/pane-liveness-check.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function loadFixtures(kind) {
  const dir = path.join(here, "fixtures", kind);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({ name, ...JSON.parse(readFileSync(path.join(dir, name), "utf8")) }));
}

const reds = loadFixtures("red");
const greens = loadFixtures("green");

function naiveIdleCheck(fixture) {
  return fixture.observation.agent_state === "idle" ? "CLOSE-CANDIDATE" : "KEEP-live";
}

test("fixture coverage pins all recorded incidents and controls", () => {
  expect(reds.length).toBe(6);
  expect(greens.length).toBeGreaterThanOrEqual(4);
});

for (const fixture of reds) {
  test(`RED ${fixture.name}: naive idle check is wrong`, () => {
    expect(naiveIdleCheck(fixture)).not.toBe(fixture.expected.verdict);
  });

  test(`RED ${fixture.name}: safe classifier returns the recorded verdict`, () => {
    const row = classifyPane(fixture.enumerated, fixture.observation);
    expect(row.verdict).toBe(fixture.expected.verdict);
    expect(row.surface_uuid).toBe(fixture.enumerated.id);
    if (fixture.expected.identity_status) {
      expect(row.identity_status).toBe(fixture.expected.identity_status);
    }
    expect(JSON.stringify(row)).not.toContain('"cost"');
  });
}

for (const fixture of greens) {
  test(`GREEN ${fixture.name}: control verdict and metadata`, () => {
    const row = classifyPane(fixture.enumerated, fixture.observation);
    expect(row.verdict).toBe(fixture.expected.verdict);
    if (Object.hasOwn(fixture.expected, "owner")) expect(row.owner).toBe(fixture.expected.owner);
    if (Object.hasOwn(fixture.expected, "untitled")) expect(row.untitled).toBe(fixture.expected.untitled);
  });
}

test("repository names never imply ownership", () => {
  const fixture = greens.find((item) => item.name.startsWith("03-"));
  const row = classifyPane(fixture.enumerated, fixture.observation);
  expect(row.owner).toBe("UNKNOWN");
});

test("explicit owner annotations are derivable", () => {
  const fixture = greens.find((item) => item.name.startsWith("02-"));
  const row = classifyPane(fixture.enumerated, fixture.observation);
  expect(row.owner).toBe("maintenance");
});

test("markdown output is a claim-or-close table with no billing field", () => {
  const rows = greens.map((fixture) => classifyPane(fixture.enumerated, fixture.observation));
  const report = formatMarkdown(rows);
  expect(report).toContain("surface_uuid | surface | title | owner | process alive?");
  expect(report).toContain("CLOSE-CANDIDATE");
  expect(report.toLowerCase()).not.toContain("cost");
  expect(report.toLowerCase()).not.toContain("burn");
});

test("classification replay is deterministic", () => {
  for (const fixture of [...reds, ...greens]) {
    expect(JSON.stringify(classifyPane(fixture.enumerated, fixture.observation))).toBe(
      JSON.stringify(classifyPane(fixture.enumerated, fixture.observation)),
    );
  }
});

test("stale numeric ref fails closed before any read", async () => {
  const fixture = reds.find((item) => item.name.startsWith("06-"));
  const liveWorker = {
    ...fixture.enumerated,
    id: fixture.observation.resolved_id,
    title: fixture.observation.resolved_title,
  };
  const calls = [];
  const adapter = {
    async listSurfaces(options) {
      calls.push(["listSurfaces", options]);
      return calls.length === 1 ? [fixture.enumerated] : [liveWorker];
    },
    async atomicRead() {
      calls.push(["atomicRead"]);
      throw new Error("must not read a retargeted ref");
    },
    async readParsedScreen() {
      calls.push(["readParsedScreen"]);
      throw new Error("must not parse a retargeted ref");
    },
    async collectEvidence() {
      calls.push(["collectEvidence"]);
      throw new Error("must not inspect artifacts for a retargeted ref");
    },
  };

  const rows = await runPaneLivenessSweep(adapter);
  expect(rows).toHaveLength(1);
  expect(rows[0].surface_uuid).toBe(fixture.enumerated.id);
  expect(rows[0].identity_status).toBe("STALE-REF");
  expect(rows[0].verdict).toBeNull();
  expect(calls.every(([name, options]) => name !== "listSurfaces" || options?.verbose === true)).toBe(true);
  expect(calls.some(([name]) => name === "atomicRead")).toBe(false);
  expect(calls.some(([name]) => name === "readParsedScreen")).toBe(false);
});

test("atomic read UUID mismatch discards the read and emits no disposition", async () => {
  const fixture = greens.find((item) => item.name.startsWith("01-"));
  const calls = [];
  const adapter = {
    async listSurfaces(options) {
      calls.push(["listSurfaces", options]);
      return [fixture.enumerated];
    },
    async atomicRead(ref, options) {
      calls.push(["atomicRead", ref, options]);
      return { surface_id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", text: "different pane" };
    },
    async readParsedScreen() {
      calls.push(["readParsedScreen"]);
      throw new Error("parsed read must not run after atomic UUID mismatch");
    },
    async collectEvidence() {
      calls.push(["collectEvidence"]);
      throw new Error("artifact inspection must not run after atomic UUID mismatch");
    },
  };

  const rows = await runPaneLivenessSweep(adapter);
  expect(rows[0].identity_status).toBe("STALE-REF");
  expect(rows[0].verdict).toBeNull();
  expect(calls.some(([name]) => name === "readParsedScreen")).toBe(false);
  expect(calls.some(([name]) => name === "collectEvidence")).toBe(false);
});

test("post-read UUID mismatch discards parsed evidence and emits no disposition", async () => {
  const fixture = greens.find((item) => item.name.startsWith("01-"));
  const retargeted = {
    ...fixture.enumerated,
    id: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB",
    title: "different live worker",
  };
  let lists = 0;
  const calls = [];
  const adapter = {
    async listSurfaces(options) {
      calls.push(["listSurfaces", options]);
      lists += 1;
      return lists < 4 ? [fixture.enumerated] : [retargeted];
    },
    async atomicRead(ref, options) {
      calls.push(["atomicRead", ref, options]);
      return { surface_id: fixture.enumerated.id, text: "enumerated pane" };
    },
    async readParsedScreen(ref) {
      calls.push(["readParsedScreen", ref]);
      return { parsed: { status: "done", control_state: "ready" } };
    },
    async collectEvidence() {
      calls.push(["collectEvidence"]);
      throw new Error("artifact inspection must not run after post-read UUID mismatch");
    },
  };

  const rows = await runPaneLivenessSweep(adapter);
  expect(rows[0].identity_status).toBe("STALE-REF");
  expect(rows[0].verdict).toBeNull();
  expect(calls.filter(([name]) => name === "listSurfaces")).toHaveLength(4);
  expect(calls.some(([name]) => name === "collectEvidence")).toBe(false);
});

test("numeric ref is re-resolved immediately before the parsed read", async () => {
  const fixture = greens.find((item) => item.name.startsWith("01-"));
  const retargeted = {
    ...fixture.enumerated,
    id: "DDDDDDDD-DDDD-4DDD-8DDD-DDDDDDDDDDDD",
    title: "replacement pane",
  };
  let lists = 0;
  const calls = [];
  const adapter = {
    async listSurfaces(options) {
      calls.push(["listSurfaces", options]);
      lists += 1;
      return lists < 3 ? [fixture.enumerated] : [retargeted];
    },
    async atomicRead(ref, options) {
      calls.push(["atomicRead", ref, options]);
      return { surface_id: fixture.enumerated.id, text: "enumerated pane" };
    },
    async readParsedScreen() {
      calls.push(["readParsedScreen"]);
      throw new Error("parsed read must not run after its pre-read UUID check fails");
    },
    async collectEvidence() {
      calls.push(["collectEvidence"]);
      throw new Error("artifact inspection must not run after a stale ref");
    },
  };

  const rows = await runPaneLivenessSweep(adapter);
  expect(rows[0].identity_status).toBe("STALE-REF");
  expect(rows[0].verdict).toBeNull();
  expect(calls.some(([name]) => name === "readParsedScreen")).toBe(false);
  expect(calls.some(([name]) => name === "collectEvidence")).toBe(false);
});

test("parsed read UUID mismatch is stale even when the numeric ref still looks stable", async () => {
  const fixture = greens.find((item) => item.name.startsWith("01-"));
  const calls = [];
  const adapter = {
    async listSurfaces(options) {
      calls.push(["listSurfaces", options]);
      return [fixture.enumerated];
    },
    async atomicRead(ref, options) {
      calls.push(["atomicRead", ref, options]);
      return { surface_id: fixture.enumerated.id, text: "enumerated pane" };
    },
    async readParsedScreen(ref) {
      calls.push(["readParsedScreen", ref]);
      return {
        surface_uuid: "CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC",
        parsed: { status: "done", control_state: "ready" },
      };
    },
    async collectEvidence() {
      calls.push(["collectEvidence"]);
      throw new Error("artifact inspection must not run after parsed UUID mismatch");
    },
  };

  const rows = await runPaneLivenessSweep(adapter);
  expect(rows[0].identity_status).toBe("STALE-REF");
  expect(rows[0].verdict).toBeNull();
  expect(calls.some(([name]) => name === "collectEvidence")).toBe(false);
});

test("successful sweep uses the ratified read-only identity order", async () => {
  const fixture = greens.find((item) => item.name.startsWith("01-"));
  const calls = [];
  const adapter = {
    async listSurfaces(options) {
      calls.push(["listSurfaces", options]);
      return [fixture.enumerated];
    },
    async atomicRead(ref, options) {
      calls.push(["atomicRead", ref, options]);
      return { surface_id: fixture.enumerated.id, text: "same pane" };
    },
    async readParsedScreen(ref) {
      calls.push(["readParsedScreen", ref]);
      return { parsed: { status: "done", control_state: "ready" } };
    },
    async collectEvidence(surface) {
      calls.push(["collectEvidence", surface.id]);
      return fixture.observation;
    },
  };

  const rows = await runPaneLivenessSweep(adapter);
  expect(rows[0].verdict).toBe("CLOSE-CANDIDATE");
  expect(calls.map(([name]) => name)).toEqual([
    "listSurfaces",
    "listSurfaces",
    "atomicRead",
    "listSurfaces",
    "readParsedScreen",
    "listSurfaces",
    "collectEvidence",
  ]);
  expect(calls.every(([name, options]) => name !== "listSurfaces" || options.verbose === true)).toBe(true);
});

test("a per-pane read failure keeps the pane and does not abort later rows", async () => {
  const first = greens.find((item) => item.name.startsWith("01-")).enumerated;
  const secondFixture = greens.find((item) => item.name.startsWith("02-"));
  const surfaces = [first, secondFixture.enumerated];
  const adapter = {
    async listSurfaces() {
      return surfaces;
    },
    async atomicRead(ref) {
      if (ref === first.ref) throw new Error("surface read failed");
      return { surface_id: secondFixture.enumerated.id, text: "live" };
    },
    async readParsedScreen() {
      return { parsed: { status: "working", control_state: "busy" } };
    },
    async collectEvidence() {
      return secondFixture.observation;
    },
  };

  const rows = await runPaneLivenessSweep(adapter);
  expect(rows).toHaveLength(2);
  expect(rows[0].verdict).toBe("KEEP-blocked");
  expect(rows[0].reason).toContain("surface read failed");
  expect(rows[1].verdict).toBe("KEEP-live");
});

test("a surface with unknown type stays visible and fails closed", async () => {
  const fixture = greens.find((item) => item.name.startsWith("03-"));
  const surface = { ...fixture.enumerated };
  delete surface.type;
  const adapter = {
    async listSurfaces() {
      return [surface];
    },
    async atomicRead() {
      return { surface_id: surface.id, text: "unknown schema" };
    },
    async readParsedScreen() {
      return { parsed: {} };
    },
    async collectEvidence() {
      return { ...fixture.observation, process_alive: null };
    },
  };

  const rows = await runPaneLivenessSweep(adapter);
  expect(rows).toHaveLength(1);
  expect(rows[0].verdict).toBe("KEEP-blocked");
});
