import { test, expect, spawnSync, createHash, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, tmpdir, fileURLToPath, path, performance, validateAudioDashboardEvidence, analyzeAcousticArtifacts, analyzeOnsetEnergy, formatOnsetEnergyReport, ONSET_ENERGY_DEFAULTS, analyzeTeleprompterDrift, formatTeleprompterDriftReport, analyzeTranscriptFidelity, formatTranscriptFidelityReport, TRANSCRIPT_FIDELITY_DEFAULTS, createBuildReceipts, readNarrationVendorStamp, writeBuildReceipts, clearTakeCacheReceiptForByo, writeWordTimingArtifacts, formatCachePurgeReceipt, purgeRejectedTakeCaches, answersMarkdown, injectDecisionSurfaceIntoHtml, buildAfterCodeDashboardPlan, renderV4, clearTakeCacheReceipt, writeTakeCacheReceipt, loadPronunciationRules, normalizeForSpeech, here, redDir, greenDir, transcriptCalibrationPath, onsetEnergyCalibrationPath, skillPath, skillRoot, placeholderMp3, placeholderMp3Duration, loadFixtures, reds, greens, evidenceReds, evidenceGreens, driftReds, driftGreens, acousticReds, onsetEnergyReds, transcriptReds, publishDriftReds, tpdataFromHtml, writeFixtureFfprobe, writeSegment, writeToneWav, writeStereoToneWav, wordsForDuration, writeAcousticSegment, acousticFixtureSegments, buildDashboard } from "./common.mjs";


test("build-dashboard fails on voiced-frame high-f0 burst count but not s3a-like stable outliers", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-acoustic-pitch-"));
  const cleanJobDir = path.join(root, "clean-job");
  const cleanScenes = [
    writeAcousticSegment(cleanJobDir, "clean-a", { seconds: 7, words: 20, role: "expert" }),
    writeAcousticSegment(cleanJobDir, "stable-outlier", {
      seconds: 7,
      words: 20,
      role: "expert",
      highBursts: [{ start: 1.0, end: 3.1, hz: 520 }],
    }),
    writeAcousticSegment(cleanJobDir, "clean-b", { seconds: 7, words: 20, role: "expert" }),
  ];
  const clean = buildDashboard({
    id: "acoustic-clean",
    title: "Acoustic Clean",
    scenes: cleanScenes
  }, cleanJobDir, "acoustic-clean");
  expect(clean.result.status).toBe(0);

  const glitchJobDir = path.join(root, "glitch-job");
  const glitchScenes = [
    writeAcousticSegment(glitchJobDir, "clean-a", { seconds: 7, words: 20, role: "expert" }),
    writeAcousticSegment(glitchJobDir, "pitch-glitch", {
      seconds: 7,
      words: 20,
      role: "expert",
      highBursts: [{ start: 1.0, end: 3.36, hz: 520 }],
    }),
    writeAcousticSegment(glitchJobDir, "clean-b", { seconds: 7, words: 20, role: "expert" }),
  ];
  const glitch = buildDashboard({
    id: "acoustic-glitch",
    title: "Acoustic Glitch",
    scenes: glitchScenes
  }, glitchJobDir, "acoustic-glitch");

  expect(glitch.result.status).not.toBe(0);
  expect(glitch.result.stderr).toContain("ACOUSTIC_ARTIFACT");
  expect(glitch.result.stderr).toContain("pitch-glitch");
  expect(glitch.result.stderr).toContain("HIGH_F0_VOICED_FRAME_COUNT");
  expect(glitch.result.stderr).toContain("threshold=112");
});

test("RED acoustic fixture #1 rejects a repeated-token-loop long-drag segment", () => {
  const fixture = acousticReds.find((fx) => fx.case === "repeated-token-loop");
  expect(fixture).toBeDefined();

  const result = analyzeAcousticArtifacts(acousticFixtureSegments(fixture));

  expect(result.verdict).toBe("REJECTED");
  expect(result.violations.map((v) => v.metric)).toContain("DURATION_WORD_SIBLING_RATIO");
  expect(result.violations.map((v) => v.segment)).toContain("loop-drag");
});

