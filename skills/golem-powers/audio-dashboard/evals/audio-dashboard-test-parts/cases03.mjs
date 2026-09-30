import { test, expect, spawnSync, createHash, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, tmpdir, fileURLToPath, path, performance, validateAudioDashboardEvidence, analyzeAcousticArtifacts, analyzeOnsetEnergy, formatOnsetEnergyReport, ONSET_ENERGY_DEFAULTS, analyzeTeleprompterDrift, formatTeleprompterDriftReport, analyzeTranscriptFidelity, formatTranscriptFidelityReport, TRANSCRIPT_FIDELITY_DEFAULTS, createBuildReceipts, readNarrationVendorStamp, writeBuildReceipts, clearTakeCacheReceiptForByo, writeWordTimingArtifacts, formatCachePurgeReceipt, purgeRejectedTakeCaches, answersMarkdown, injectDecisionSurfaceIntoHtml, buildAfterCodeDashboardPlan, renderV4, clearTakeCacheReceipt, writeTakeCacheReceipt, loadPronunciationRules, normalizeForSpeech, here, redDir, greenDir, transcriptCalibrationPath, onsetEnergyCalibrationPath, skillPath, skillRoot, placeholderMp3, placeholderMp3Duration, loadFixtures, reds, greens, evidenceReds, evidenceGreens, driftReds, driftGreens, acousticReds, onsetEnergyReds, transcriptReds, publishDriftReds, tpdataFromHtml, writeFixtureFfprobe, writeSegment, writeToneWav, writeStereoToneWav, wordsForDuration, writeAcousticSegment, acousticFixtureSegments, buildDashboard } from "./common.mjs";


test("evidence accepts decision-flow data-word-start click seeking", () => {
  const words = [
    { word: "real", start: 0.12, end: 0.28 },
    { word: "timing", start: 0.32, end: 0.72 }
  ];
  const result = validateAudioDashboardEvidence({
    generator: "agent-html/lib/render-v4.mjs",
    outputPath: "/opt/private/coordination/docs.local/dashboards/decision-flow.html",
    tailnetSync: true,
    wordsJson: words,
    timingData: { realWordTiming: true, script: "real timing", words },
    html: `<button data-word-start="0.12">real</button><script>word.addEventListener("click",function(){audio.currentTime = Number(word.dataset.wordStart);});</script>`
  });

  expect(result.wordClickSeek).toBe(true);
  expect(result.violations.map((v) => v.code)).not.toContain("MISSING_WORD_CLICK_SEEK");
});

test("a direct dashboards-serve output path is rejected because sync rebuilds that tree", () => {
  const evidence = {
    generator: "agent-html/host/build-aftercode-tonight.mjs",
    outputPath: "/opt/private/coordination/docs.local/dashboards-serve/dashboards/skill-creator/example.html",
    wordsJson: [
      { word: "real", start: 0.12, end: 0.28 },
      { word: "timing", start: 0.32, end: 0.72 }
    ],
    html: `
      <script id="tpdata" type="application/json">
        [{"realWordTiming":true,"script":"real timing","words":[{"word":"real","start":0.12,"end":0.28},{"word":"timing","start":0.32,"end":0.72}]}]
      </script>
      <section class="transcript"><span data-ws="0.12">real</span> <span data-ws="0.32">timing</span></section>
      <script>word.addEventListener('click', () => { audio.currentTime = Number(word.dataset.ws); });</script>
    `
  };

  const result = validateAudioDashboardEvidence(evidence);
  expect(result.verdict).toBe("REJECTED");
  expect(result.violations.map((v) => v.code)).toContain("WRONG_PUBLISH_TARGET");
});

