import { test, expect, spawnSync, createHash, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, tmpdir, fileURLToPath, path, performance, validateAudioDashboardEvidence, analyzeAcousticArtifacts, analyzeOnsetEnergy, formatOnsetEnergyReport, ONSET_ENERGY_DEFAULTS, analyzeTeleprompterDrift, formatTeleprompterDriftReport, analyzeTranscriptFidelity, formatTranscriptFidelityReport, TRANSCRIPT_FIDELITY_DEFAULTS, createBuildReceipts, readNarrationVendorStamp, writeBuildReceipts, clearTakeCacheReceiptForByo, writeWordTimingArtifacts, formatCachePurgeReceipt, purgeRejectedTakeCaches, answersMarkdown, injectDecisionSurfaceIntoHtml, buildAfterCodeDashboardPlan, renderV4, clearTakeCacheReceipt, writeTakeCacheReceipt, loadPronunciationRules, normalizeForSpeech, here, redDir, greenDir, transcriptCalibrationPath, onsetEnergyCalibrationPath, skillPath, skillRoot, placeholderMp3, placeholderMp3Duration, loadFixtures, reds, greens, evidenceReds, evidenceGreens, driftReds, driftGreens, acousticReds, onsetEnergyReds, transcriptReds, publishDriftReds, tpdataFromHtml, writeFixtureFfprobe, writeSegment, writeToneWav, writeStereoToneWav, wordsForDuration, writeAcousticSegment, acousticFixtureSegments, buildDashboard } from "./common.mjs";


test("B13 BUILD rejects stale synth provenance before aliases can absorb the real s9q substitution", () => {
  const fixture = reds.find((item) => item.file === "08-transcript-overtime-substitution.json");
  const segment = fixture.transcriptFidelity.segments[0];
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-b13-stale-spoken-"));
  const jobDir = path.join(root, "job");
  const displayWords = segment.script.split(/\s+/).map((word, index, all) => ({
    word,
    start: Number((0.02 + index * (0.82 / all.length)).toFixed(3)),
    end: Number((0.02 + (index + 0.7) * (0.82 / all.length)).toFixed(3)),
  }));
  writeSegment(jobDir, segment.id, displayWords, placeholderMp3, segment.rawWords);
  writeFileSync(
    path.join(jobDir, "segments", segment.id, `${segment.id}.wav.spoken.txt`),
    fixture.staleSynthProvenance.sidecarText,
  );

  const { result, outputPath } = buildDashboard({
    id: "b13-stale-spoken",
    title: fixture.specimen,
    scenes: [{ id: segment.id, title: segment.id, script: segment.script }],
  }, jobDir, "b13-stale-spoken");

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(`metric=${fixture.staleSynthProvenance.expectedMetric}`);
  expect(result.stderr).toContain(fixture.staleSynthProvenance.runbook);
  expect(existsSync(outputPath)).toBe(false);
  const receiptsPath = outputPath.replace(/\.html$/, ".receipts.json");
  expect(existsSync(receiptsPath)).toBe(true);
  const receipts = JSON.parse(readFileSync(receiptsPath, "utf8"));
  expect(receipts.gates.map((row) => `${row.gate}:${row.verdict}`)).toEqual([
    "voice-role:PASS",
    "transcript-fidelity:REJECT",
  ]);
  expect(receipts.gates.find((row) => row.gate === "transcript-fidelity")).toMatchObject({
    gate: "transcript-fidelity",
    stage: "BUILD",
    verdict: "REJECT",
    runbook: expect.stringContaining(fixture.staleSynthProvenance.runbook),
  });
  expect(receipts.gates.find((row) => row.gate === "transcript-fidelity").violations[0]).toMatchObject({
    segment: segment.id,
    metric: fixture.staleSynthProvenance.expectedMetric,
    value: 0,
    threshold: 1,
  });
  expect(receipts.gates.find((row) => row.gate === "transcript-fidelity").violations[0].evidence).toContain("byteEqual=false");
});