test("RED acoustic fixture #2 rejects multi-incident duration artifacts after the absolute backstop", () => {
  const fixture = acousticReds.find((fx) => fx.case === "multi-incident-poisoned-median");
  expect(fixture).toBeDefined();

  const result = analyzeAcousticArtifacts(acousticFixtureSegments(fixture));

  expect(result.verdict).toBe("REJECTED");
  expect(result.violations.map((v) => v.metric)).toContain("DURATION_WORD_ABSOLUTE_BACKSTOP");
  for (const id of ["artifact-a", "artifact-b", "artifact-c"]) {
    expect(result.violations.map((v) => v.segment)).toContain(id);
  }
});

test("RED acoustic high-f0 multi-incident fixture rejects after the absolute backstop", () => {
  const fixture = acousticReds.find((fx) => fx.case === "high-f0-poisoned-median");
  expect(fixture).toBeDefined();

  const result = analyzeAcousticArtifacts(acousticFixtureSegments(fixture));

  expect(result.verdict).toBe("REJECTED");
  expect(result.violations.map((v) => v.metric)).toContain("HIGH_F0_VOICED_FRAME_ABSOLUTE_BACKSTOP");
  for (const id of ["artifact-a", "artifact-b", "artifact-c"]) {
    expect(result.violations.map((v) => v.segment)).toContain(id);
  }
});

test("acoustic analyzer clamps overstated WAV data chunks and skips zero-word duration ratios", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-acoustic-clamp-"));
  const wavA = path.join(root, "a.wav");
  const wavB = path.join(root, "b.wav");
  writeToneWav(wavA, { seconds: 1, baseHz: 140 });
  writeToneWav(wavB, { seconds: 1, baseHz: 140 });
  const overstated = Buffer.from(readFileSync(wavA));
  overstated.writeUInt32LE(999999, 40);

  const result = analyzeAcousticArtifacts([
    { id: "zero-words", role: "host", wavPath: wavA, wavBytes: overstated, wordCount: 0 },
    { id: "normal", role: "host", wavPath: wavB, wavBytes: readFileSync(wavB), wordCount: 10 },
  ]);

  expect(result.verdict).toBe("PASS");
  expect(result.stats.find((stat) => stat.id === "zero-words").durationPerWord).toBe(null);
});

test("resynth mode fails before rerolling when untouched sibling artifacts are absent", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-resynth-preflight-"));
  const wav = path.join(root, "source.wav");
  writeToneWav(wav, { seconds: 1, baseHz: 140 });
  const specPath = path.join(root, "job.json");
  const jobDir = path.join(root, "job");
  writeFileSync(specPath, `${JSON.stringify({
    id: "resynth-preflight",
    scenes: [
      { id: "scene-a", script: "alpha beta", audioWav: wav },
      { id: "scene-b", script: "gamma delta", audioWav: wav }
    ]
  }, null, 2)}\n`);

  const result = spawnSync(
    "bun",
    ["scripts/synth-segments.mjs", "--spec", specPath, "--job-dir", jobDir, "--resynth-scene", "scene-a"],
    { cwd: skillRoot, encoding: "utf8" },
  );

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("--resynth-scene requires an existing prior run");
  expect(result.stderr).toContain("scene-b");
});