test("missing generator or output path is rejected fail-closed", () => {
  const evidence = {
    wordsJson: [
      { word: "real", start: 0.12, end: 0.28 },
      { word: "timing", start: 0.32, end: 0.72 }
    ],
    html: `
      <script id="tpdata" type="application/json">
        [{"realWordTiming":true,"script":"real timing","words":[{"word":"real","start":0.12,"end":0.28},{"word":"timing","start":0.32,"end":0.72}]}]
      </script>
      <section class="transcript"><span data-ws="0.12">real</span> <span data-ws="0.32">timing</span></section>
      <script>word.addEventListener('click', () => { audio.currentTime = Number(word.dataset.ws); });</script>
    `
  };

  const result = validateAudioDashboardEvidence(evidence);
  expect(result.verdict).toBe("REJECTED");
  expect(result.violations.map((v) => v.code)).toContain("NON_CANONICAL_GENERATOR");
  expect(result.violations.map((v) => v.code)).toContain("WRONG_PUBLISH_TARGET");
});

test("word-click seek must use the clicked word timestamp in the click handler", () => {
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
        [{"realWordTiming":true,"script":"real timing","words":[{"word":"real","start":0.12,"end":0.28},{"word":"timing","start":0.32,"end":0.72}]}]
      </script>
      <section class="transcript"><span data-ws="0.12">real</span> <span data-ws="0.32">timing</span></section>
      <button id="restart">Restart</button>
      <script>restart.addEventListener('click', () => { audio.currentTime = 0; });</script>
    `
  };

  const result = validateAudioDashboardEvidence(evidence);
  expect(result.verdict).toBe("REJECTED");
  expect(result.violations.map((v) => v.code)).toContain("MISSING_WORD_CLICK_SEEK");
});

test("docs.local output without tailnet sync evidence is rejected", () => {
  const evidence = {
    generator: "agent-html/host/build-aftercode-tonight.mjs",
    outputPath: "/opt/private/skill-tools/docs.local/dashboards/example.html",
    wordsJson: [
      { word: "real", start: 0.12, end: 0.28 },
      { word: "timing", start: 0.32, end: 0.72 }
    ],
    html: `
      <script id="tpdata" type="application/json">
        [{"realWordTiming":true,"script":"real timing","words":[{"word":"real","start":0.12,"end":0.28},{"word":"timing","start":0.32,"end":0.72}]}]
      </script>
      <section class="transcript"><span data-ws="0.12">real</span> <span data-ws="0.32">timing</span></section>
      <script>word.addEventListener('click', () => { audio.currentTime = Number(word.dataset.ws); });</script>
    `
  };

  const result = validateAudioDashboardEvidence(evidence);
  expect(result.verdict).toBe("REJECTED");
  expect(result.violations.map((v) => v.code)).toContain("MISSING_TAILNET_SYNC");
});

test("overlapping or backward word timings are rejected", () => {
  const evidence = {
    generator: "agent-html/host/build-aftercode-tonight.mjs",
    outputPath: "/opt/private/skill-tools/docs.local/dashboards/example.html",
    wordsJson: [
      { word: "real", start: 0.40, end: 0.90 },
      { word: "timing", start: 0.70, end: 1.10 }
    ],
    html: `
      <script id="tpdata" type="application/json">
        [{"realWordTiming":true,"script":"real timing","words":[{"word":"real","start":0.40,"end":0.90},{"word":"timing","start":0.70,"end":1.10}]}]
      </script>
      <section class="transcript"><span data-ws="0.40">real</span> <span data-ws="0.70">timing</span></section>
      <script>word.addEventListener('click', () => { audio.currentTime = Number(word.dataset.ws); });</script>
    `
  };

  const result = validateAudioDashboardEvidence(evidence);
  expect(result.verdict).toBe("REJECTED");
  expect(result.violations.map((v) => v.code)).toContain("NON_MONOTONIC_WORD_TIMING");
});

test("render-v4 preserves already-aligned words.json timings without a second tokenizer remap", () => {
  const wordsJson = [
    { word: "Hello,", start: 0.05, end: 0.18 },
    { word: "aligned", start: 0.21, end: 0.42 },
    { word: "scene.", start: 0.45, end: 0.72 }
  ];
  const html = renderV4({
    title: "Tokenizer Regression",
    scenes: [
      {
        id: "frozen",
        title: "Frozen scene",
        script: "Hello, aligned -- scene.",
        words: wordsJson,
        audioUrl: "data:audio/mpeg;base64,ZmFrZQ=="
      }
    ]
  });

  const tpdata = tpdataFromHtml(html);
  const renderedWords = tpdata.frozen.cues[0].words;

  expect(renderedWords.length).toBe(wordsJson.length);
  for (const [index, word] of renderedWords.entries()) {
    expect(word.word).toBe(wordsJson[index].word);
    expect(word.start).toBeCloseTo(wordsJson[index].start, 3);
    expect(word.end).toBeCloseTo(wordsJson[index].end, 3);
    if (index > 0) {
      expect(word.start).toBeGreaterThanOrEqual(renderedWords[index - 1].end - 0.001);
    }
  }
});

test("render-v4 ships an immediate cold-load state that clears on cinema boot", () => {
  const html = renderV4({
    title: "Cold Load",
    scenes: [
      {
        id: "loader",
        title: "Loader scene",
        script: "Loading state appears before embedded audio.",
        words: [
          { word: "Loading", start: 0.02, end: 0.12 },
          { word: "state", start: 0.14, end: 0.24 },
          { word: "appears", start: 0.26, end: 0.38 },
          { word: "before", start: 0.40, end: 0.50 },
          { word: "embedded", start: 0.52, end: 0.64 },
          { word: "audio.", start: 0.66, end: 0.78 }
        ],
        audioUrl: "data:audio/mpeg;base64,ZmFrZQ=="
      }
    ]
  });

  expect(html).toContain('<body class="golem-booting">');
  expect(html).toContain('id="golem-coldload"');
  expect(html).toContain("Loading audio brief");
  expect(html.indexOf('id="golem-coldload"')).toBeGreaterThan(html.indexOf("<body"));
  expect(html.indexOf('id="golem-coldload"')).toBeLessThan(html.indexOf("data:audio/mpeg;base64,"));
  expect(html).toContain("__golemDashboardReady");
  expect(html).toContain("cinema-boot");
  expect(html).toContain("window-load-fallback");
  expect(html).toContain('setAttribute("hidden", "hidden")');
});

test("build-dashboard fails when final tpdata words overlap", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-overlap-"));
  const jobDir = path.join(root, "job");
  writeSegment(jobDir, "scene-a", [
    { word: "alpha", start: 0.05, end: 0.45 },
    { word: "beta", start: 0.30, end: 0.60 }
  ]);

  const { result } = buildDashboard({
    id: "overlap",
    title: "Overlap",
    scenes: [{ id: "scene-a", title: "Scene A", script: "alpha beta" }]
  }, jobDir, "overlap");

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("non-overlapping");
});

test("build-dashboard fails when tpdata duration disagrees with the embedded mp3", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-duration-"));
  const jobDir = path.join(root, "job");
  writeSegment(jobDir, "scene-a", [
    { word: "alpha", start: 0.05, end: 3.00 },
    { word: "beta", start: 3.02, end: 4.00 }
  ]);

  const { result } = buildDashboard({
    id: "duration",
    title: "Duration",
    scenes: [{ id: "scene-a", title: "Scene A", script: "alpha beta" }]
  }, jobDir, "duration");

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("ffprobe");
});

test("build-dashboard fails when any scene is missing mp3 or words.json artifacts", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-missing-"));
  const jobDir = path.join(root, "job");
  writeSegment(jobDir, "scene-a", [
    { word: "alpha", start: 0.05, end: 0.20 },
    { word: "beta", start: 0.22, end: 0.40 }
  ]);

  const { result } = buildDashboard({
    id: "missing",
    title: "Missing",
    scenes: [
      { id: "scene-a", title: "Scene A", script: "alpha beta" },
      { id: "scene-b", title: "Scene B", script: "gamma delta" }
    ]
  }, jobDir, "missing");

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("MISSING_RAW_TRANSCRIPT_SERIES");
});

test("build-dashboard renders native decision boxes from spec.decisions with a copyable answer round-trip", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-decisions-"));
  const jobDir = path.join(root, "job");
  writeSegment(jobDir, "scene-a", [
    { word: "alpha", start: 0.05, end: 0.42 },
    { word: "beta", start: 0.45, end: 0.80 }
  ]);
  const decisions = [
    {
      id: "ship-path",
      title: "Ship path",
      deadline: "today",
      body: "Choose whether the decision surface ships natively. Literal $& tokens survive insertion.",
      options: ["Native render", "Post-inject"]
    },
    {
      id: "handoff",
      title: "Handoff",
      body: "Record what dashboardLead should review.",
      options: ["Ready for review", "Blocked"]
    }
  ];

  const { result, outputPath } = buildDashboard({
    id: "native-decisions",
    title: "Native Decisions",
    answerSink: "http://127.0.0.1:8765/answers",
    scenes: [{ id: "scene-a", title: "Scene A", script: "alpha beta" }],
    decisions
  }, jobDir, "native-decisions");

  expect(result.status).toBe(0);
  const html = readFileSync(outputPath, "utf8");
  expect(html).toContain('id="decision-boxes"');
  expect(html).toContain('data-storage-key="dbx:native-decisions"');
  expect(html).toContain('data-answer-sink="http://127.0.0.1:8765/answers"');
  expect(html).toContain("Literal $&amp; tokens survive insertion.");
  expect(html).not.toContain("Literal </body>amp; tokens");
  expect((html.match(/<section class="dbx-card"/g) || []).length).toBe(2);
  expect((html.match(/<input type="radio"/g) || []).length).toBe(4);
  expect(html).toContain('class="note-area dbx-free"');
  expect(html).toContain('id="dbx-copy"');
  expect(html).toContain(">Copy answers<");
  expect((html.match(/DECISION-BOXES:BEGIN/g) || []).length).toBe(1);

  const markdown = answersMarkdown(decisions, {
    "ship-path": "Native render",
    "ship-path-free": "Keep the round-trip skill-local.",
    "handoff-free": "dashboardLead reviews and merges."
  }, "dbx:native-decisions");
  expect(markdown).toContain("## Decision answers - native-decisions");
  expect(markdown).toContain("### Ship path");
  expect(markdown).toContain("- picked: Native render");
  expect(markdown).toContain("- in your words: Keep the round-trip skill-local.");
  expect(markdown).toContain("### Handoff");
  expect(markdown).toContain("- picked: (no option picked)");
  expect(markdown).toContain("- in your words: dashboardLead reviews and merges.");

  const baseHtml = "<!doctype html><html><body><main>Audio dashboard</main></body></html>";
  const once = injectDecisionSurfaceIntoHtml(baseHtml, decisions, { storageKey: "dbx:native-decisions" });
  const twice = injectDecisionSurfaceIntoHtml(once.html, decisions, { storageKey: "dbx:native-decisions" });
  expect((twice.html.match(/DECISION-BOXES:BEGIN/g) || []).length).toBe(1);
  expect(twice.stats.cards).toBe(2);
  expect(twice.stats.radios).toBe(4);
  expect(twice.stats.copy).toBe(true);
});

test("build-dashboard renders decision-flow as a distinct card-local audio type", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-decision-flow-"));
  const jobDir = path.join(root, "job");
  for (const sceneId of ["intro", "decision-a", "decision-b"]) {
    writeSegment(jobDir, sceneId, [
      { word: `${sceneId}-alpha`, start: 0.05, end: 0.42 },
      { word: `${sceneId}-beta`, start: 0.45, end: 0.80 }
    ]);
  }

  const { result, outputPath } = buildDashboard({
    type: "decision-flow",
    id: "decision-flow-contract",
    title: "Decision flow",
    kicker: "Six calls · one clean pass",
    scenes: [
      { id: "intro", title: "Context", script: "intro-alpha intro-beta" },
      { id: "decision-a", title: "Decision A", script: "decision-a-alpha decision-a-beta" },
      { id: "decision-b", title: "Decision B", script: "Play All decision-b-alpha decision-b-beta" }
    ],
    decisions: [
      {
        id: "path-a",
        rank: 1,
        title: "Path $& costs $$",
        status: "OPEN",
        body: "Choose the first path.",
        summary: "The first decision owns the context and its answer clip.",
        options: ["Keep", "Change"],
        sceneIds: ["intro", "decision-a"],
        rail: [{ label: "Owner", value: "Etan" }]
      },
      {
        id: "path-b",
        rank: 2,
        title: "Path B",
        status: "READY",
        body: "Choose the second path.",
        options: ["One", "Two"],
        sceneIds: ["decision-b"]
      }
    ]
  }, jobDir, "decision-flow-contract");

  expect(result.status).toBe(0);
  const html = readFileSync(outputPath, "utf8");
  expect(html).toContain('data-dashboard-type="decision-flow"');
  expect(html).not.toContain('id="cinema"');
  expect(html).not.toContain('id="pa-bar"');
  expect((html.match(/<article class="df-card/g) || []).length).toBe(2);
  expect((html.match(/class="df-play"/g) || []).length).toBe(2);
  expect((html.match(/data-audio-scene=/g) || []).length).toBe(3);
  expect(html).toContain('data-audio-scene="intro"');
  expect(html).toContain("Path $&amp; costs $$");
  expect(html).toContain('class="df-teleprompter"');
  expect(html).toContain('data-word-start="0.05"');
  expect(html).toContain("audios[audioIndex].currentTime=Number(word.dataset.wordStart)");
  expect(html).toContain('class="note-area df-free"');
  expect(html).toContain('class="df-next"');
  expect(html).toContain('class="df-skip"');
  expect(html).toContain('id="df-copy"');
  expect(html).toContain("localStorage.setItem");
  expect(html).toContain('"realWordTiming":true');
  expect(html).toContain('card.querySelector(".df-teleprompter").hidden=true');
  expect(html).toContain("audio.onended=function(){clearHighlights(card,audio.dataset.audioScene);playAt(card,audioIndex+1);}");
  expect(html).toContain('class="df-restart"');
  expect(html).toContain('button.classList.add("is-acknowledged")');
  expect(html).toContain('id="df-storage-state"');
  expect(html).toContain("Storage unavailable · use Copy answers");
  expect(html).toContain('class="df-player-state" aria-live="polite"');
  expect(html).toContain('<fieldset class="df-options">');
  expect(html).toContain('<legend class="df-sr-only">Path $&amp; costs $$ options</legend>');

  const qa = spawnSync("bun", ["vendor/qa/verify-decision-flow.mjs", outputPath], {
    cwd: skillRoot,
    encoding: "utf8",
  });
  expect(qa.status).toBe(0);
  const qaReport = JSON.parse(qa.stdout);
  expect(qaReport.pass).toBe(true);
  expect(qaReport.cards).toBe(2);
  expect(qaReport.audioDataUris).toBe(3);
  expect(qaReport.scenesWithWords).toBe("3/3");
});

test("decision-flow defaults omitted options to a free-text-only answer", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-decision-flow-free-text-"));
  const jobDir = path.join(root, "job");
  writeSegment(jobDir, "only", [
    { word: "alpha", start: 0.05, end: 0.42 },
    { word: "beta", start: 0.45, end: 0.80 }
  ]);
  const { result, outputPath } = buildDashboard({
    type: "decision-flow",
    id: "free-text-only",
    scenes: [{ id: "only", script: "alpha beta" }],
    decisions: [{ id: "free", title: "Free text", sceneIds: ["only"] }]
  }, jobDir, "free-text-only");

  expect(result.status).toBe(0);
  const html = readFileSync(outputPath, "utf8");
  expect(html).toContain('<fieldset class="df-options">');
  expect(html).toContain('class="note-area df-free"');
  expect((html.match(/<input type="radio"/g) || []).length).toBe(0);
});

test("decision-flow fails closed when a scene is not owned by exactly one decision", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-decision-flow-ownership-"));
  const jobDir = path.join(root, "job");
  for (const sceneId of ["owned", "orphan"]) {
    writeSegment(jobDir, sceneId, [
      { word: "alpha", start: 0.05, end: 0.42 },
      { word: "beta", start: 0.45, end: 0.80 }
    ]);
  }

  const { result } = buildDashboard({
    type: "decision-flow",
    id: "decision-flow-ownership",
    title: "Decision flow ownership",
    scenes: [
      { id: "owned", title: "Owned", script: "alpha beta" },
      { id: "orphan", title: "Orphan", script: "alpha beta" }
    ],
    decisions: [
      { id: "only", title: "Only", body: "Pick.", options: ["A", "B"], sceneIds: ["owned"] }
    ]
  }, jobDir, "decision-flow-ownership");

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("decision-flow scene ownership");
  expect(result.stderr).toContain("orphan");
});

test("decision-flow rejects duplicate decision ids before render", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-decision-flow-duplicate-"));
  const jobDir = path.join(root, "job");
  for (const sceneId of ["first", "second"]) {
    writeSegment(jobDir, sceneId, [
      { word: "alpha", start: 0.05, end: 0.42 },
      { word: "beta", start: 0.45, end: 0.80 }
    ]);
  }

  const { result } = buildDashboard({
    type: "decision-flow",
    id: "duplicate-decisions",
    scenes: [
      { id: "first", script: "alpha beta" },
      { id: "second", script: "alpha beta" }
    ],
    decisions: [
      { id: "same", title: "First", options: ["A"], sceneIds: ["first"] },
      { id: "same", title: "Second", options: ["B"], sceneIds: ["second"] }
    ]
  }, jobDir, "duplicate-decisions");

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("duplicate decision id: same");
});

test("decision-flow rejects duplicate scene ids before render", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-decision-flow-duplicate-scenes-"));
  const jobDir = path.join(root, "job");
  writeSegment(jobDir, "same", [
    { word: "alpha", start: 0.05, end: 0.42 },
    { word: "beta", start: 0.45, end: 0.80 }
  ]);

  const { result } = buildDashboard({
    type: "decision-flow",
    id: "duplicate-scenes",
    scenes: [
      { id: "same", script: "alpha beta" },
      { id: "same", script: "different content" }
    ],
    decisions: [{ id: "only", title: "Only", options: ["A"], sceneIds: ["same"] }]
  }, jobDir, "duplicate-scenes");

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("duplicate scene.id: same");
});

test("decision-flow rejects a missing decision id before render", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-decision-flow-missing-id-"));
  const jobDir = path.join(root, "job");
  writeSegment(jobDir, "only", [
    { word: "alpha", start: 0.05, end: 0.42 },
    { word: "beta", start: 0.45, end: 0.80 }
  ]);

  const { result } = buildDashboard({
    type: "decision-flow",
    id: "missing-decision-id",
    scenes: [{ id: "only", script: "alpha beta" }],
    decisions: [{ title: "Missing id", options: ["A"], sceneIds: ["only"] }]
  }, jobDir, "missing-decision-id");

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("decision 0 needs a slug-safe id");
});

test("decision-flow QA reports unreadable inputs as structured JSON", () => {
  const missing = path.join(tmpdir(), "missing-decision-flow-dashboard.html");
  const qa = spawnSync("bun", ["vendor/qa/verify-decision-flow.mjs", missing], {
    cwd: skillRoot,
    encoding: "utf8",
  });

  expect(qa.status).toBe(1);
  const report = JSON.parse(qa.stderr);
  expect(report.pass).toBe(false);
  expect(report.error).toContain("cannot read file");
});

test("build-dashboard fails when a same-role segment has inflated duration per word", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-acoustic-ratio-"));
  const jobDir = path.join(root, "job");
  const scenes = [
    writeAcousticSegment(jobDir, "host-a", { seconds: 4, words: 10, role: "host" }),
    writeAcousticSegment(jobDir, "host-b", { seconds: 4.2, words: 10, role: "host" }),
    writeAcousticSegment(jobDir, "host-glitch", { seconds: 5.6, words: 10, role: "host" }),
  ];
  const cacheFixture = reds.find((item) => item.file === "11-poisoned-take-cache.json");
  const home = path.join(root, "home");
  const cacheDir = path.join(home, ".narrationlayer", "tts-cache");
  mkdirSync(cacheDir, { recursive: true });
  const poisonedPath = path.join(cacheDir, `${cacheFixture.cacheKey}.wav`);
  writeFileSync(poisonedPath, Buffer.from(cacheFixture.portableExtraction.base64, "base64"));
  writeFileSync(
    path.join(jobDir, "segments", "host-glitch", "host-glitch.wav.cache.json"),
    `${JSON.stringify({ version: 1, cacheKey: cacheFixture.cacheKey }, null, 2)}\n`,
  );

  const { result, outputPath } = buildDashboard({
    id: "acoustic-ratio",
    title: "Acoustic Ratio",
    scenes
  }, jobDir, "acoustic-ratio", { HOME: home });

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("ACOUSTIC_ARTIFACT");
  expect(result.stderr).toContain("host-glitch");
  expect(result.stderr).toContain("DURATION_WORD_SIBLING_RATIO");
  expect(result.stderr).toContain("--resynth-scene host-glitch");
  expect(result.stderr).toContain("--no-cache");
  expect(result.stderr).toContain("CACHE_PURGE segment=host-glitch status=PURGED");
  expect(existsSync(poisonedPath)).toBe(false);
  const receipts = JSON.parse(readFileSync(outputPath.replace(/\.html$/, ".receipts.json"), "utf8"));
  expect(receipts.gates.map((row) => `${row.gate}:${row.verdict}`)).toEqual([
    "voice-role:PASS",
    "transcript-fidelity:PASS",
    "acoustic:REJECT",
  ]);
  expect(receipts.purges).toHaveLength(1);
  expect(receipts.purges[0]).toMatchObject({
    cacheKey: cacheFixture.cacheKey,
    segment: "host-glitch",
    reason: "acoustic-gate REJECT",
  });
});

test("BYO acoustic rejection preserves a stale TTS take and requires source replacement", () => {
  const root = mkdtempSync(path.join(tmpdir(), "audio-dashboard-acoustic-byo-"));
  const jobDir = path.join(root, "job");
  const scenes = [
    writeAcousticSegment(jobDir, "host-a", { seconds: 4, words: 10, role: "host" }),
    writeAcousticSegment(jobDir, "host-b", { seconds: 4.2, words: 10, role: "host" }),
    {
      ...writeAcousticSegment(jobDir, "host-byo-glitch", { seconds: 5.6, words: 10, role: "host" }),
      audioWav: "host-byo-source.wav",
    },
  ];
  const staleCacheKey = "d".repeat(64);
  const home = path.join(root, "home");
  const cacheDir = path.join(home, ".narrationlayer", "tts-cache");
  mkdirSync(cacheDir, { recursive: true });
  const unrelatedTtsTake = path.join(cacheDir, `${staleCacheKey}.wav`);
  writeFileSync(unrelatedTtsTake, "unrelated prior TTS take");
  writeFileSync(
    path.join(jobDir, "segments", "host-byo-glitch", "host-byo-glitch.wav.cache.json"),
    `${JSON.stringify({ version: 1, cacheKey: staleCacheKey }, null, 2)}\n`,
  );

  const { result, outputPath } = buildDashboard({
    id: "acoustic-byo",
    title: "Acoustic BYO",
    scenes,
  }, jobDir, "acoustic-byo", { HOME: home });

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("ACOUSTIC_ARTIFACT");
  expect(result.stderr).toContain("DURATION_WORD_SIBLING_RATIO");
  expect(result.stderr).toContain("Replace or edit the scene audioWav source for host-byo-glitch");
  expect(result.stderr).not.toContain("--resynth-scene host-byo-glitch --no-cache");
  expect(result.stderr).toContain("CACHE_PURGE segment=host-byo-glitch status=SKIP");
  expect(result.stderr).not.toContain("CACHE_PURGE segment=host-byo-glitch status=PURGED");
  expect(existsSync(unrelatedTtsTake)).toBe(true);

  const receipts = JSON.parse(readFileSync(outputPath.replace(/\.html$/, ".receipts.json"), "utf8"));
  const acousticRow = receipts.gates.at(-1);
  expect(acousticRow).toMatchObject({ gate: "acoustic", stage: "BUILD", verdict: "REJECT" });
  expect(acousticRow.runbook).toContain("Replace or edit the scene audioWav source for host-byo-glitch");
  expect(acousticRow.runbook).not.toContain("--no-cache");
  expect(receipts.purges).toEqual([]);
});
