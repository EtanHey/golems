import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const evalRoot = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(evalRoot, "..");
const fixture = JSON.parse(
  readFileSync(path.join(evalRoot, "fixtures", "red", "12-narration-vendor-pre-sync.json"), "utf8"),
);
const modulePath = path.join(skillRoot, "src", "narration-vendor-drift.mjs");
const cliPath = path.join(skillRoot, "scripts", "lint-narration-vendor-drift.mjs");
const stampPath = path.join(skillRoot, "vendor", "narrationlayer", "VENDOR-VERSION");

async function loadSubject() {
  return import(pathToFileURL(modulePath).href).catch(() => ({}));
}

async function subjectFunction(name) {
  const subject = await loadSubject();
  expect(typeof subject[name]).toBe("function");
  return typeof subject[name] === "function" ? subject[name] : undefined;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function initNarrationGit(root) {
  const commands = [
    ["init", "-q"],
    ["config", "user.email", "lane-c@example.invalid"],
    ["config", "user.name", "Lane C Test"],
    ["remote", "add", "origin", "https://github.com/EtanHey/narrationlayer.git"],
    ["commit", "--allow-empty", "-m", "fixture root"],
  ];
  for (const args of commands) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  }
}

function resolvedStamp() {
  const stamp = clone(fixture.stamp);
  stamp.upstreamSideFirst = [];
  stamp.vendorSideFirst = stamp.vendorSideFirst.map((debt) => ({
    ...debt,
    status: "resolved",
    resolvedUpstreamCommit: stamp.upstream.commit,
  }));
  return stamp;
}

function stampWithOpenUpstreamDebt() {
  const stamp = resolvedStamp();
  stamp.upstreamSideFirst = [
    {
      id: "VOICE_SSOT_PROFILE_CACHE_KEY",
      pairId: "local-tts-runner",
      status: "open",
      aidevNote:
        "The vendored runtime lacks upstream voice-SSOT profile identity in its frozen-take cache key.",
      requiredUpstreamPatterns: ["profileVersion?: string;"],
      testCommand: ["bun", "test", "tests/local-tts-runner.test.ts"],
    },
  ];
  return stamp;
}

async function makeRefreshHarness({ omitPattern } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "narration-vendor-refresh-"));
  const skill = path.join(root, "skill");
  const upstream = path.join(root, "upstream");
  const stamp = clone(fixture.stamp);
  stamp.upstreamSideFirst = [];
  stamp.pairs = stamp.pairs.filter((pair) =>
    ["local-tts-runner", "word-timing-repair"].includes(pair.id),
  );
  stamp.vendorSideFirst = stamp.vendorSideFirst.map((debt) => ({ ...debt, status: "open" }));
  for (const pair of stamp.pairs) {
    await Bun.write(path.join(skill, pair.vendorPath), `vendor bytes for ${pair.id}\n`);
    const debt = stamp.vendorSideFirst.find((item) => item.pairId === pair.id);
    const patterns = debt.requiredUpstreamPatterns.filter((pattern) => pattern !== omitPattern);
    await Bun.write(path.join(upstream, pair.sourcePath), `${patterns.join("\n")}\n`);
  }
  const manifestPath = path.join(skill, "vendor", "narrationlayer", "VENDOR-VERSION");
  writeFileSync(manifestPath, `${JSON.stringify(stamp, null, 2)}\n`);
  return { root, skill, upstream, stamp, manifestPath };
}

const cleanUpstream = {
  head: "e".repeat(40),
  committedAt: "2026-07-17T15:00:00+03:00",
  dirty: "",
  repository: "EtanHey/narrationlayer",
};