test("partial re-render must preserve word-sync in untouched scenes", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-partial-"));
  const jobDir = path.join(root, "job");
  const mp3Duration = placeholderMp3Duration;
  const finalEnd = Number(Math.max(0.15, mp3Duration - 0.05).toFixed(3));
  const frozenWords = [
    { word: "Hello,", start: 0.02, end: Number((finalEnd * 0.30).toFixed(3)) },
    { word: "frozen", start: Number((finalEnd * 0.34).toFixed(3)), end: Number((finalEnd * 0.62).toFixed(3)) },
    { word: "scene.", start: Number((finalEnd * 0.66).toFixed(3)), end: finalEnd }
  ];
  const changedWords = [
    { word: "changed", start: 0.02, end: Number((finalEnd * 0.45).toFixed(3)) },
    { word: "scene", start: Number((finalEnd * 0.50).toFixed(3)), end: finalEnd }
  ];
  const appendedWords = [
    { word: "new", start: 0.02, end: Number((finalEnd * 0.45).toFixed(3)) },
    { word: "scene", start: Number((finalEnd * 0.50).toFixed(3)), end: finalEnd }
  ];

  writeSegment(jobDir, "frozen", frozenWords);
  const frozenWordsBefore = readFileSync(path.join(jobDir, "segments", "frozen", "words.json"), "utf8");
  const frozenMp3Before = readFileSync(path.join(jobDir, "segments", "frozen", "frozen.mp3"));

  writeSegment(jobDir, "changed", changedWords);
  writeSegment(jobDir, "appended", appendedWords);

  const { result, outputPath } = buildDashboard({
    id: "partial",
    title: "Partial",
    scenes: [
      { id: "frozen", title: "Frozen", script: "Hello, frozen -- scene." },
      { id: "changed", title: "Changed", script: "changed scene" },
      { id: "appended", title: "Appended", script: "new scene" }
    ]
  }, jobDir, "partial");

  expect(result.status).toBe(0);
  const tpdata = tpdataFromHtml(readFileSync(outputPath, "utf8"));
  for (const scene of ["frozen", "changed", "appended"]) {
    const words = tpdata[scene].cues[0].words;
    expect(Math.abs(tpdata[scene].total - mp3Duration)).toBeLessThanOrEqual(0.50);
    for (let index = 1; index < words.length; index += 1) {
      expect(words[index].start).toBeGreaterThanOrEqual(words[index - 1].end - 0.001);
    }
  }
  for (const scene of [
    ["changed", changedWords],
    ["appended", appendedWords]
  ]) {
    const renderedWords = tpdata[scene[0]].cues[0].words;
    expect(renderedWords.length).toBe(scene[1].length);
    for (const [index, word] of renderedWords.entries()) {
      expect(word.start).toBeCloseTo(scene[1][index].start, 3);
      expect(word.end).toBeCloseTo(scene[1][index].end, 3);
    }
  }
  expect(readFileSync(path.join(jobDir, "segments", "frozen", "words.json"), "utf8")).toBe(frozenWordsBefore);
  expect(readFileSync(path.join(jobDir, "segments", "frozen", "frozen.mp3"))).toEqual(frozenMp3Before);
});

test("nested timing metadata is inherited by child word payloads", () => {
  const evidence = {
    generator: "agent-html/host/build-aftercode-tonight.mjs",
    outputPath: "/opt/private/skill-tools/docs.local/dashboards/example.html",
    tailnetSync: true,
    wordsJson: [
      { word: "real", start: 0.12, end: 0.28 },
      { word: "timing", start: 0.32, end: 0.72 }
    ],
    timingData: {
      realWordTiming: true,
      script: "real timing",
      cues: [
        {
          words: [
            { word: "real", start: 0.12, end: 0.28 },
            { word: "timing", start: 0.32, end: 0.72 }
          ]
        }
      ]
    },
    html: `
      <section class="transcript"><span data-ws="0.12">real</span> <span data-ws="0.32">timing</span></section>
      <script>word.addEventListener('click', () => { audio.currentTime = Number(word.dataset.ws); });</script>
    `
  };

  const result = validateAudioDashboardEvidence(evidence);
  expect(result.verdict).toBe("PASS");
  expect(result.realWordTiming).toBe(true);
  expect(result.realTranscript).toBe(true);
});

test("narrationlayer timing.status available with nonempty words is accepted", () => {
  const evidence = {
    generator: "narrationlayer/src/dashboard.ts",
    outputPath: "/Users/example/Gits/narrationlayer/docs.local/dashboards/example.html",
    publish: {
      tailnetSync: {
        status: "completed"
      }
    },
    wordsJson: [
      { word: "real", start: 0.12, end: 0.28 },
      { word: "timing", start: 0.32, end: 0.72 }
    ],
    timingData: {
      timing: { status: "available" },
      script: "real timing",
      words: [
        { word: "real", start: 0.12, end: 0.28 },
        { word: "timing", start: 0.32, end: 0.72 }
      ]
    },
    html: `
      <section class="transcript"><span data-ws="0.12">real</span> <span data-ws="0.32">timing</span></section>
      <script>word.addEventListener('click', () => { audio.currentTime = Number(word.dataset.ws); });</script>
    `
  };

  const result = validateAudioDashboardEvidence(evidence);
  expect(result.verdict).toBe("PASS");
  expect(result.realWordTiming).toBe(true);
});

