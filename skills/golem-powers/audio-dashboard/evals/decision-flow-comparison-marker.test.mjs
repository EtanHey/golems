import { expect, test } from "bun:test";
import { COMPARISON_READY_META, hasComparisonReadyMarker, markComparisonReady } from "../src/decision-flow.mjs";
import { CANONICAL, REJECTED } from "./fixtures/comparison-markers/specimens.mjs";

// ADX-2d review r1: the build accepts only the canonical form (the marker as the first child of an explicit
// <head>, or data-adash-comparison="ready" on the leading <html> start tag). No head parsing is emulated.
test("only canonical markers are accepted", () => {
  for (const [name, page] of Object.entries(CANONICAL)) expect([name, hasComparisonReadyMarker(page)]).toEqual([name, true]);
  for (const [name, page] of Object.entries(REJECTED)) expect([name, hasComparisonReadyMarker(page)]).toEqual([name, false]);
});

test("markComparisonReady always yields a canonical page, keeps every byte, and is idempotent", () => {
  for (const [name, page] of Object.entries(CANONICAL)) expect([name, markComparisonReady(page)]).toEqual([name, page]);
  for (const [name, page] of Object.entries(REJECTED)) {
    const marked = markComparisonReady(page);
    expect([name, hasComparisonReadyMarker(marked)]).toEqual([name, true]);
    expect([name, markComparisonReady(marked)]).toEqual([name, marked]);
    // Insert only: deleting the inserted text gives back the original page.
    const inserted = marked.length - page.length;
    const at = [...marked].findIndex((character, index) => character !== page[index]);
    expect([name, marked.slice(0, at) + marked.slice(at + inserted)]).toEqual([name, page]);
  }
});

test("the marker goes right after the head start tag, creating head or html only when missing", () => {
  expect(markComparisonReady("<!doctype html><html><head><title>x</title></head></html>")).toBe(`<!doctype html><html><head>${COMPARISON_READY_META}<title>x</title></head></html>`);
  expect(markComparisonReady('<!doctype html><html lang="en"><body>x</body></html>')).toBe(`<!doctype html><html lang="en"><head>${COMPARISON_READY_META}</head><body>x</body></html>`);
  expect(markComparisonReady("<!doctype html><svg></svg>")).toBe(`<!doctype html><html><head>${COMPARISON_READY_META}</head><svg></svg>`);
});