test("real 2026-07-17 pre-sync state rejects both vendor-first debts", async () => {
  const classifyVendorDrift = await subjectFunction("classifyVendorDrift");
  if (!classifyVendorDrift) return;

  const result = classifyVendorDrift(fixture.stamp, fixture.observed);
  expect(result.verdict).toBe("REJECTED");
  expect(result.records.map((row) => row.metric)).toEqual(["VENDOR_AHEAD", "VENDOR_AHEAD"]);
  expect(result.records.map((row) => row.target)).toEqual([
    "vendor/narrationlayer/local-tts-runner.ts",
    "vendor/narrationlayer/word-timing-repair.ts",
  ]);
  expect(result.records.every((row) => row.pairId && row.sourcePath && row.vendorPath)).toBe(true);
});

test("the RED fixture remains the immutable real pre-sync snapshot after stamp resolution", () => {
  expect(fixture).toMatchObject({
    specimen: "2026-07-17 real narrationlayer vendor-first drift before Lane C upstream sync",
    capturedAt: "2026-07-17T12:31:56Z",
    golemsHead: "84c111ef34596099866295b7ba3f8a6911fb2f6e",
    observed: { upstreamHead: "2ea3d6ccf3105611c5e27409622d52e68dc3e338" },
  });
  expect(fixture.stamp.vendorSideFirst.every((debt) => debt.status === "open")).toBe(true);
  expect(existsSync(stampPath)).toBe(true);
  if (!existsSync(stampPath)) return;
  const current = JSON.parse(readFileSync(stampPath, "utf8"));
  expect(current).not.toEqual(fixture.stamp);
  const originalDebtIds = new Set(["D6d_CACHE_RECEIPT", "D6a_RAW_SERIES"]);
  expect(
    current.vendorSideFirst
      .filter((debt) => originalDebtIds.has(debt.id))
      .every(
        (debt) =>
          debt.status === "resolved" &&
          debt.resolvedUpstreamCommit === "6b1b5904d37e292b5c6f87a83ad986b1b579168b",
      ),
  ).toBe(true);
  expect(
    current.vendorSideFirst
      .filter((debt) => ["B13_SPEECH_SANITIZER", "B13_TIMING_ALIASES"].includes(debt.id))
      .map((debt) => debt.status),
  ).toEqual(["open", "open"]);
  expect(current.vendorSideFirst).toContainEqual(
    expect.objectContaining({
      id: "B13_SPOKEN_PROVENANCE_AFTER_WAV",
      status: "resolved",
      resolvedUpstreamCommit: current.upstream.commit,
    }),
  );
});

test("classifies vendor-only, upstream-only, and bidirectional movement", async () => {
  const classifyVendorDrift = await subjectFunction("classifyVendorDrift");
  if (!classifyVendorDrift) return;

  const stamp = resolvedStamp();
  const cases = [
    ["vendorSha256", "VENDOR_AHEAD"],
    ["sourceSha256", "VENDOR_BEHIND"],
    ["both", "BIDIRECTIONAL_DRIFT"],
  ];
  for (const [changed, metric] of cases) {
    const observed = clone(fixture.observed);
    if (changed === "vendorSha256" || changed === "both") observed.pairs[0].vendorSha256 = "a".repeat(64);
    if (changed === "sourceSha256" || changed === "both") observed.pairs[0].sourceSha256 = "b".repeat(64);
    const result = classifyVendorDrift(stamp, observed);
    expect(result.verdict).toBe("REJECTED");
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      pairId: "local-tts-runner",
      sourcePath: "bin/local-tts-runner.ts",
      vendorPath: "vendor/narrationlayer/local-tts-runner.ts",
      target: "vendor/narrationlayer/local-tts-runner.ts",
      metric,
    });
  }
});

test("new upstream bytes plus an open vendor-first debt is bidirectional drift", async () => {
  const classifyVendorDrift = await subjectFunction("classifyVendorDrift");
  if (!classifyVendorDrift) return;

  const observed = clone(fixture.observed);
  observed.pairs[0].sourceSha256 = "d".repeat(64);
  const result = classifyVendorDrift(fixture.stamp, observed);
  expect(result.verdict).toBe("REJECTED");
  expect(result.records.filter((row) => row.pairId === "local-tts-runner")).toEqual([
    expect.objectContaining({
      metric: "BIDIRECTIONAL_DRIFT",
      evidence: expect.stringContaining("D6d_CACHE_RECEIPT"),
    }),
  ]);
});