test("historical terms in transcript text do not trigger old-generator rejection", () => {
  const evidence = {
    generator: "agent-html/host/build-aftercode-tonight.mjs",
    outputPath: "/opt/private/skill-tools/docs.local/dashboards/example.html",
    publishCommand: "node /opt/private/coordination/scripts/sync-tailnet-dashboards.mjs",
    wordsJson: [
      { word: "gen16", start: 0.12, end: 0.28 },
      { word: "cue", start: 0.32, end: 0.72 }
    ],
    html: `
      <script id="tpdata" type="application/json">
        [{"realWordTiming":true,"script":"gen16 cue","words":[{"word":"gen16","start":0.12,"end":0.28},{"word":"cue","start":0.32,"end":0.72}]}]
      </script>
      <section class="transcript"><span data-ws="0.12">gen16</span> <span data-ws="0.32">cue</span></section>
      <script>word.addEventListener('click', () => { audio.currentTime = Number(word.dataset.ws); });</script>
    `
  };

  const result = validateAudioDashboardEvidence(evidence);
  expect(result.verdict).toBe("PASS");
  expect(result.violations.map((v) => v.code)).not.toContain("OLD_GOLEMPLAYLIST_V1");
});

test("AfterCode wrapper emits the SKILL-LOCAL command chain and no external-repo delegation", () => {
  const skillRoot = "/opt/skills/audio-dashboard";
  const plan = buildAfterCodeDashboardPlan({
    skillRoot,
    env: { HOME: "/Users/tester", GITS_ROOT: "/tmp/Gits" }
  });
  const commands = plan.steps.map((step) => step.command).join("\n");

  expect(plan.workflow).toBe("aftercode");
  // Every engine step runs against skill-local scripts + vendor, not ~/Gits repos.
  expect(commands).toContain(`cd ${skillRoot} && bun scripts/bootstrap.mjs`);
  expect(commands).toContain(`cd ${skillRoot} && bun scripts/synth-segments.mjs --spec`);
  expect(commands).toContain(`cd ${skillRoot} && bun scripts/build-dashboard.mjs --spec`);
  expect(commands).toContain(`cd ${skillRoot} && bun vendor/qa/verify-cinema.mjs`);
  expect(commands).toContain(`cd ${skillRoot} && bun scripts/verify-tailnet-publish.mjs --spec`);
  // The old external one-off scripts must be GONE from the plan.
  expect(commands).not.toContain("bin/aftercode-tonight-synth.ts");
  expect(commands).not.toContain("regen-aftercode-tonight-real-word-timings.ts");
  expect(commands).not.toContain("agent-html/host");
  expect(commands).not.toContain("build-aftercode-tonight.mjs");
  // The default spec is skill-local, not a /opt/private/skill-tools doc.
  expect(commands).toContain(`${skillRoot}/examples/job.json`);
  // Publish is the one env-specific step; it resolves from the env and must be probed.
  expect(commands).toContain("/tmp/Gits/orchestrator/scripts/sync-tailnet-dashboards.mjs");
  expect(plan.steps.at(-2).name).toBe("publish-tailnet");
  expect(plan.steps.at(-1).name).toBe("verify-tailnet-http-200");
  expect(plan.steps.some((step) => step.optional)).toBe(false);
  expect(commands).not.toContain("cp ");
  expect(commands).not.toContain("dashboards-serve/");
  expect(plan.notes.join("\n")).toContain("local-tts-runner.ts");
  expect(plan.notes.join("\n")).toContain("splitForBreathing");
  expect(plan.notes.join("\n")).toContain("HTTP 200");
  for (const step of plan.steps) {
    expect(step.cwd).toBeString();
    expect(step.command).toBeString();
    expect(step.args).toBeArray();
  }
});

test("AfterCode wrapper display commands are shell-safe for paths with spaces", () => {
  const plan = buildAfterCodeDashboardPlan({
    skillRoot: "/opt/skills/audio dashboard",
    specPath: "/opt/skills/audio dashboard/examples/job.json",
    env: { HOME: "/Users/example", GITS_ROOT: "/tmp/Gits" }
  });

  expect(plan.steps[0].command).toContain("cd '/opt/skills/audio dashboard'");
  const synth = plan.steps.find((s) => s.name === "synth-and-time-segments");
  expect(synth.command).toContain("'/opt/skills/audio dashboard/examples/job.json'");
});