test("B13 BUILD rejects pronunciation rule drift after synthesis", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-b13-rule-drift-"));
  const jobDir = path.join(root, "job");
  const displayWords = [
    { word: "P", start: 0.05, end: 0.4 },
    { word: "R", start: 0.42, end: 0.85 },
  ];
  const rawWords = [
    { word: "pull", start: 0.05, end: 0.4 },
    { word: "request", start: 0.42, end: 0.85 },
  ];
  writeSegment(jobDir, "rule-drift", displayWords, placeholderMp3, rawWords);
  writeFileSync(
    path.join(jobDir, "segments", "rule-drift", "rule-drift.wav.spoken.txt"),
    "pull request",
  );
  const changedRules = path.join(root, "changed-pronunciation.yaml");
  writeFileSync(changedRules, "acronyms:\n  PR: \"peer review\"\n");

  const { result, outputPath } = buildDashboard({
    id: "b13-rule-drift",
    title: "B13 rule drift",
    scenes: [{ id: "rule-drift", title: "Rule drift", script: "P R" }],
  }, jobDir, "b13-rule-drift", { NARRATIONLAYER_PRONUNCIATION_FILE: changedRules });

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("metric=SYNTH_PROVENANCE_STALE");
  expect(result.stderr).toContain("rerun synth-segments");
  const receipts = JSON.parse(readFileSync(outputPath.replace(/\.html$/, ".receipts.json"), "utf8"));
  expect(receipts.gates.find((row) => row.gate === "transcript-fidelity").violations[0]).toMatchObject({
    segment: "rule-drift",
    metric: "SYNTH_PROVENANCE_STALE",
    value: 0,
    threshold: 1,
  });
});

test("B13 BUILD rejects a synthesized scene without synth provenance", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-b13-missing-spoken-"));
  const jobDir = path.join(root, "job");
  const words = [
    { word: "alpha", start: 0.05, end: 0.4 },
    { word: "beta", start: 0.42, end: 0.85 },
  ];
  writeSegment(jobDir, "missing-spoken", words);

  const { result, outputPath } = buildDashboard({
    id: "b13-missing-spoken",
    title: "B13 missing spoken",
    scenes: [{ id: "missing-spoken", title: "Missing", script: "alpha beta" }],
  }, jobDir, "b13-missing-spoken", {}, { omitSynthSidecars: true });

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("required synth-input sidecar is missing");
  expect(result.stderr).toContain("metric=MISSING_SYNTH_PROVENANCE_SERIES");
  expect(result.stderr).toContain("rerun synth-segments");
  const receiptsPath = outputPath.replace(/\.html$/, ".receipts.json");
  expect(existsSync(receiptsPath)).toBe(true);
  const receipts = JSON.parse(readFileSync(receiptsPath, "utf8"));
  expect(receipts.gates.map((row) => `${row.gate}:${row.verdict}`)).toEqual([
    "voice-role:PASS",
    "transcript-fidelity:REJECT",
  ]);
  expect(receipts.gates.find((row) => row.gate === "transcript-fidelity")).toMatchObject({
    gate: "transcript-fidelity",
    stage: "BUILD",
    verdict: "REJECT",
    runbook: expect.stringContaining("rerun synth-segments"),
  });
  expect(receipts.gates.find((row) => row.gate === "transcript-fidelity").violations[0]).toMatchObject({
    segment: "missing-spoken",
    metric: "MISSING_SYNTH_PROVENANCE_SERIES",
    value: 0,
    threshold: 1,
  });
  expect(receipts.gates.find((row) => row.gate === "transcript-fidelity").violations[0].evidence).toContain("sidecarPresent=false");
  expect(receipts.gates.find((row) => row.gate === "transcript-fidelity").violations[0].evidence).toContain("expectedBytes=10 actualBytes=0");
  expect(receipts.gates.find((row) => row.gate === "transcript-fidelity").violations[0].evidence).toMatch(/expectedSha256=[a-f0-9]{64}/);
  expect(receipts.gates.find((row) => row.gate === "transcript-fidelity").violations[0].evidence).toContain("actualSha256=ABSENT");
});

test("audio-dashboard BUILD tests ignore ambient pronunciation overlays", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-b13-ambient-overlay-"));
  const jobDir = path.join(root, "job");
  const changedRules = path.join(root, "ambient-pronunciation.yaml");
  writeFileSync(changedRules, "acronyms:\n  PR: \"peer review\"\n");
  writeSegment(jobDir, "ambient-overlay", [
    { word: "pull", start: 0.05, end: 0.4 },
    { word: "request", start: 0.42, end: 0.85 },
  ]);
  const previousOverlay = process.env.NARRATIONLAYER_PRONUNCIATION_FILE;
  process.env.NARRATIONLAYER_PRONUNCIATION_FILE = changedRules;

  try {
    const { result } = buildDashboard({
      id: "b13-ambient-overlay",
      title: "B13 ambient overlay isolation",
      scenes: [{ id: "ambient-overlay", title: "Ambient overlay", script: "P R" }],
    }, jobDir, "b13-ambient-overlay");
    expect(result.status).toBe(0);
  } finally {
    if (previousOverlay === undefined) delete process.env.NARRATIONLAYER_PRONUNCIATION_FILE;
    else process.env.NARRATIONLAYER_PRONUNCIATION_FILE = previousOverlay;
  }
});