test("open upstream-first debt rejects unchanged stamped hashes as vendor behind", async () => {
  const classifyVendorDrift = await subjectFunction("classifyVendorDrift");
  if (!classifyVendorDrift) return;

  const result = classifyVendorDrift(stampWithOpenUpstreamDebt(), fixture.observed);
  expect(result.verdict).toBe("REJECTED");
  expect(result.records).toContainEqual(
    expect.objectContaining({
      pairId: "local-tts-runner",
      metric: "VENDOR_BEHIND",
      value: "open",
      threshold: "resolved",
      evidence: expect.stringContaining("VOICE_SSOT_PROFILE_CACHE_KEY"),
    }),
  );
});

test("open upstream-first debt stays named when upstream bytes move again", async () => {
  const classifyVendorDrift = await subjectFunction("classifyVendorDrift");
  if (!classifyVendorDrift) return;

  const observed = clone(fixture.observed);
  observed.pairs[0].sourceSha256 = "b".repeat(64);
  const result = classifyVendorDrift(stampWithOpenUpstreamDebt(), observed);
  expect(result.verdict).toBe("REJECTED");
  expect(result.records).toContainEqual(
    expect.objectContaining({
      pairId: "local-tts-runner",
      metric: "VENDOR_BEHIND",
      evidence: expect.stringContaining("VOICE_SSOT_PROFILE_CACHE_KEY"),
    }),
  );
});

test("stamp-only mode keeps open upstream-first debt visible and rejected", async () => {
  const classifyVendorDrift = await subjectFunction("classifyVendorDrift");
  if (!classifyVendorDrift) return;

  const withoutSource = clone(fixture.observed);
  withoutSource.upstreamHead = null;
  withoutSource.pairs = withoutSource.pairs.map(({ sourceSha256: _sourceSha256, ...pair }) => pair);
  const result = classifyVendorDrift(stampWithOpenUpstreamDebt(), withoutSource, {
    upstreamAvailable: false,
  });
  expect(result.verdict).toBe("REJECTED");
  expect(result.records).toContainEqual(
    expect.objectContaining({ metric: "UPSTREAM_UNAVAILABLE", value: "stamp-only" }),
  );
  expect(result.records).toContainEqual(
    expect.objectContaining({
      pairId: "local-tts-runner",
      metric: "VENDOR_BEHIND",
      value: "open",
      evidence: expect.stringContaining("VOICE_SSOT_PROFILE_CACHE_KEY"),
    }),
  );
});

test("missing upstream degrades loudly and validates stamp-only state", async () => {
  const classifyVendorDrift = await subjectFunction("classifyVendorDrift");
  if (!classifyVendorDrift) return;

  const observed = clone(fixture.observed);
  observed.upstreamHead = null;
  observed.pairs = observed.pairs.map(({ sourceSha256: _sourceSha256, ...pair }) => pair);
  const result = classifyVendorDrift(resolvedStamp(), observed, { upstreamAvailable: false });
  expect(result.verdict).toBe("DEGRADED");
  expect(result.records).toHaveLength(1);
  expect(result.records[0]).toMatchObject({
    pairId: "manifest",
    vendorPath: "vendor/narrationlayer/VENDOR-VERSION",
    metric: "UPSTREAM_UNAVAILABLE",
    value: "stamp-only",
  });
});

