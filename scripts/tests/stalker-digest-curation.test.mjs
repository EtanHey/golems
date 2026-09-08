import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { curateDigest } from "../stalker-digest-curation.mjs";

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function candidates() {
  const topics = Array.from({ length: 20 }, (_, index) => ({
    timestamp: `${index * 10}:00`, title: `Topic ${index}`, summary: `Full topic summary ${index}`,
    excerpt: `Exact topic evidence ${index}`, uncertain: false,
  }));
  const highlights = Array.from({ length: 12 }, (_, index) => ({
    timestamp: `${index * 17}:00`, title: `Highlight ${index}`, summary: `Full highlight summary ${index}`,
    excerpt: `Exact highlight evidence ${index}`, uncertain: false, importance: 10 - (index % 5),
  }));
  const claims = Array.from({ length: 6 }, (_, index) => ({
    timestamp: `${index * 30}:00`, claim: `Full checkable claim ${index}`,
    excerpt: `Exact claim evidence ${index}`, uncertain: false,
  }));
  return { topics, highlights, claims };
}

async function runSelection(name, selection, values = candidates(), timeline) {
  const workDir = join(process.cwd(), `.test-stalker-digest-curation-${process.pid}-${name}`);
  roots.push(workDir);
  await mkdir(workDir, { recursive: true });
  let request;
  const summary = await curateDigest({
    candidates: values,
    workDir,
    timeline,
    generateImpl: async (value) => {
      request = value;
      await writeFile(value.outputPath, JSON.stringify(selection));
    },
  });
  return { summary, request, values };
}

const validSelection = {
  topicIndexes: [19, 0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 15],
  highlightIndexes: [9, 0, 3, 6, 11],
  claimIndexes: [5, 1],
};

test("selects only original objects, orders them chronologically, and uses the fixed model contract", async () => {
  const { summary, request, values } = await runSelection("valid", validSelection);
  assert.equal(request.model, "gpt-5.6-sol");
  assert.equal(request.reasoningEffort, "medium");
  assert.equal(request.timeoutMs, 180_000);
  assert.match(request.diagnosticLabel, /^human-digest-curation$/);
  assert.deepEqual(summary.topics, [...validSelection.topicIndexes].sort((a, b) => a - b).map((index) => values.topics[index]));
  assert.deepEqual(summary.claims, [values.claims[1], values.claims[5]]);
  const { importance: _importance, ...expectedHighlight } = values.highlights[0];
  assert.deepEqual(summary.highlights[0], expectedHighlight);
  assert.equal("importance" in summary.highlights[0], false);
  assert.doesNotMatch(request.input, /Exact topic evidence|Exact highlight evidence|Exact claim evidence/);
});

test("rejects duplicate and out-of-range indexes", async () => {
  await assert.rejects(runSelection("duplicate", {
    ...validSelection, topicIndexes: [0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 15],
  }), /topicIndexes must contain unique indexes/);
  await assert.rejects(runSelection("range", {
    ...validSelection, highlightIndexes: [0, 3, 6, 9, 99],
  }), /highlightIndexes index 99 is out of range/);
});

test("requires broad temporal coverage for a long recording", async () => {
  await assert.rejects(runSelection("highlight-distribution", {
    ...validSelection, highlightIndexes: [0, 1, 2, 3, 4],
  }), /highlights must cover at least 3 temporal quarters/);
  await assert.rejects(runSelection("topic-distribution", {
    ...validSelection, topicIndexes: Array.from({ length: 12 }, (_, index) => index),
  }), /topics must cover every available temporal quarter/);
});

test("derives the default timeline from all candidate collections, including a long highlight tail", async () => {
  const values = candidates();
  values.highlights.forEach((item, index) => { item.timestamp = `${index * 30}:00`; });
  await assert.rejects(runSelection("long-tail", {
    ...validSelection, highlightIndexes: [0, 1, 2, 3, 4],
  }, values), /highlights must cover at least 3 temporal quarters/);
});

test("uses explicit whole-recording bounds when topic anchors sit inward from both ends", async () => {
  const values = candidates();
  values.topics.forEach((item, index) => { item.timestamp = `${100 + index * 20}:00`; });
  await assert.rejects(runSelection("inward-topic-anchors", {
    ...validSelection,
    topicIndexes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 17],
  }, values, { startSeconds: 0, endSeconds: 600 * 60 }), /topics must cover every available temporal quarter/);
});

test("recursively curates oversized chronological halves sequentially with unique bounded calls", async () => {
  const total = 600;
  const values = {
    topics: Array.from({ length: total }, (_, index) => ({
      timestamp: `${index}:00`, title: `TopicMarker-${index}`, summary: "t".repeat(400),
      excerpt: `topic evidence ${index}`, uncertain: false,
    })),
    highlights: Array.from({ length: total }, (_, index) => ({
      timestamp: `${index}:00`, title: `HighlightMarker-${index}`, summary: "h".repeat(400),
      excerpt: `highlight evidence ${index}`, uncertain: false, importance: 10,
    })),
    claims: Array.from({ length: total }, (_, index) => ({
      timestamp: `${index}:00`, claim: `ClaimMarker-${index} ${"c".repeat(400)}`,
      excerpt: `claim evidence ${index}`, uncertain: false,
    })),
  };
  const root = join(process.cwd(), `.test-stalker-digest-curation-${process.pid}-oversize`);
  roots.push(root);
  const calls = [];
  const seenMarkers = new Set();
  let active = 0;
  let maxActive = 0;
  const evenly = (length, count) => Array.from({ length: Math.min(length, count) }, (_, index) => (
    Math.round((index * (length - 1)) / Math.max(1, Math.min(length, count) - 1))
  ));
  const summary = await curateDigest({
    candidates: values,
    workDir: root,
    timeline: { startSeconds: 0, endSeconds: (total - 1) * 60 },
    generateImpl: async ({ input, outputPath, diagnosticLabel }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      calls.push({ diagnosticLabel, bytes: Buffer.byteLength(input) });
      const source = JSON.parse(input.slice(input.indexOf('{"topics"')));
      for (const tuple of source.topics) seenMarkers.add(tuple[2]);
      for (const tuple of source.highlights) seenMarkers.add(tuple[3]);
      for (const tuple of source.claims) seenMarkers.add(tuple[2].split(" ")[0]);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      await writeFile(outputPath, JSON.stringify({
        topicIndexes: evenly(source.topics.length, 18),
        highlightIndexes: evenly(source.highlights.length, 10),
        claimIndexes: [],
      }));
    },
  });
  assert.ok(calls.length > 1);
  assert.equal(maxActive, 1);
  assert.equal(new Set(calls.map(({ diagnosticLabel }) => diagnosticLabel)).size, calls.length);
  assert.ok(calls.every(({ bytes }) => bytes <= 96 * 1024));
  assert.equal(seenMarkers.size, total * 3);
  assert.equal(summary.topics.length, 18);
  assert.equal(summary.highlights.length, 10);
});