test("B14 BUILD rejection writes the onset row, purges the frozen take, and withholds HTML", () => {
  const fixture = onsetEnergyReds.find((item) => item.case === "quiet-onset-real-voice-ask");
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-b14-build-"));
  const jobDir = path.join(root, "job");
  const timingWords = [
    { word: "next", start: 0.05, end: 0.20 },
    { word: "item", start: 0.22, end: 0.38 },
    { word: "one", start: 0.40, end: 0.58 },
    { word: "today", start: 0.60, end: 0.82 },
  ];
  writeSegment(jobDir, "quiet-onset", timingWords);
  copyFileSync(
    path.join(redDir, fixture.audioFile),
    path.join(jobDir, "segments", "quiet-onset", "quiet-onset.wav"),
  );

  const cacheKey = "b".repeat(64);
  const home = path.join(root, "home");
  const cacheDir = path.join(home, ".narrationlayer", "tts-cache");
  mkdirSync(cacheDir, { recursive: true });
  const cachedTakePath = path.join(cacheDir, `${cacheKey}.wav`);
  writeFileSync(cachedTakePath, "frozen quiet-onset take");
  writeFileSync(
    path.join(jobDir, "segments", "quiet-onset", "quiet-onset.wav.cache.json"),
    `${JSON.stringify({ version: 1, cacheKey }, null, 2)}\n`,
  );

  const staleOutputPath = path.join(root, "repo", "docs.local", "dashboards", "b14-quiet-onset.html");
  mkdirSync(path.dirname(staleOutputPath), { recursive: true });
  writeFileSync(staleOutputPath, "stale previously published dashboard");

  const { result, outputPath } = buildDashboard({
    id: "b14-quiet-onset",
    title: "B14 quiet onset",
    outputPath: staleOutputPath,
    scenes: [{
      id: "quiet-onset",
      role: "narrator",
      reference: "narrator-profile",
      script: "next item one today",
    }],
  }, jobDir, "b14-quiet-onset", { HOME: home });

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("ONSET_ENERGY");
  expect(result.stderr).toContain("ONSET_ENERGY_ABSOLUTE_RMS_DBFS");
  expect(result.stderr).toContain("ONSET_ENERGY_PEAK_DELTA_DB");
  expect(result.stderr).toContain("--resynth-scene quiet-onset --no-cache");
  expect(result.stderr).toContain("CACHE_PURGE segment=quiet-onset status=PURGED");
  expect(existsSync(cachedTakePath)).toBe(false);
  expect(existsSync(outputPath)).toBe(false);

  const receiptsPath = outputPath.replace(/\.html$/, ".receipts.json");
  const receipts = JSON.parse(readFileSync(receiptsPath, "utf8"));
  expect(receipts.gates.map((row) => `${row.gate}:${row.verdict}`)).toEqual([
    "voice-role:PASS",
    "transcript-fidelity:PASS",
    "acoustic:PASS",
    "onset-energy:REJECT",
  ]);
  const onsetRow = receipts.gates.at(-1);
  expect(onsetRow.stage).toBe("BUILD");
  expect(onsetRow.config).toEqual({ windowSeconds: 0.75, minRmsDbfs: -35, maxPeakDeltaDb: 26 });
  expect(onsetRow.violations.map((violation) => violation.metric)).toEqual(fixture.expectedMetrics);
  expect(onsetRow.runbook).toContain("--resynth-scene quiet-onset --no-cache");
  expect(receipts.purges).toEqual([{
    cacheKey,
    segment: "quiet-onset",
    reason: "onset-energy REJECT",
    purgedAt: expect.any(String),
  }]);
});