test("tailnet publish verifier derives the dashboard URL from docs.local output paths", () => {
  const plan = buildAfterCodeDashboardPlan({
    skillRoot: "/opt/skills/audio-dashboard",
    specPath: "/tmp/job.json",
    env: {
      HOME: "/Users/tester",
      GITS_ROOT: "/tmp/Gits",
      AUDIO_DASHBOARD_TAILNET_BASE_URL: "https://tailnet.example/dashboards"
    }
  });
  const verify = plan.steps.find((step) => step.name === "verify-tailnet-http-200");

  expect(verify).toBeDefined();
  expect(verify.command).toContain("scripts/verify-tailnet-publish.mjs --spec /tmp/job.json");
  expect(verify.command).toContain("--base-url https://tailnet.example/dashboards");
});

test("SKILL.md exposes the canonical trigger language and consolidation boundaries", () => {
  const skill = readFileSync(skillPath, "utf8");

  expect(skill).toContain("STT-after-TTS exact word-timing");
  expect(skill).toContain("real word-click-seek read-along dashboard");
  expect(skill).toContain("AfterCode workflow");
  expect(skill).toContain("publish-to-tailnet");
  expect(skill).toContain("## AfterCode Workflow");
  expect(skill).toContain("## Supersedes");
  // Canonical path is now SKILL-LOCAL (vendored engine), not external one-offs.
  expect(skill).toContain("scripts/synth-segments.mjs");
  expect(skill).toContain("scripts/build-dashboard.mjs");
  expect(skill).toContain("scripts/bootstrap.mjs");
  expect(skill).toContain("NARRATIONLAYER_PROFILES_FILE");
  expect(skill).toContain("persistent session");
  expect(skill).toContain("vendor/");
  expect(skill).toContain("Transcript Fidelity and Teleprompter Drift BUILD Gates");
  expect(skill).toContain("src/teleprompter-drift-gate.mjs");
  // Portability + invariants must be documented.
  expect(skill).toContain("## Bootstrap");
  expect(skill).toContain("## Transfer");
  // Standing invariants (unchanged).
  expect(skill).toContain("build-aftercode-cinema.mjs");
  expect(skill).toContain("dashboards-serve");
  expect(skill).toContain("Acoustic Artifact Gate");
  expect(skill).toContain("DURATION_WORD_ABSOLUTE_BACKSTOP");
  expect(skill).toContain("HIGH_F0_VOICED_FRAME_ABSOLUTE_BACKSTOP");
  expect(skill).toContain("Onset Energy BUILD Gate");
  expect(skill).toContain("ONSET_ENERGY_ABSOLUTE_RMS_DBFS");
  expect(skill).toContain("ONSET_ENERGY_PEAK_DELTA_DB");
  expect(skill).toContain("generate-onset-energy-calibration.mjs");
  expect(skill).toContain("fourth additive BUILD row");
  expect(skill).toContain("cache-hit re-synth returns the identical glitched take");
  expect(skill).toContain("BUILD Receipts Sidecar");
  expect(skill).toContain("words.raw.json");
  expect(skill).toContain("CACHE_PURGE");
  expect(skill).toContain("--resynth-scene");
  expect(skill).toContain("--no-cache");
  expect(skill).toContain("## Dashboard Types");
  expect(skill).toContain("Type: `decision-flow`");
  expect(skill).toContain("Type: `cinema`");
  expect(skill).toContain("templates/decision-flow/");
  expect(skill).toContain('"type": "decision-flow"');
  expect(skill).toContain("assume the listener has zero prior context");
  expect(skill).toContain("define every internal term, codename, and agent-coined label");
});

