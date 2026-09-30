import { test, expect, spawnSync, createHash, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, tmpdir, fileURLToPath, path, performance, validateAudioDashboardEvidence, analyzeAcousticArtifacts, analyzeOnsetEnergy, formatOnsetEnergyReport, ONSET_ENERGY_DEFAULTS, analyzeTeleprompterDrift, formatTeleprompterDriftReport, analyzeTranscriptFidelity, formatTranscriptFidelityReport, TRANSCRIPT_FIDELITY_DEFAULTS, createBuildReceipts, readNarrationVendorStamp, writeBuildReceipts, clearTakeCacheReceiptForByo, writeWordTimingArtifacts, formatCachePurgeReceipt, purgeRejectedTakeCaches, answersMarkdown, injectDecisionSurfaceIntoHtml, buildAfterCodeDashboardPlan, renderV4, clearTakeCacheReceipt, writeTakeCacheReceipt, loadPronunciationRules, normalizeForSpeech, here, redDir, greenDir, transcriptCalibrationPath, onsetEnergyCalibrationPath, skillPath, skillRoot, placeholderMp3, placeholderMp3Duration, loadFixtures, reds, greens, evidenceReds, evidenceGreens, driftReds, driftGreens, acousticReds, onsetEnergyReds, transcriptReds, publishDriftReds, tpdataFromHtml, writeFixtureFfprobe, writeSegment, writeToneWav, writeStereoToneWav, wordsForDuration, writeAcousticSegment, acousticFixtureSegments, buildDashboard } from "./common.mjs";


test("fixture coverage: canonical PASS plus the four named regression families", () => {
  expect(greens.map((fx) => fx.file)).toEqual([
    "01-canonical-readalong.json",
    "02-transcript-mentions-estimated.json",
    "03-teleprompter-drift-insync.json"
  ]);
  expect(reds.map((fx) => fx.file)).toEqual([
    "01-wpm-estimated-timing.json",
    "02-placeholder-recap.json",
    "03-golemplaylist-v1.json",
    "04-teleprompter-tail-drift.json",
    "05-acoustic-repeated-token-loop.json",
    "06-acoustic-multi-incident-poisoned-median.json",
    "07-acoustic-high-f0-poisoned-median.json",
    "08-transcript-overtime-substitution.json",
    "09-transcript-webseacut-substitution.json",
    "10-teleprompter-s11a-raw-rendered-drift.json",
    "11-poisoned-take-cache.json",
    "12-acoustic-quiet-onset.json",
    "12-narration-vendor-pre-sync.json"
  ]);
});