test("B14 BYO onset rejection instructs replacing the source instead of rerolling a cache", () => {
  const fixture = onsetEnergyReds.find((item) => item.case === "quiet-onset-real-voice-ask");
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-b14-byo-"));
  const jobDir = path.join(root, "job");
  const timingWords = [
    { word: "next", start: 0.05, end: 0.20 },
    { word: "item", start: 0.22, end: 0.38 },
    { word: "one", start: 0.40, end: 0.58 },
    { word: "today", start: 0.60, end: 0.82 },
  ];
  writeSegment(jobDir, "quiet-onset-byo", timingWords);
  copyFileSync(
    path.join(redDir, fixture.audioFile),
    path.join(jobDir, "segments", "quiet-onset-byo", "quiet-onset-byo.wav"),
  );

  const staleCacheKey = "c".repeat(64);
  const home = path.join(root, "home");
  const cacheDir = path.join(home, ".narrationlayer", "tts-cache");
  mkdirSync(cacheDir, { recursive: true });
  const unrelatedTtsTake = path.join(cacheDir, `${staleCacheKey}.wav`);
  writeFileSync(unrelatedTtsTake, "unrelated prior TTS take");
  writeFileSync(
    path.join(jobDir, "segments", "quiet-onset-byo", "quiet-onset-byo.wav.cache.json"),
    `${JSON.stringify({ version: 1, cacheKey: staleCacheKey }, null, 2)}\n`,
  );

  const { result, outputPath } = buildDashboard({
    id: "b14-quiet-onset-byo",
    title: "B14 quiet onset BYO",
    scenes: [{
      id: "quiet-onset-byo",
      role: "narrator",
      audioWav: "quiet-onset-source.wav",
      script: "next item one today",
    }],
  }, jobDir, "b14-quiet-onset-byo", { HOME: home });

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Replace or edit the scene audioWav source for quiet-onset-byo");
  expect(result.stderr).not.toContain("--resynth-scene quiet-onset-byo --no-cache");
  expect(result.stderr).not.toContain("CACHE_PURGE segment=quiet-onset-byo status=PURGED");
  expect(existsSync(unrelatedTtsTake)).toBe(true);
  expect(existsSync(outputPath)).toBe(false);

  const receipts = JSON.parse(readFileSync(outputPath.replace(/\.html$/, ".receipts.json"), "utf8"));
  const onsetRow = receipts.gates.at(-1);
  expect(onsetRow).toMatchObject({ gate: "onset-energy", stage: "BUILD", verdict: "REJECT" });
  expect(onsetRow.runbook).toContain("Replace or edit the scene audioWav source for quiet-onset-byo");
  expect(onsetRow.runbook).not.toContain("--no-cache");
  expect(receipts.purges).toEqual([]);
});

test("receipts convention rejects direct and embedded machine-local paths on every platform", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-receipts-paths-"));
  const outputPath = path.join(root, "portable.html");
  const forbiddenValues = [
    "/srv/audio/take.wav",
    "C:\\repo\\audio\\take.wav",
    "\\\\host\\share\\take.wav",
    "file:///Users/operator/take.wav",
    "input=/home/operator/take.wav",
    "input=C:\\repo\\audio\\take.wav",
    "input:/home/operator/take.wav",
    "input,/home/operator/take.wav",
    "input:C:\\repo\\audio\\take.wav",
    "input,C:\\repo\\audio\\take.wav",
  ];

  for (const evidence of forbiddenValues) {
    const receipts = createBuildReceipts({
      outputPath,
      jobId: "portable",
      spec: { scenes: [{ id: "s1", audioWav: "fixture.wav" }] },
      vendorStamp: "unstamped",
      whisperModel: "ggml-base.bin",
    });
    receipts.gates.push({
      gate: "transcript-fidelity",
      stage: "BUILD",
      verdict: "REJECT",
      config: {},
      violations: [{ segment: "s1", metric: "TAIL_TRUNCATION", value: 1, threshold: 0, evidence }],
      runbook: "rerun the segment",
      ranAt: "2026-07-16T21:00:00Z",
    });
    expect(() => writeBuildReceipts(outputPath, receipts, "candidate")).toThrow("forbidden absolute path");
  }
});