test("evals.json canonical case names the full shipping contract", () => {
  const evals = JSON.parse(readFileSync(path.join(here, "evals.json"), "utf8"));
  expect(evals.skill_name).toBe("audio-dashboard");
  expect(evals.evals).toBeArray();
  const canonical = evals.evals.find((item) => item.name === "canonical-readalong-passes");
  expect(canonical).toBeDefined();
  const names = canonical.assertions.map((assertion) => assertion.name);

  expect(names).toContain("requires-real-words-json");
  expect(names).toContain("requires-raw-words-json");
  expect(names).toContain("requires-nonempty-words");
  expect(names).toContain("requires-real-timing-status");
  expect(names).toContain("requires-word-click-seek");
  expect(names).toContain("requires-real-transcript");
  expect(names).toContain("requires-docslocal-publish-source");
  expect(names).toContain("requires-build-receipts");
  expect(names).toContain("requires-tailnet-sync");
  const acoustic = evals.evals.find((item) => item.name === "synthesized-audio-acoustic-artifact-gate");
  expect(acoustic).toBeDefined();
  expect(acoustic.description).toContain("acoustic-artifact invariants");
  expect(acoustic.assertions.map((assertion) => assertion.name)).toContain("flags-duration-word-sibling-ratio");
  expect(acoustic.assertions.map((assertion) => assertion.name)).toContain("flags-high-f0-voiced-frame-count");
  expect(acoustic.assertions.map((assertion) => assertion.name)).toContain("flags-repeated-token-loop-long-drag");
  expect(acoustic.assertions.map((assertion) => assertion.name)).toContain("flags-multi-incident-poisoned-median");
  expect(acoustic.assertions.map((assertion) => assertion.name)).toContain("flags-high-f0-absolute-backstop");
  expect(acoustic.assertions.map((assertion) => assertion.name)).toContain("passes-s3a-like-stable-outlier");
  expect(acoustic.assertions.map((assertion) => assertion.name)).toContain("resynth-busts-tts-cache");
  expect(acoustic.assertions.map((assertion) => assertion.name)).toContain("flags-quiet-onset-absolute-floor");
  expect(acoustic.assertions.map((assertion) => assertion.name)).toContain("flags-quiet-onset-relative-delta");
  expect(acoustic.assertions.map((assertion) => assertion.name)).toContain("calibrates-33-clean-onsets");
  const drift = evals.evals.find((item) => item.name === "teleprompter-tail-drift-gate");
  expect(drift).toBeDefined();
  expect(drift.assertions.map((assertion) => assertion.name)).toContain("passes-banked-in-sync-green-fixture");
  expect(drift.assertions.map((assertion) => assertion.name)).toContain("rejects-tail-only-accumulated-drift");
  expect(drift.assertions.map((assertion) => assertion.name)).toContain("checks-the-tail");
  expect(drift.assertions.map((assertion) => assertion.name)).toContain("runs-under-stop-class-budget");
  const decisions = evals.evals.find((item) => item.name === "native-decision-surface-round-trip");
  expect(decisions).toBeDefined();
  expect(decisions.assertions.map((assertion) => assertion.name)).toContain("renders-spec-decisions");
  expect(decisions.assertions.map((assertion) => assertion.name)).toContain("exports-copy-answers-markdown");
  expect(decisions.assertions.map((assertion) => assertion.name)).toContain("idempotent-injection");
  const decisionFlow = evals.evals.find((item) => item.name === "decision-flow-card-local-audio");
  expect(decisionFlow).toBeDefined();
  expect(decisionFlow.assertions.map((assertion) => assertion.name)).toContain("distinct-from-cinema");
  expect(decisionFlow.assertions.map((assertion) => assertion.name)).toContain("card-local-full-section-audio");
  expect(decisionFlow.assertions.map((assertion) => assertion.name)).toContain("collapses-teleprompter-when-ready");
  expect(decisionFlow.assertions.map((assertion) => assertion.name)).toContain("advances-or-skips");
  const zeroContextNarration = evals.evals.find((item) => item.name === "decision-flow-zero-context-narration");
  expect(zeroContextNarration).toBeDefined();
  expect(zeroContextNarration.assertions.map((assertion) => assertion.name)).toContain("defines-internal-terms-inline");
  expect(zeroContextNarration.assertions.map((assertion) => assertion.name)).toContain("explains-decision-consequences");
  expect(zeroContextNarration.assertions.map((assertion) => assertion.name)).toContain("forbids-unexplained-agent-jargon");
});