test("B14 RED real quiet-onset audio rejects with typed absolute and relative energy metrics", () => {
  const fixture = onsetEnergyReds.find((item) => item.case === "quiet-onset-real-voice-ask");
  expect(fixture).toBeDefined();
  const wavPath = path.join(redDir, fixture.audioFile);
  const wavBytes = readFileSync(wavPath);
  const audioSha256 = createHash("sha256").update(wavBytes).digest("hex");

  expect(fixture.source.provenanceClass).toBe("REAL_DOMAIN_MATCHED_AUDIO");
  expect(fixture.source.surface).toBe("L1 voice_ask playback");
  expect(fixture.source.domainTransfer).toContain("target gate runs on narration BUILD segments");
  expect(fixture.source.parentSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(audioSha256).toBe(fixture.audioSha256);
  expect(fixture.independentMeasurement.historicalPeakReproducedOnRawSource).toBe(true);
  expect(fixture.independentMeasurement.historicalRawSourcePeak).toEqual({
    windowStartSeconds: 1206,
    windowDurationSeconds: 1,
    peakDbfs: -8.131347,
    secondsBeforeFixtureStart: 15,
  });
  expect(fixture.independentMeasurement.adjacentRawSourceOneSecondPeaksDbfs).toEqual({
    1205: -20.900524,
    1206: -8.131347,
    1207: -45.751,
  });
  expect(fixture.independentMeasurement.disclosure).toContain("QA window misalignment, not loudness normalization");

  const result = analyzeOnsetEnergy([{
    id: "quiet-onset",
    role: "narrator",
    wavPath,
    wavBytes,
    wordCount: 5,
  }]);
  const report = formatOnsetEnergyReport(result);

  expect(result.verdict).toBe("REJECTED");
  expect(result.violations.map((violation) => violation.metric)).toEqual(fixture.expectedMetrics);
  expect(result.stats[0].onsetWindowSeconds).toBe(0.75);
  expect(result.stats[0].onsetRmsDbfs).toBeCloseTo(fixture.independentMeasurement.onsetRmsDbfs, 3);
  expect(result.stats[0].segmentPeakDbfs).toBeCloseTo(fixture.independentMeasurement.segmentPeakDbfs, 3);
  expect(result.stats[0].onsetPeakDeltaDb).toBeCloseTo(fixture.independentMeasurement.onsetPeakDeltaDb, 3);
  for (const violation of result.violations) {
    expect(violation).toMatchObject({ segment: "quiet-onset", role: "narrator" });
    expect(violation.value).toBeNumber();
    expect(violation.threshold).toBeNumber();
    expect(violation.evidence).toContain("onsetRmsDbfs=");
  }
  expect(report).toContain("ONSET_ENERGY");
  expect(report).toContain("--resynth-scene quiet-onset --no-cache");
  expect(report).toContain("then rebuild");
});

test("B14 multichannel onset energy uses a non-cancelling full-level downmix", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-b14-stereo-"));
  const cases = [
    { id: "right-channel-speech", leftAmplitude: 0, rightAmplitude: 0.55 },
    { id: "opposite-polarity-speech", leftAmplitude: 0.55, rightAmplitude: -0.55 },
  ];

  for (const fixture of cases) {
    const wavPath = path.join(root, `${fixture.id}.wav`);
    writeStereoToneWav(wavPath, { seconds: 1, ...fixture });
    const result = analyzeOnsetEnergy([{
      id: fixture.id,
      role: "host",
      wavPath,
      wavBytes: readFileSync(wavPath),
    }]);

    expect(result.verdict).toBe("PASS");
    expect(result.stats[0].onsetRmsDbfs).toBeCloseTo(-8.2, 1);
    expect(result.stats[0].onsetPeakDeltaDb).toBeLessThan(ONSET_ENERGY_DEFAULTS.maxPeakDeltaDb);
  }
});

test("B14 calibration summary reports every non-PASS corpus scene as an unexpected reject", async () => {
  const { summarizeOnsetCalibrationRows } = await import("../generate-onset-energy-calibration.mjs");
  const summary = summarizeOnsetCalibrationRows([
    { id: "clean-a", verdict: "PASS" },
    { id: "quiet-b", verdict: "REJECTED" },
  ]);

  expect(summary).toEqual({
    sceneCount: 2,
    pass: 1,
    rejected: 1,
    unexpectedRejects: ["quiet-b"],
  });
});