test("missing raw timing removes stale HTML and replaces its PASS sidecar with a typed transcript REJECT", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-missing-raw-receipt-"));
  const jobDir = path.join(root, "job");
  const outputPath = path.join(root, "repo", "docs.local", "dashboards", "missing-raw.html");
  const words = [
    { word: "alpha", start: 0.05, end: 0.42 },
    { word: "beta", start: 0.45, end: 0.8 },
  ];
  writeSegment(jobDir, "scene-a", words);
  const spec = {
    id: "missing-raw",
    title: "Missing raw",
    outputPath,
    scenes: [{ id: "scene-a", role: "host", audioWav: "fixture.wav", script: "alpha beta" }],
  };
  const first = buildDashboard(spec, jobDir, "missing-raw");
  expect(first.result.status).toBe(0);
  rmSync(path.join(jobDir, "segments", "scene-a", "words.raw.json"));

  const second = buildDashboard(spec, jobDir, "missing-raw");

  expect(second.result.status).not.toBe(0);
  expect(second.result.stderr).toContain("MISSING_RAW_TRANSCRIPT_SERIES");
  const receipts = JSON.parse(readFileSync(outputPath.replace(/\.html$/, ".receipts.json"), "utf8"));
  expect(receipts.gates.map((row) => `${row.gate}:${row.verdict}`)).toEqual([
    "voice-role:PASS",
    "transcript-fidelity:REJECT",
  ]);
  const transcriptRow = receipts.gates.find((row) => row.gate === "transcript-fidelity");
  expect(transcriptRow).toMatchObject({ gate: "transcript-fidelity", stage: "BUILD", verdict: "REJECT" });
  expect(transcriptRow.violations[0]).toMatchObject({ segment: "scene-a", metric: "MISSING_RAW_TRANSCRIPT_SERIES" });
  expect(receipts.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(existsSync(outputPath)).toBe(false);

  writeFileSync(path.join(jobDir, "segments", "scene-a", "words.raw.json"), "{not-json");
  const invalid = buildDashboard(spec, jobDir, "missing-raw");
  expect(invalid.result.status).not.toBe(0);
  expect(invalid.result.stderr).toContain("MISSING_RAW_TRANSCRIPT_SERIES");
  expect(existsSync(outputPath)).toBe(false);
});

test("teleprompter drift accepts timing-equivalent contraction split and merge blocks", () => {
  const result = analyzeTeleprompterDrift({
    segments: [{
      id: "split-merge",
      transcript: "I'm ready",
      sourceWords: [
        { word: "I'm", start: 0.1, end: 0.4 },
        { word: "ready", start: 0.5, end: 0.9 },
      ],
      renderedWords: [
        { word: "I", start: 0.1, end: 0.2 },
        { word: "am", start: 0.21, end: 0.4 },
        { word: "ready", start: 0.5, end: 0.9 },
      ],
    }],
  });

  expect(result.verdict).toBe("PASS");
  expect(result.violations).toEqual([]);
  expect(result.stats[0].alignedBlockCount).toBe(2);
});

test("teleprompter drift coalesces contraction units after lexical fallback", () => {
  const result = analyzeTeleprompterDrift({
    segments: [{
      id: "lexical-contraction",
      transcript: "lead I'm",
      sourceWords: [
        { word: "lead", start: 0.05, end: 0.4 },
        { word: "I'm", start: 0.5, end: 1.4 },
      ],
      renderedWords: [
        { word: "led", start: 0.05, end: 0.4 },
        { word: "I", start: 0.5, end: 0.8 },
        { word: "am", start: 0.8, end: 1.4 },
      ],
    }],
  }, { minWords: 0, maxUnalignedTokenRatio: 0.5 });

  expect(result.verdict).toBe("PASS");
  expect(result.violations).toEqual([]);
  expect(result.stats[0].alignedBlockCount).toBe(2);
});

test("teleprompter drift measures a tolerated substituted tail word", () => {
  const sourceWords = Array.from({ length: 10 }, (_, index) => ({
    word: index === 9 ? "colour" : `word${index}`,
    start: index * 0.5,
    end: index * 0.5 + 0.4,
  }));
  const renderedWords = sourceWords.map((word, index) => ({
    ...word,
    word: index === 9 ? "color" : word.word,
    ...(index === 9 ? { start: 9, end: 9.4 } : {}),
  }));
  const result = analyzeTeleprompterDrift({
    segments: [{ id: "tail-substitute", transcript: sourceWords.map((word) => word.word).join(" "), sourceWords, renderedWords }],
  }, { minWords: 0 });

  expect(result.verdict).toBe("REJECTED");
  expect(result.violations.map((violation) => violation.code)).toContain("TAIL_WORD_TIMING_DRIFT");
  expect(result.stats[0].maxTailDelta).toBeGreaterThan(4);
});