test("stamp-only remains rejected for open debt or stale vendor bytes", async () => {
  const classifyVendorDrift = await subjectFunction("classifyVendorDrift");
  if (!classifyVendorDrift) return;

  const withoutSource = clone(fixture.observed);
  withoutSource.upstreamHead = null;
  withoutSource.pairs = withoutSource.pairs.map(({ sourceSha256: _sourceSha256, ...pair }) => pair);
  expect(classifyVendorDrift(fixture.stamp, withoutSource, { upstreamAvailable: false }).verdict).toBe(
    "REJECTED",
  );

  const staleVendor = clone(withoutSource);
  staleVendor.pairs[0].vendorSha256 = "c".repeat(64);
  const result = classifyVendorDrift(resolvedStamp(), staleVendor, { upstreamAvailable: false });
  expect(result.verdict).toBe("REJECTED");
  expect(result.records.map((row) => row.metric)).toEqual(["VENDOR_AHEAD", "UPSTREAM_UNAVAILABLE"]);
});

test("stamp parser rejects missing and malformed manifests with typed metrics", async () => {
  const parseVendorStamp = await subjectFunction("parseVendorStamp");
  if (!parseVendorStamp) return;

  expect(parseVendorStamp(undefined)).toMatchObject({ ok: false, record: { metric: "STAMP_MISSING" } });
  expect(parseVendorStamp("not json")).toMatchObject({ ok: false, record: { metric: "STAMP_INVALID" } });
  expect(parseVendorStamp("{}")).toMatchObject({ ok: false, record: { metric: "STAMP_INVALID" } });

  const wrongVendor = resolvedStamp();
  wrongVendor.vendor = "narration-layer";
  expect(parseVendorStamp(JSON.stringify(wrongVendor))).toMatchObject({
    ok: false,
    record: { metric: "STAMP_INVALID", evidence: expect.stringContaining("vendor must equal") },
  });

  for (const [field, unsafePath] of [
    ["vendorPath", "../outside.ts"],
    ["vendorPath", "/tmp/outside.ts"],
    ["sourcePath", "../../outside.ts"],
    ["sourcePath", "C:\\outside.ts"],
  ]) {
    const unsafe = resolvedStamp();
    unsafe.pairs[0][field] = unsafePath;
    expect(parseVendorStamp(JSON.stringify(unsafe))).toMatchObject({
      ok: false,
      record: { metric: "STAMP_INVALID", evidence: expect.stringContaining("relative") },
    });
  }
});