test("B14 33-scene narration calibration receipt has zero onset-energy false trips", () => {
  const receipt = JSON.parse(readFileSync(onsetEnergyCalibrationPath, "utf8"));
  const expectedSceneIds = [
    "s1q", "s1a", "s2q", "s2a", "s3q", "s3a", "s4q", "s4a", "s5q", "s5a", "s6q",
    "s6a", "s7q", "s7a", "s8q", "s8a", "s9q", "s9a", "s10q", "s10a", "s11q", "s11a",
    "s11b", "s12q", "s12a", "s12m", "s12b", "s13q", "s13a", "s13b", "s14q", "s14a", "s14b",
  ];

  expect(receipt.version).toBe(1);
  expect(receipt.kind).toBe("ONSET_ENERGY_CALIBRATION");
  expect(receipt.source).toMatchObject({
    provenanceClass: "REAL_NARRATION_CORPUS",
    jobId: "fable-blind-weave-2026-07-15",
    analyzer: "analyzeOnsetEnergy",
  });
  expect(receipt.source.wavCorpusSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(receipt.gateConfig).toEqual(ONSET_ENERGY_DEFAULTS);
  expect(receipt.summary).toEqual({
    sceneCount: 33,
    pass: 33,
    rejected: 0,
    unexpectedRejects: [],
  });
  expect(receipt.scenes.map((scene) => scene.id)).toEqual(expectedSceneIds);
  expect(new Set(receipt.scenes.map((scene) => scene.id)).size).toBe(expectedSceneIds.length);

  for (const scene of receipt.scenes) {
    expect(Object.keys(scene).sort()).toEqual([
      "classification",
      "id",
      "onsetPeakDeltaDb",
      "onsetRmsDbfs",
      "onsetWindowSeconds",
      "segmentPeakDbfs",
      "verdict",
      "violations",
      "wavBasename",
      "wavSha256",
    ]);
    expect(scene.classification).toBe("CLEAN");
    expect(scene.wavBasename).toBe(`${scene.id}.wav`);
    expect(scene.wavSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(scene.onsetWindowSeconds).toBe(0.75);
    expect(scene.onsetRmsDbfs).toBeGreaterThanOrEqual(ONSET_ENERGY_DEFAULTS.minRmsDbfs);
    expect(scene.onsetPeakDeltaDb).toBeLessThanOrEqual(ONSET_ENERGY_DEFAULTS.maxPeakDeltaDb);
    expect(scene.segmentPeakDbfs).toBeNumber();
    expect(scene.verdict).toBe("PASS");
    expect(scene.violations).toEqual([]);
  }

  const recomputedCorpusSha256 = createHash("sha256")
    .update(JSON.stringify(receipt.scenes.map((scene) => [scene.id, scene.wavSha256])))
    .digest("hex");
  expect(receipt.source.wavCorpusSha256).toBe(recomputedCorpusSha256);
  expect(Math.min(...receipt.scenes.map((scene) => scene.onsetRmsDbfs))).toBeCloseTo(-26.031, 2);
  expect(Math.max(...receipt.scenes.map((scene) => scene.onsetPeakDeltaDb))).toBeCloseTo(22.794, 2);
  expect(JSON.stringify(receipt)).not.toMatch(/\/(?:Users|home|private|tmp)\//);
  expect(JSON.stringify(receipt)).not.toMatch(/[A-Za-z]:[\\/]/);
});

for (const fixture of transcriptReds) {
  test(`D6b RED ${fixture.file} (${fixture.specimen}) -> REJECTED ${fixture.violation}`, () => {
    const segment = fixture.transcriptFidelity.segments[0];
    const rawWordsSha256 = createHash("sha256").update(JSON.stringify(segment.rawWords)).digest("hex");
    const result = analyzeTranscriptFidelity(fixture.transcriptFidelity);
    const report = formatTranscriptFidelityReport(result);

    expect(fixture.provenanceClass).toBe("PROVEN_VERBATIM");
    expect(fixture.source.kind).toBe("real-deterministic-decode");
    expect(fixture.source.repeatedDecodeCount).toBe(3);
    expect(rawWordsSha256).toBe(fixture.source.rawWordsSha256);
    expect(result.verdict).toBe("REJECTED");
    expect(result.violations.map((violation) => violation.metric)).toContain(fixture.violation);
    expect(report).toContain(`segment=${fixture.transcriptFidelity.segments[0].id}`);
    expect(report).toContain(`metric=${fixture.violation}`);
    expect(report).toContain("value=");
    expect(report).toContain("threshold=");
    expect(report).toContain("evidence=");
    expect(report).toContain("runbook=");
  });
}

test("D6d poisoned frozen take is purged without deleting its clean sibling", () => {
  const fixture = reds.find((item) => item.file === "11-poisoned-take-cache.json");
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-d6d-cache-"));
  const cacheDir = path.join(root, "tts-cache");
  mkdirSync(cacheDir, { recursive: true });
  const poisonedPath = path.join(cacheDir, `${fixture.cacheKey}.wav`);
  const cleanPath = path.join(cacheDir, `${fixture.cleanSiblingKey}.wav`);
  const incidentExtraction = Buffer.from(fixture.portableExtraction.base64, "base64");
  expect(incidentExtraction).toHaveLength(fixture.portableExtraction.bytes);
  expect(createHash("sha256").update(incidentExtraction).digest("hex")).toBe(fixture.portableExtraction.sha256);
  writeFileSync(poisonedPath, incidentExtraction);
  writeFileSync(cleanPath, "accepted-clean-take");
  const cacheReceiptPath = path.join(root, `${fixture.segment}.wav.cache.json`);
  writeFileSync(cacheReceiptPath, `${JSON.stringify({ version: 1, cacheKey: fixture.cacheKey }, null, 2)}\n`);

  const receipts = purgeRejectedTakeCaches({
    artifacts: [{ id: fixture.segment, cacheReceiptPath }],
    rejectedSegments: [fixture.segment],
    cacheDir,
  });

  expect(existsSync(poisonedPath)).toBe(false);
  expect(existsSync(cleanPath)).toBe(true);
  expect(receipts).toHaveLength(1);
  expect(receipts[0]).toMatchObject({ segment: fixture.segment, status: "PURGED", cacheKey: fixture.cacheKey });
  expect(formatCachePurgeReceipt(receipts[0])).toContain(
    `CACHE_PURGE segment=${fixture.segment} status=PURGED key=${fixture.cacheKey}`,
  );
});

test("D6d duplicate rejection records preserve BYO cache protection regardless of order", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-d6d-byo-dedupe-"));
  const cacheDir = path.join(root, "tts-cache");
  mkdirSync(cacheDir, { recursive: true });
  const staleCacheKey = "f".repeat(64);
  const unrelatedTtsTake = path.join(cacheDir, `${staleCacheKey}.wav`);
  writeFileSync(unrelatedTtsTake, "unrelated prior TTS take");
  const cacheReceiptPath = path.join(root, "scene.wav.cache.json");
  writeFileSync(cacheReceiptPath, `${JSON.stringify({ version: 1, cacheKey: staleCacheKey }, null, 2)}\n`);

  const receipts = purgeRejectedTakeCaches({
    artifacts: [{ id: "scene", cacheReceiptPath }],
    rejectedSegments: [{ segment: "scene", sourceKind: "BYO" }, "scene"],
    cacheDir,
  });

  expect(existsSync(unrelatedTtsTake)).toBe(true);
  expect(receipts).toEqual([{
    segment: "scene",
    status: "SKIP",
    evidence: "BYO source is not managed by the TTS frozen-take cache",
  }]);
});

test("D6d vendored TTS runner writes the cache key receipt even for no-cache rerolls", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-d6d-runner-receipt-"));
  const output = path.join(root, "scene.wav");
  const cacheKey = "7ec0c72a437210707fd0334f763b251b4360b0a49fb7eef582bb8b00dbb844dc";

  const receiptPath = await writeTakeCacheReceipt(output, cacheKey, { cacheEnabled: false });

  expect(receiptPath).toBe(`${output}.cache.json`);
  expect(JSON.parse(readFileSync(receiptPath, "utf8"))).toEqual({
    version: 1,
    cacheKey,
    cacheEnabled: false,
  });
});

test("D6d failed TTS attempt clears a stale cache binding without deleting the stale WAV", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-d6d-failed-reroll-"));
  const output = path.join(root, "scene.wav");
  const staleKey = "a".repeat(64);
  writeFileSync(output, "stale wav remains until a successful replacement");
  await writeTakeCacheReceipt(output, staleKey, { cacheEnabled: true });

  await clearTakeCacheReceipt(output);

  expect(existsSync(output)).toBe(true);
  expect(existsSync(`${output}.cache.json`)).toBe(false);
});