test("D6c BUILD rejects the shipped s11a raw-vs-rendered drift specimen before HTML emission", () => {
  const fixture = publishDriftReds[0];
  const segment = fixture.teleprompterDrift.segments[0];
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-d6c-drift-"));
  const jobDir = path.join(root, "job");
  writeSegment(jobDir, segment.id, segment.renderedWords, placeholderMp3, segment.sourceWords);

  const { result, outputPath } = buildDashboard({
    id: "d6c-s11a-drift",
    title: fixture.specimen,
    scenes: [{ id: segment.id, role: "examplechannel", audioWav: "s11a.wav", script: segment.transcript }],
  }, jobDir, "d6c-s11a-drift");

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("TELEPROMPTER_DRIFT");
  expect(result.stderr).toContain("segment=s11a");
  expect(result.stderr).toContain("metric=TAIL_WORD_TIMING_DRIFT");
  expect(result.stderr).toContain(`value=${fixture.expectedAlignedTailDeltaSeconds}`);
  expect(result.stderr).toContain("threshold=0.35");
  expect(result.stderr).toContain("evidence=");
  expect(result.stderr).toContain("runbook=");
  expect(existsSync(outputPath)).toBe(false);
  const receipts = JSON.parse(readFileSync(outputPath.replace(/\.html$/, ".receipts.json"), "utf8"));
  expect(receipts.gates.at(-1)).toMatchObject({ gate: "teleprompter-drift", stage: "BUILD", verdict: "REJECT" });
  expect(receipts.gates.at(-1).violations[0]).toMatchObject({
    segment: "s11a",
    metric: "TAIL_WORD_TIMING_DRIFT",
    value: fixture.expectedAlignedTailDeltaSeconds,
    threshold: 0.35,
  });
  expect(receipts.gates.at(-1).violations[0].evidence).toContain(
    `tailMaxDelta=${fixture.expectedAlignedTailDeltaSeconds.toFixed(3)}s`,
  );
});