test("observes current hashes from explicit vendor and upstream roots", async () => {
  const observeVendorState = await subjectFunction("observeVendorState");
  if (!observeVendorState) return;

  const root = mkdtempSync(path.join(tmpdir(), "narration-vendor-observe-"));
  const vendorRoot = path.join(root, "skill");
  const upstreamRoot = path.join(root, "upstream");
  const pair = fixture.stamp.pairs[3];
  const vendorFile = path.join(vendorRoot, pair.vendorPath);
  const sourceFile = path.join(upstreamRoot, pair.sourcePath);
  try {
    await Bun.write(vendorFile, "same bytes\n");
    await Bun.write(sourceFile, "same bytes\n");

    const observed = await observeVendorState({
      skillRoot: vendorRoot,
      upstreamRoot,
      stamp: {
        ...resolvedStamp(),
        pairs: [pair],
      },
    });
    expect(observed.pairs).toHaveLength(1);
    expect(observed.pairs[0].vendorSha256).toBe(observed.pairs[0].sourceSha256);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stamp refresh refuses a dirty upstream without mutating the manifest", async () => {
  const refreshVendorStamp = await subjectFunction("refreshVendorStamp");
  if (!refreshVendorStamp) return;
  const harness = await makeRefreshHarness();
  const before = readFileSync(harness.manifestPath, "utf8");
  try {
    await expect(
      refreshVendorStamp({
        skillRoot: harness.skill,
        upstreamRoot: harness.upstream,
        stampPath: harness.manifestPath,
        stamp: harness.stamp,
        inspectUpstream: async () => ({ ...cleanUpstream, dirty: " M src/file.ts" }),
        runTest: async () => ({ status: 0, stdout: "ok", stderr: "" }),
        vendorDate: "2026-07-17",
      }),
    ).rejects.toThrow("dirty upstream");
    expect(readFileSync(harness.manifestPath, "utf8")).toBe(before);
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test("stamp refresh refuses a clean checkout from the wrong repository", async () => {
  const refreshVendorStamp = await subjectFunction("refreshVendorStamp");
  if (!refreshVendorStamp) return;
  const harness = await makeRefreshHarness();
  const before = readFileSync(harness.manifestPath, "utf8");
  try {
    await expect(
      refreshVendorStamp({
        skillRoot: harness.skill,
        upstreamRoot: harness.upstream,
        stampPath: harness.manifestPath,
        stamp: harness.stamp,
        inspectUpstream: async () => ({
          ...cleanUpstream,
          repository: "EtanHey/not-narrationlayer",
        }),
        runTest: async () => ({ status: 0, stdout: "ok", stderr: "" }),
        vendorDate: "2026-07-17",
      }),
    ).rejects.toThrow("upstream repository mismatch");
    expect(readFileSync(harness.manifestPath, "utf8")).toBe(before);
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test("stamp refresh treats untracked source files as dirty, not committed provenance", async () => {
  const refreshVendorStamp = await subjectFunction("refreshVendorStamp");
  if (!refreshVendorStamp) return;
  const harness = await makeRefreshHarness();
  initNarrationGit(harness.upstream);
  const before = readFileSync(harness.manifestPath, "utf8");
  try {
    await expect(
      refreshVendorStamp({
        skillRoot: harness.skill,
        upstreamRoot: harness.upstream,
        stampPath: harness.manifestPath,
        stamp: harness.stamp,
        runTest: async () => ({ status: 0, stdout: "ok", stderr: "" }),
        vendorDate: "2026-07-17",
      }),
    ).rejects.toThrow("dirty upstream");
    expect(readFileSync(harness.manifestPath, "utf8")).toBe(before);
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test("stamp refresh refuses missing debt markers and failing targeted tests", async () => {
  const refreshVendorStamp = await subjectFunction("refreshVendorStamp");
  if (!refreshVendorStamp) return;

  const missingPattern = fixture.stamp.vendorSideFirst[0].requiredUpstreamPatterns[0];
  const markerHarness = await makeRefreshHarness({ omitPattern: missingPattern });
  try {
    await expect(
      refreshVendorStamp({
        skillRoot: markerHarness.skill,
        upstreamRoot: markerHarness.upstream,
        stampPath: markerHarness.manifestPath,
        stamp: markerHarness.stamp,
        inspectUpstream: async () => cleanUpstream,
        runTest: async () => ({ status: 0, stdout: "ok", stderr: "" }),
        vendorDate: "2026-07-17",
      }),
    ).rejects.toThrow(missingPattern);
  } finally {
    rmSync(markerHarness.root, { recursive: true, force: true });
  }

  const testHarness = await makeRefreshHarness();
  try {
    await expect(
      refreshVendorStamp({
        skillRoot: testHarness.skill,
        upstreamRoot: testHarness.upstream,
        stampPath: testHarness.manifestPath,
        stamp: testHarness.stamp,
        inspectUpstream: async () => cleanUpstream,
        runTest: async () => ({ status: 1, stdout: "", stderr: "test failed" }),
        vendorDate: "2026-07-17",
      }),
    ).rejects.toThrow("targeted test failed");
  } finally {
    rmSync(testHarness.root, { recursive: true, force: true });
  }
});

test("stamp refresh refuses a checkout that changes during targeted tests", async () => {
  const refreshVendorStamp = await subjectFunction("refreshVendorStamp");
  if (!refreshVendorStamp) return;
  const harness = await makeRefreshHarness();
  const before = readFileSync(harness.manifestPath, "utf8");
  let inspections = 0;
  try {
    await expect(
      refreshVendorStamp({
        skillRoot: harness.skill,
        upstreamRoot: harness.upstream,
        stampPath: harness.manifestPath,
        stamp: harness.stamp,
        inspectUpstream: async () => {
          inspections += 1;
          return inspections === 1
            ? cleanUpstream
            : { ...cleanUpstream, dirty: " M src/generated.ts" };
        },
        runTest: async () => ({ status: 0, stdout: "pass", stderr: "" }),
        vendorDate: "2026-07-17",
      }),
    ).rejects.toThrow("changed during stamp refresh");
    expect(readFileSync(harness.manifestPath, "utf8")).toBe(before);
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test("stamp refresh refuses a checkout that changes while paired hashes are read", async () => {
  const refreshVendorStamp = await subjectFunction("refreshVendorStamp");
  if (!refreshVendorStamp) return;
  const harness = await makeRefreshHarness();
  const before = readFileSync(harness.manifestPath, "utf8");
  let inspections = 0;
  try {
    await expect(
      refreshVendorStamp({
        skillRoot: harness.skill,
        upstreamRoot: harness.upstream,
        stampPath: harness.manifestPath,
        stamp: harness.stamp,
        inspectUpstream: async () => {
          inspections += 1;
          return inspections < 3
            ? cleanUpstream
            : { ...cleanUpstream, dirty: " M src/hash-race.ts" };
        },
        runTest: async () => ({ status: 0, stdout: "pass", stderr: "" }),
        vendorDate: "2026-07-17",
      }),
    ).rejects.toThrow("changed while paired hashes were read");
    expect(readFileSync(harness.manifestPath, "utf8")).toBe(before);
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test("debt-resolution refresh refuses a stamp with no open vendor-first debt", async () => {
  const refreshVendorStamp = await subjectFunction("refreshVendorStamp");
  if (!refreshVendorStamp) return;
  const harness = await makeRefreshHarness();
  harness.stamp.vendorSideFirst = harness.stamp.vendorSideFirst.map((debt) => ({
    ...debt,
    status: "resolved",
    resolvedUpstreamCommit: harness.stamp.upstream.commit,
  }));
  writeFileSync(harness.manifestPath, `${JSON.stringify(harness.stamp, null, 2)}\n`);
  try {
    await expect(
      refreshVendorStamp({
        skillRoot: harness.skill,
        upstreamRoot: harness.upstream,
        stampPath: harness.manifestPath,
        stamp: harness.stamp,
        inspectUpstream: async () => cleanUpstream,
        runTest: async () => ({ status: 0, stdout: "pass", stderr: "" }),
        vendorDate: "2026-07-17",
      }),
    ).rejects.toThrow("no open vendor-first debt");
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test("stamp refresh refuses drift on pairs unrelated to the open debts", async () => {
  const refreshVendorStamp = await subjectFunction("refreshVendorStamp");
  if (!refreshVendorStamp) return;
  const harness = await makeRefreshHarness();
  const stable = "stable unrelated bytes\n";
  const changed = "changed unrelated upstream bytes\n";
  harness.stamp.pairs.push({
    id: "unrelated",
    vendorPath: "vendor/narrationlayer/unrelated.ts",
    sourcePath: "src/unrelated.ts",
    vendorSha256: sha256(stable),
    sourceSha256: sha256(stable),
  });
  await Bun.write(path.join(harness.skill, "vendor", "narrationlayer", "unrelated.ts"), stable);
  await Bun.write(path.join(harness.upstream, "src", "unrelated.ts"), changed);
  writeFileSync(harness.manifestPath, `${JSON.stringify(harness.stamp, null, 2)}\n`);
  const before = readFileSync(harness.manifestPath, "utf8");
  try {
    await expect(
      refreshVendorStamp({
        skillRoot: harness.skill,
        upstreamRoot: harness.upstream,
        stampPath: harness.manifestPath,
        stamp: harness.stamp,
        inspectUpstream: async () => cleanUpstream,
        runTest: async () => ({ status: 0, stdout: "pass", stderr: "" }),
        vendorDate: "2026-07-17",
      }),
    ).rejects.toThrow("unexpected drift outside open debt pairs");
    expect(readFileSync(harness.manifestPath, "utf8")).toBe(before);
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test("stamp refresh resolves debt and replaces every paired hash atomically", async () => {
  const refreshVendorStamp = await subjectFunction("refreshVendorStamp");
  if (!refreshVendorStamp) return;
  const harness = await makeRefreshHarness();
  const commands = [];
  try {
    const result = await refreshVendorStamp({
      skillRoot: harness.skill,
      upstreamRoot: harness.upstream,
      stampPath: harness.manifestPath,
      stamp: harness.stamp,
      inspectUpstream: async () => cleanUpstream,
      runTest: async (command) => {
        commands.push(command);
        return { status: 0, stdout: "pass", stderr: "" };
      },
      vendorDate: "2026-07-17",
    });
    const written = JSON.parse(readFileSync(harness.manifestPath, "utf8"));
    expect(written).toEqual(result.stamp);
    expect(written.upstream).toMatchObject({
      commit: cleanUpstream.head,
      committedAt: cleanUpstream.committedAt,
    });
    expect(written.vendorDate).toBe("2026-07-17");
    expect(written.vendorSideFirst.every((debt) => debt.status === "resolved")).toBe(true);
    expect(
      written.vendorSideFirst.every(
        (debt) => debt.resolvedUpstreamCommit === cleanUpstream.head,
      ),
    ).toBe(true);
    expect(
      written.pairs.every(
        (pair) =>
          pair.vendorSha256 !==
          fixture.stamp.pairs.find((old) => old.id === pair.id).vendorSha256,
      ),
    ).toBe(true);
    expect(
      written.pairs.every(
        (pair) =>
          pair.sourceSha256 !==
          fixture.stamp.pairs.find((old) => old.id === pair.id).sourceSha256,
      ),
    ).toBe(true);
    expect(commands).toEqual(harness.stamp.vendorSideFirst.map((debt) => debt.testCommand));
    expect(result.verdict).toBe("PASS");
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test("stamp refresh resolves vendor-first debt while preserving declared upstream-first debt", async () => {
  const refreshVendorStamp = await subjectFunction("refreshVendorStamp");
  if (!refreshVendorStamp) return;
  const harness = await makeRefreshHarness();
  harness.stamp.upstreamSideFirst = stampWithOpenUpstreamDebt().upstreamSideFirst;
  writeFileSync(harness.manifestPath, `${JSON.stringify(harness.stamp, null, 2)}\n`);
  try {
    const result = await refreshVendorStamp({
      skillRoot: harness.skill,
      upstreamRoot: harness.upstream,
      stampPath: harness.manifestPath,
      stamp: harness.stamp,
      inspectUpstream: async () => cleanUpstream,
      runTest: async () => ({ status: 0, stdout: "pass", stderr: "" }),
      vendorDate: "2026-07-17",
    });
    const written = JSON.parse(readFileSync(harness.manifestPath, "utf8"));
    expect(written.vendorSideFirst.every((debt) => debt.status === "resolved")).toBe(true);
    expect(written.upstreamSideFirst).toEqual(harness.stamp.upstreamSideFirst);
    expect(result.verdict).toBe("REJECTED");
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test("typed record formatting is deterministic JSON", async () => {
  const formatTypedRecord = await subjectFunction("formatTypedRecord");
  if (!formatTypedRecord) return;
  const record = {
    gate: "NARRATION_VENDOR_DRIFT",
    verdict: "REJECTED",
    pairId: "pair",
    sourcePath: "src/file.ts",
    vendorPath: "vendor/narrationlayer/file.ts",
    target: "vendor/narrationlayer/file.ts",
    metric: "VENDOR_AHEAD",
    value: "actual",
    threshold: "stamped",
    evidence: "changed",
    runbook: "sync upstream",
  };
  expect(formatTypedRecord(record)).toBe(JSON.stringify(record));
});

test("refresh CLI flags must be paired and reject unknown arguments", async () => {
  const parseVendorDriftArgs = await subjectFunction("parseVendorDriftArgs");
  if (!parseVendorDriftArgs) return;
  expect(parseVendorDriftArgs([])).toEqual({ refreshStamp: false });
  expect(parseVendorDriftArgs(["--refresh-stamp", "--resolve-open-debt"])).toEqual({
    refreshStamp: true,
  });
  expect(() => parseVendorDriftArgs(["--refresh-stamp"])).toThrow("must be used together");
  expect(() => parseVendorDriftArgs(["--resolve-open-debt"])).toThrow("must be used together");
  expect(() => parseVendorDriftArgs(["--surprise"])).toThrow("unknown argument");
});

test("CLI stamp-only mode remains rejected while upstream-first debt is open", () => {
  const env = { ...process.env };
  delete env.NARRATIONLAYER_UPSTREAM;
  const result = spawnSync("bun", [cliPath], { cwd: skillRoot, encoding: "utf8", env });
  expect(result.status).toBe(1);
  const records = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
  expect(records.some((row) => row.metric === "UPSTREAM_UNAVAILABLE" && row.value === "stamp-only")).toBe(
    true,
  );
  expect(records).toContainEqual(
    expect.objectContaining({
      pairId: "local-tts-runner",
      metric: "VENDOR_BEHIND",
      value: "open",
      evidence: expect.stringContaining("VOICE_SSOT_PROFILE_CACHE_KEY"),
    }),
  );
  expect(
    records
      .filter((row) => row.metric === "VENDOR_AHEAD" && row.value === "open")
      .map((row) => row.pairId),
  ).toEqual(["text-normalize", "word-timing-repair", "word-timings"]);
  expect(records.at(-1)).toMatchObject({ metric: "SUMMARY", verdict: "REJECTED", value: 4 });
});

test("CLI treats an exported non-checkout with every mapped file as upstream unavailable", async () => {
  const invalidRoot = mkdtempSync(path.join(tmpdir(), "narration-vendor-invalid-upstream-"));
  const env = { ...process.env, NARRATIONLAYER_UPSTREAM: invalidRoot };
  try {
    const current = JSON.parse(readFileSync(stampPath, "utf8"));
    for (const pair of current.pairs) {
      await Bun.write(path.join(invalidRoot, pair.sourcePath), `copied ${pair.id}\n`);
    }
    const result = spawnSync("bun", [cliPath], { cwd: skillRoot, encoding: "utf8", env });
    expect(result.status).toBe(1);
    const records = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
    expect(records).toContainEqual(
      expect.objectContaining({
        metric: "UPSTREAM_UNAVAILABLE",
        value: "stamp-only",
        verdict: "DEGRADED",
      }),
    );
    expect(records).toContainEqual(
      expect.objectContaining({
        pairId: "local-tts-runner",
        metric: "VENDOR_BEHIND",
        value: "open",
      }),
    );
  } finally {
    rmSync(invalidRoot, { recursive: true, force: true });
  }
});

test("CLI rejects a missing mapped file in a real NarrationLayer checkout as drift", () => {
  const checkout = mkdtempSync(path.join(tmpdir(), "narration-vendor-missing-pair-"));
  initNarrationGit(checkout);
  const env = { ...process.env, NARRATIONLAYER_UPSTREAM: checkout };
  try {
    const result = spawnSync("bun", [cliPath], { cwd: skillRoot, encoding: "utf8", env });
    expect(result.status).toBe(1);
    const records = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
    expect(records.some((row) => row.metric === "UPSTREAM_UNAVAILABLE")).toBe(false);
    expect(records.some((row) => row.metric === "VENDOR_BEHIND" && row.value === "missing")).toBe(
      true,
    );
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
});