test("D6b matched raw transcript passes without repair masking", () => {
  const result = analyzeTranscriptFidelity({
    segments: [
      {
        id: "matched",
        script: "raw transcript matches the script",
        rawWords: ["raw", "transcript", "matches", "the", "script"].map((word, index) => ({
          word,
          start: index * 0.2,
          end: index * 0.2 + 0.15,
        })),
      },
    ],
  });

  expect(result.verdict).toBe("PASS");
  expect(result.violations).toEqual([]);
});

test("D6b adjacent material substitutions cannot erase each other's rejection", () => {
  const result = analyzeTranscriptFidelity({
    segments: [{
      id: "adjacent-material-errors",
      script: "before overnight websocket after",
      rawWords: ["before", "Overtime,", "WebSeaCut", "after"].map((word, index) => ({
        index,
        word,
        start: index * 0.5,
        end: index * 0.5 + 0.4,
      })),
    }],
  });

  expect(result.verdict).toBe("REJECTED");
  expect(result.violations.map((violation) => violation.metric)).toEqual(["PHONEME_CRITICAL_SUBSTITUTION"]);
  expect(result.violations[0].evidence).toContain('raw="Overtime,"');
  expect(result.violations[0].evidence).toContain('raw="WebSeaCut"');
});

test("D6b calibration summary treats an absent expected incident as missed", async () => {
  const { summarizeCalibrationRows } = await import("../generate-transcript-fidelity-calibration.mjs");
  const summary = summarizeCalibrationRows(
    [
      { id: "clean", classification: "CLEAN", verdict: "PASS" },
      { id: "s9q", classification: "INCIDENT", verdict: "REJECTED" },
    ],
    ["s9q", "s13a"],
  );

  expect(summary).toEqual({
    sceneCount: 2,
    cleanExpected: 1,
    pass: 1,
    rejected: 1,
    unexpectedRejects: [],
    missedIncidents: ["s13a"],
  });
});