for (const fixture of transcriptReds) {
  test(`D6b BUILD rejects repaired words that mask ${fixture.violation}`, () => {
    const root = mkdtempSync(path.join(tmpdir(), `audio-dashboard-d6b-${fixture.violation.toLowerCase()}-`));
    const jobDir = path.join(root, "job");
    const segment = fixture.transcriptFidelity.segments[0];
    const repairedWords = segment.script.split(/\s+/).map((word, index, all) => ({
      word,
      start: Number((0.02 + index * (0.82 / all.length)).toFixed(3)),
      end: Number((0.02 + (index + 0.7) * (0.82 / all.length)).toFixed(3)),
    }));
    writeSegment(jobDir, segment.id, repairedWords, placeholderMp3, segment.rawWords);
    const cacheFixture = reds.find((item) => item.file === "11-poisoned-take-cache.json");
    const home = path.join(root, "home");
    const cacheDir = path.join(home, ".narrationlayer", "tts-cache");
    mkdirSync(cacheDir, { recursive: true });
    const poisonedPath = path.join(cacheDir, `${cacheFixture.cacheKey}.wav`);
    writeFileSync(poisonedPath, Buffer.from(cacheFixture.portableExtraction.base64, "base64"));
    writeFileSync(
      path.join(jobDir, "segments", segment.id, `${segment.id}.wav.cache.json`),
      `${JSON.stringify({ version: 1, cacheKey: cacheFixture.cacheKey }, null, 2)}\n`,
    );

    const { result, outputPath } = buildDashboard({
      id: `d6b-${segment.id}`,
      title: fixture.specimen,
      scenes: [{ id: segment.id, title: segment.id, script: segment.script }],
    }, jobDir, `d6b-${segment.id}`, { HOME: home });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("TRANSCRIPT_FIDELITY");
    expect(result.stderr).toContain(`segment=${segment.id}`);
    expect(result.stderr).toContain(`metric=${fixture.violation}`);
    expect(result.stderr).toContain("value=");
    expect(result.stderr).toContain("threshold=");
    expect(result.stderr).toContain("evidence=");
    expect(result.stderr).toContain("runbook=");
    expect(result.stderr).toContain(`CACHE_PURGE segment=${segment.id} status=PURGED`);
    expect(existsSync(poisonedPath)).toBe(false);
    expect(existsSync(outputPath)).toBe(false);
    const receipts = JSON.parse(readFileSync(outputPath.replace(/\.html$/, ".receipts.json"), "utf8"));
    expect(receipts.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(receipts.artifactSha256).not.toBe(createHash("sha256").update("").digest("hex"));
    expect(receipts.gates.at(-1)).toMatchObject({ gate: "transcript-fidelity", stage: "BUILD", verdict: "REJECT" });
    expect(receipts.purges).toHaveLength(1);
    expect(receipts.purges[0]).toMatchObject({
      cacheKey: cacheFixture.cacheKey,
      segment: segment.id,
      reason: "transcript-fidelity REJECT",
    });
    expect(Object.keys(receipts.purges[0]).sort()).toEqual(["cacheKey", "purgedAt", "reason", "segment"]);
  });
}

test("BYO transcript-fidelity rejection preserves a stale TTS take and requires source replacement", () => {
  const fixture = transcriptReds.find((item) => item.source.segment === "s9q");
  const segment = fixture.transcriptFidelity.segments[0];
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-transcript-byo-"));
  const jobDir = path.join(root, "job");
  const repairedWords = segment.script.split(/\s+/).map((word, index, all) => ({
    word,
    start: Number((0.02 + index * (0.82 / all.length)).toFixed(3)),
    end: Number((0.02 + (index + 0.7) * (0.82 / all.length)).toFixed(3)),
  }));
  writeSegment(jobDir, segment.id, repairedWords, placeholderMp3, segment.rawWords);

  const staleCacheKey = "e".repeat(64);
  const home = path.join(root, "home");
  const cacheDir = path.join(home, ".narrationlayer", "tts-cache");
  mkdirSync(cacheDir, { recursive: true });
  const unrelatedTtsTake = path.join(cacheDir, `${staleCacheKey}.wav`);
  writeFileSync(unrelatedTtsTake, "unrelated prior TTS take");
  writeFileSync(
    path.join(jobDir, "segments", segment.id, `${segment.id}.wav.cache.json`),
    `${JSON.stringify({ version: 1, cacheKey: staleCacheKey }, null, 2)}\n`,
  );

  const { result, outputPath } = buildDashboard({
    id: "transcript-byo",
    title: "Transcript BYO",
    scenes: [{ id: segment.id, title: segment.id, audioWav: "operator-source.wav", script: segment.script }],
  }, jobDir, "transcript-byo", { HOME: home });

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("TRANSCRIPT_FIDELITY");
  expect(result.stderr).toContain("PHONEME_CRITICAL_SUBSTITUTION");
  expect(result.stderr).toContain(`Replace or edit the scene audioWav source for ${segment.id}`);
  expect(result.stderr).not.toContain(`--resynth-scene ${segment.id} --no-cache`);
  expect(result.stderr).toContain(`CACHE_PURGE segment=${segment.id} status=SKIP`);
  expect(result.stderr).not.toContain(`CACHE_PURGE segment=${segment.id} status=PURGED`);
  expect(existsSync(unrelatedTtsTake)).toBe(true);

  const receipts = JSON.parse(readFileSync(outputPath.replace(/\.html$/, ".receipts.json"), "utf8"));
  const transcriptRow = receipts.gates.at(-1);
  expect(transcriptRow).toMatchObject({ gate: "transcript-fidelity", stage: "BUILD", verdict: "REJECT" });
  expect(transcriptRow.runbook).toContain(`Replace or edit the scene audioWav source for ${segment.id}`);
  expect(transcriptRow.runbook).not.toContain("--no-cache");
  expect(receipts.purges).toEqual([]);
});

test("D6b BUILD receipt gives script-less BYO its distinct metric and runbook", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-d6b-scriptless-byo-"));
  const jobDir = path.join(root, "job");
  const words = [{ index: 0, word: "recorded", start: 0.05, end: 0.42, confidence: 0.99 }];
  writeSegment(jobDir, "scriptless-byo", words, placeholderMp3, words);

  const { result, outputPath } = buildDashboard({
    id: "d6b-scriptless-byo",
    title: "Script-less BYO",
    scenes: [{ id: "scriptless-byo", title: "Script-less BYO", audioWav: "scriptless-byo.wav" }],
  }, jobDir, "d6b-scriptless-byo");

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("metric=SCRIPTLESS_SCENE_UNSUPPORTED");
  expect(result.stderr).toContain("add `script` to the scene");
  const receipts = JSON.parse(readFileSync(outputPath.replace(/\.html$/, ".receipts.json"), "utf8"));
  expect(receipts.gates.at(-1)).toMatchObject({
    gate: "transcript-fidelity",
    stage: "BUILD",
    verdict: "REJECT",
  });
  expect(receipts.gates.at(-1).violations[0].metric).toBe("SCRIPTLESS_SCENE_UNSUPPORTED");
  expect(receipts.gates.at(-1).runbook).toContain("add `script` to the scene");
  expect(receipts.gates.at(-1).runbook).toContain("NOT_APPLICABLE verdict class is filed as a spec question");
});