test("D6b 33-scene real-decode calibration receipt passes 31 clean scenes and rejects only the incidents", () => {
  const receipt = JSON.parse(readFileSync(transcriptCalibrationPath, "utf8"));
  const expectedSceneIds = [
    "s1q", "s1a", "s2q", "s2a", "s3q", "s3a", "s4q", "s4a", "s5q", "s5a", "s6q",
    "s6a", "s7q", "s7a", "s8q", "s8a", "s9q", "s9a", "s10q", "s10a", "s11q", "s11a",
    "s11b", "s12q", "s12a", "s12m", "s12b", "s13q", "s13a", "s13b", "s14q", "s14a", "s14b",
  ];
  const incidentFixtures = new Map(
    transcriptReds.map((fixture) => [fixture.source.segment, fixture.source.rawWordsSha256]),
  );
  const incidentEvidence = new Map([
    ["s9q", 'raw="Overtime," expected="overnight" editDistance=4 editRatio=0.444 lengthRatio=0.889 exactAnchors=2'],
    ["s13a", 'raw="WebSeaCut" expected="websocket" editDistance=4 editRatio=0.444 lengthRatio=1.000 exactAnchors=2'],
  ]);

  expect(receipt.kind).toBe("TRANSCRIPT_FIDELITY_CALIBRATION");
  expect(receipt.source.provenanceClass).toBe("REAL_DETERMINISTIC_DECODE");
  expect(receipt.source.jobId).toBe("fable-blind-weave-2026-07-15");
  expect(receipt.source.decoder).toBe("runWhisperCliWordTimings");
  expect(receipt.source.incidentRepeatCount).toBe(3);
  expect(receipt.source.whisperModel).toBe("ggml-large-v3-turbo.bin");
  expect(receipt.source.rawCorpusSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(receipt.gateConfig).toEqual(TRANSCRIPT_FIDELITY_DEFAULTS);
  expect(receipt.expectedIncidents).toEqual(["s9q", "s13a"]);
  expect(receipt.summary).toEqual({
    sceneCount: 33,
    cleanExpected: 31,
    pass: 31,
    rejected: 2,
    unexpectedRejects: [],
    missedIncidents: [],
  });
  expect(receipt.scenes.map((scene) => scene.id)).toEqual(expectedSceneIds);
  expect(new Set(receipt.scenes.map((scene) => scene.id)).size).toBe(expectedSceneIds.length);
  for (const scene of receipt.scenes) {
    expect(Object.keys(scene).sort()).toEqual([
      "classification", "id", "rawWordCount", "rawWordsSha256", "scriptWordCount", "verdict", "violations", "wavBasename",
    ]);
    expect(scene.wavBasename).toBe(`${scene.id}.wav`);
    expect(scene.scriptWordCount).toBeInteger();
    expect(scene.scriptWordCount).toBeGreaterThan(0);
    expect(scene.rawWordCount).toBeInteger();
    expect(scene.rawWordCount).toBeGreaterThan(0);
    expect(scene.rawWordsSha256).toMatch(/^[a-f0-9]{64}$/);
    const isIncident = incidentEvidence.has(scene.id);
    expect(scene.classification).toBe(isIncident ? "INCIDENT" : "CLEAN");
    if (!isIncident) {
      expect(scene.verdict).toBe("PASS");
      expect(scene.violations).toEqual([]);
    } else {
      expect(scene.verdict).toBe("REJECTED");
      expect(scene.violations).toEqual([
        {
          segment: scene.id,
          metric: "PHONEME_CRITICAL_SUBSTITUTION",
          value: 4,
          threshold: 4,
          evidence: incidentEvidence.get(scene.id),
        },
      ]);
    }
  }
  const recomputedCorpusSha256 = createHash("sha256")
    .update(JSON.stringify(receipt.scenes.map((scene) => [scene.id, scene.rawWordsSha256])))
    .digest("hex");
  expect(receipt.source.rawCorpusSha256).toBe(recomputedCorpusSha256);
  expect(receipt.scenes.filter((scene) => scene.verdict === "REJECTED").map((scene) => scene.id)).toEqual(["s9q", "s13a"]);
  for (const [segment, rawWordsSha256] of incidentFixtures) {
    const row = receipt.scenes.find((scene) => scene.id === segment);
    expect(row.rawWordsSha256).toBe(rawWordsSha256);
    expect(row.violations.map((violation) => violation.metric)).toEqual(["PHONEME_CRITICAL_SUBSTITUTION"]);
  }
  expect(JSON.stringify(receipt)).not.toMatch(/\/(?:Users|home|private|tmp)\//);
  expect(JSON.stringify(receipt)).not.toMatch(/[A-Za-z]:[\\/]/);
});

test("D6b script-less BYO scene rejects with its own metric and actionable runbook", () => {
  const result = analyzeTranscriptFidelity({
    segments: [
      {
        id: "scriptless-byo",
        rawWords: [{ index: 0, word: "recorded", start: 0.1, end: 0.4, confidence: 0.99 }],
      },
    ],
  });
  const report = formatTranscriptFidelityReport(result);

  expect(result.verdict).toBe("REJECTED");
  expect(result.violations.map((violation) => violation.metric)).toEqual(["SCRIPTLESS_SCENE_UNSUPPORTED"]);
  expect(report).toContain("add `script` to the scene");
  expect(report).toContain("NOT_APPLICABLE verdict class is filed as a spec question");
  expect(report).not.toContain("--resynth-scene scriptless-byo");
});

test("D6a persists raw Whisper words separately from repaired display words", () => {
  const segmentDir = mkdtempSync(path.join(tmpdir(), "audio-dashboard-d6a-raw-"));
  const rawWords = [{ index: 0, word: "overn", start: 0.1, end: 0.5, confidence: 0.72 }];
  const repairedWords = [{ index: 0, word: "overnight", start: 0.1, end: 0.5, confidence: 0.72 }];

  const paths = writeWordTimingArtifacts(segmentDir, { rawWords, repairedWords });

  expect(JSON.parse(readFileSync(paths.rawWordsPath, "utf8"))).toEqual(rawWords);
  expect(JSON.parse(readFileSync(paths.wordsPath, "utf8"))).toEqual(repairedWords);
  expect(paths.rawWordsPath).toBe(path.join(segmentDir, "words.raw.json"));
  expect(paths.wordsPath).toBe(path.join(segmentDir, "words.json"));
});

test("D6d BYO audio clears a stale TTS cache receipt before BUILD can purge the wrong take", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-d6d-byo-stale-receipt-"));
  const wavPath = path.join(root, "scene.wav");
  const receiptPath = `${wavPath}.cache.json`;
  writeFileSync(wavPath, "byo-audio");
  writeFileSync(receiptPath, `${JSON.stringify({ version: 1, cacheKey: "a".repeat(64) })}\n`);

  clearTakeCacheReceiptForByo(wavPath);

  expect(existsSync(receiptPath)).toBe(false);
});

test("receipts report an invalid narration vendor manifest as unstamped", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-invalid-vendor-stamp-"));
  const vendorDir = path.join(root, "vendor", "narrationlayer");
  mkdirSync(vendorDir, { recursive: true });
  writeFileSync(
    path.join(vendorDir, "VENDOR-VERSION"),
    `${JSON.stringify({
      schemaVersion: 1,
      vendor: "narrationlayer",
      upstream: { repository: "EtanHey/narrationlayer", commit: "a".repeat(40) },
      pairs: [],
    })}\n`,
  );
  try {
    expect(readNarrationVendorStamp(root)).toBe("unstamped");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("receipts convention: PASS build emits portable schema-v1 rows for all four BUILD gates", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-receipts-pass-"));
  const jobDir = path.join(root, "job");
  const words = [
    { word: "alpha", start: 0.05, end: 0.42 },
    { word: "beta", start: 0.45, end: 0.80 },
  ];
  writeSegment(jobDir, "scene-a", words);

  const { result, outputPath } = buildDashboard({
    id: "receipts-pass",
    title: "Receipts PASS",
    scenes: [{ id: "scene-a", role: "host", audioWav: "fixture.wav", script: "alpha beta" }],
  }, jobDir, "receipts-pass");

  expect(result.status).toBe(0);
  const receiptsPath = outputPath.replace(/\.html$/, ".receipts.json");
  expect(existsSync(receiptsPath)).toBe(true);
  const html = readFileSync(outputPath, "utf8");
  const receipts = JSON.parse(readFileSync(receiptsPath, "utf8"));
  expect(receipts.version).toBe(1);
  expect(receipts.artifact).toBe(path.basename(outputPath));
  expect(receipts.artifactSha256).toBe(createHash("sha256").update(html).digest("hex"));
  expect(receipts.jobId).toBe("receipts-pass");
  expect(receipts.pipeline).toEqual({
    name: "audio-dashboard",
    vendorStamp: readNarrationVendorStamp(skillRoot),
  });
  expect(receipts.engine.substrate).toBe("byo-wav");
  expect(path.posix.isAbsolute(receipts.engine.whisperModel) || path.win32.isAbsolute(receipts.engine.whisperModel)).toBe(false);
  expect(receipts.gates.map((row) => `${row.gate}:${row.stage}:${row.verdict}`)).toEqual([
    "voice-role:BUILD:PASS",
    "transcript-fidelity:BUILD:PASS",
    "acoustic:BUILD:PASS",
    "onset-energy:BUILD:PASS",
    "teleprompter-drift:BUILD:PASS",
  ]);
  expect(receipts.gates.every((row) => row.violations.length === 0 && Number.isFinite(Date.parse(row.ranAt)))).toBe(true);
  expect(receipts.purges).toEqual([]);
  const portableStrings = [];
  JSON.stringify(receipts, (_key, value) => {
    if (typeof value === "string") portableStrings.push(value);
    return value;
  });
  expect(portableStrings.filter((value) => path.posix.isAbsolute(value) || path.win32.isAbsolute(value))).toEqual([]);
});

test("ruled scene deferral is visible beside response notes and portable in BUILD receipts without a fake gate PASS", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-ruled-deferral-"));
  const jobDir = path.join(root, "job");
  const words = [
    { word: "alpha", start: 0.05, end: 0.42 },
    { word: "beta", start: 0.45, end: 0.80 },
  ];
  writeSegment(jobDir, "scene-a", words);

  const deferral = {
    id: "s11a",
    status: "DEFERRED",
    reason: "31 of 31 raw tails are complete; rate-normalized D6c refinement is pending.",
    ruling: "laneD-ruling-2026-07-18",
  };
  const shippedScenes = [{ id: "scene-a", role: "host", audioWav: "fixture.wav", script: "alpha beta" }];
  expect(shippedScenes.map((scene) => scene.id)).not.toContain(deferral.id);
  const { result, outputPath } = buildDashboard({
    id: "ruled-deferral",
    title: "Ruled deferral",
    scenes: shippedScenes,
    deferredScenes: [deferral],
  }, jobDir, "ruled-deferral");

  expect(result.status).toBe(0);
  const html = readFileSync(outputPath, "utf8");
  expect(html).toContain('data-deferred-scene="s11a"');
  expect(html).toContain("31 of 31 raw tails are complete; rate-normalized D6c refinement is pending.");
  expect(html).toContain("laneD-ruling-2026-07-18");
  expect(html).toContain('var LS_KEY = "dbx:ruled-deferral.notes";');
  expect(html).toContain('var RATE_KEY = "dbx:ruled-deferral.rate";');
  expect((html.match(/\blocalStorage\b/g) || []).length).toBe(
    (html.match(/\blocalStorage\.(?:getItem|setItem|removeItem)\b/g) || []).length,
  );
  expect((html.match(/<script\b/gi) || []).length).toBe(
    (html.match(/<\/script\s*>/gi) || []).length,
  );
  expect(html).toContain(".pa-bar select#pa-speed{font-size:16px");
  expect(html).toContain(".note-area{width:100%;min-height:64px;resize:vertical;background:#060d18;color:var(--txt);border:1px solid var(--line);border-radius:10px;\n    padding:10px 11px;font:16px/1.55 inherit");

  const receipts = JSON.parse(readFileSync(outputPath.replace(/\.html$/, ".receipts.json"), "utf8"));
  expect(receipts.deferrals).toEqual([deferral]);
  expect(receipts.gates.map((row) => `${row.gate}:${row.stage}:${row.verdict}`)).toEqual([
    "voice-role:BUILD:PASS",
    "transcript-fidelity:BUILD:PASS",
    "acoustic:BUILD:PASS",
    "onset-energy:BUILD:PASS",
    "teleprompter-drift:BUILD:PASS",
  ]);
  expect(JSON.stringify(receipts.gates)).not.toContain("s11a");
});

test("BUILD rejects non-string deferred scene fields before rendering", () => {
  const baseDeferral = {
    id: "s11a",
    status: "DEFERRED",
    reason: "D6c refinement is pending.",
    ruling: "laneD-ruling-2026-07-18",
  };
  for (const field of ["id", "status", "reason", "ruling"]) {
    const { result } = buildDashboard({
      id: `invalid-deferral-${field}`,
      title: "Invalid deferral",
      scenes: [{ id: "scene-a", role: "host", audioWav: "fixture.wav", script: "alpha beta" }],
      deferredScenes: [{ ...baseDeferral, [field]: 7 }],
    }, mkdtempSync(path.join(tmpdir(), "audio-dashboard-invalid-deferral-job-")));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`spec.deferredScenes[0].${field} must be a string`);
  }
});

test("render-v4 rejects a provided non-array deferredScenes value", () => {
  expect(() => renderV4({
    title: "Invalid direct render deferral",
    scenes: [{ id: "scene-a", title: "Scene A", script: "alpha beta" }],
    deferredScenes: { id: "s11a", status: "DEFERRED", reason: "pending", ruling: "D6c" },
  })).toThrow("deferredScenes must be an array");
});

test("B13 BUILD maps approved synth timings to authored display tokens", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-b13-build-alias-"));
  const jobDir = path.join(root, "job");
  const rawWords = [
    { word: "pull", start: 0.05, end: 0.4 },
    { word: "request", start: 0.42, end: 0.85 },
  ];
  const displayWords = [
    { word: "P", start: 0.05, end: 0.4 },
    { word: "R", start: 0.42, end: 0.85 },
  ];
  writeSegment(jobDir, "expanded", displayWords, placeholderMp3, rawWords);
  writeFileSync(
    path.join(jobDir, "segments", "expanded", "expanded.wav.spoken.txt"),
    "pull request",
  );

  const { result, outputPath } = buildDashboard({
    id: "b13-build-alias",
    title: "B13 build alias",
    scenes: [{ id: "expanded", title: "Expanded", script: "P R" }],
  }, jobDir, "b13-build-alias");

  expect(result.status).toBe(0);
  const cue = tpdataFromHtml(readFileSync(outputPath, "utf8")).expanded.cues[0];
  expect(cue.text).toBe("P R");
  expect(cue.words).toEqual(displayWords);
  const receipts = JSON.parse(readFileSync(outputPath.replace(/\.html$/, ".receipts.json"), "utf8"));
  expect(receipts.gates.map((gate) => `${gate.gate}:${gate.verdict}`)).toEqual([
    "voice-role:PASS",
    "transcript-fidelity:PASS",
    "acoustic:PASS",
    "onset-energy:PASS",
    "teleprompter-drift:PASS",
  ]);
  expect(receipts.gates.find((gate) => gate.gate === "teleprompter-drift")?.derivedAliases).toEqual([
    { segment: "expanded", term: "P R", spoken: "pull request" },
  ]);
});