for (const fx of evidenceGreens) {
  test(`GREEN ${fx.file} (${fx.specimen}) -> PASS`, () => {
    const result = validateAudioDashboardEvidence(fx.evidence);
    expect(result.verdict).toBe("PASS");
    expect(result.violations.length).toBe(0);
    expect(result.wordClickSeek).toBe(true);
    expect(result.realTranscript).toBe(true);
    expect(result.realWordTiming).toBe(true);
  });
}

for (const fx of evidenceReds) {
  test(`RED ${fx.file} (${fx.specimen}) -> REJECTED ${fx.violation}`, () => {
    const result = validateAudioDashboardEvidence(fx.evidence);
    expect(result.verdict).toBe("REJECTED");
    expect(result.violations.map((v) => v.code)).toContain(fx.violation);
  });
}

test("GREEN teleprompter drift fixture from the banked in-sync dashboard passes tail alignment", () => {
  expect(driftGreens.map((fx) => fx.file)).toEqual(["03-teleprompter-drift-insync.json"]);
  const result = analyzeTeleprompterDrift(driftGreens[0].teleprompterDrift);

  expect(result.verdict).toBe("PASS");
  expect(result.violations).toEqual([]);
  expect(result.stats[0].tailWordCount).toBeGreaterThan(50);
  expect(result.stats[0].transcriptChars).toBeGreaterThan(1500);
  expect(result.stats[0].maxTailStartDelta).toBeLessThanOrEqual(0.001);
});

test("RED teleprompter drift fixture fires on tail-only accumulated drift", () => {
  expect(driftReds.map((fx) => fx.file)).toContain("04-teleprompter-tail-drift.json");
  const fixture = driftReds.find((fx) => fx.file === "04-teleprompter-tail-drift.json");
  const result = analyzeTeleprompterDrift(fixture.teleprompterDrift);
  const report = formatTeleprompterDriftReport(result);

  expect(result.verdict).toBe("REJECTED");
  expect(result.violations.map((v) => v.code)).toContain("TAIL_WORD_TIMING_DRIFT");
  expect(result.stats[0].maxHeadStartDelta).toBeLessThanOrEqual(0.001);
  expect(result.stats[0].maxTailStartDelta).toBeGreaterThan(result.thresholds.maxWordDeltaSeconds);
  expect(report).toContain("Align rendered teleprompter words to words.raw.json through the tail");
  expect(report).toContain("rerun the drift gate");
});

test("teleprompter drift gate runs under the stop-class latency budget", () => {
  const start = performance.now();
  const result = analyzeTeleprompterDrift(driftGreens[0].teleprompterDrift);
  const elapsedMs = performance.now() - start;

  expect(result.verdict).toBe("PASS");
  expect(elapsedMs).toBeLessThan(5000);
});

test("a dashboard with WPM timing cannot be rescued by real transcript text", () => {
  const evidence = {
    generator: "agent-html/host/build-aftercode-tonight.mjs",
    outputPath: "/opt/private/skill-tools/docs.local/dashboards/example.html",
    tailnetSync: true,
    wordsJson: [
      { word: "real", start: 0.12, end: 0.28 },
      { word: "timing", start: 0.32, end: 0.72 }
    ],
    html: `
      <script id="tpdata" type="application/json">
        [{"realWordTiming":false,"timingSource":"wpm-estimated","script":"real timing","words":[{"word":"real","start":0,"end":0.5},{"word":"timing","start":0.5,"end":1}]}]
      </script>
      <section class="transcript">real timing</section>
      <script>word.addEventListener('click', () => { audio.currentTime = Number(word.dataset.ws); });</script>
    `
  };

  const result = validateAudioDashboardEvidence(evidence);
  expect(result.verdict).toBe("REJECTED");
  expect(result.violations.map((v) => v.code)).toContain("ESTIMATED_OR_WPM_TIMING");
});
