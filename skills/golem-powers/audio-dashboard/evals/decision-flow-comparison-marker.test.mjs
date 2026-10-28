import { expect, test } from "bun:test";
import { COMPARISON_READY_META, hasComparisonReadyMarker, markComparisonReady } from "../src/decision-flow.mjs";

// ADX-2c review r2 (B3): the build-time marker check must see real elements, as the browser does, not
// marker-shaped text in comments, raw text, attribute values or look-alike attributes.
export const FAKE_MARKERS = {
  "commented meta": '<!doctype html><html><head>\n<!-- <meta name="adash-comparison" content="ready"> -->\n</head><body><h1>404</h1></body></html>',
  "commented html attribute": '<!doctype html><!-- <html data-adash-comparison="ready"> --><html><head></head><body><h1>404</h1></body></html>',
  "textarea text": '<!doctype html><html><head></head><body><textarea><meta name="adash-comparison" content="ready"></textarea></body></html>',
  "attribute value": `<!doctype html><html><head></head><body><div title='<meta name="adash-comparison" content="ready">'>404</div></body></html>`,
  "data- look-alikes": '<!doctype html><html><head><meta data-name="adash-comparison" data-content="ready"></head><body>404</body></html>',
};
const REAL_MARKERS = {
  "meta in head": `<!doctype html><html><head>${COMPARISON_READY_META}</head><body><svg></svg></body></html>`,
  "meta in implicit head": `<!doctype html>${COMPARISON_READY_META}<svg></svg>`,
  "attribute order and quotes": "<!doctype html><html><head><meta content=ready name='adash-comparison'></head><body></body></html>",
  "html attribute": '<!doctype html><html lang="en" data-adash-comparison="ready"><body><canvas></canvas></body></html>',
};

test("marker-shaped text is not a marker", () => {
  for (const [name, page] of Object.entries(FAKE_MARKERS)) expect([name, hasComparisonReadyMarker(page)]).toEqual([name, false]);
});

test("real meta and html markers are recognised", () => {
  for (const [name, page] of Object.entries(REAL_MARKERS)) expect([name, hasComparisonReadyMarker(page)]).toEqual([name, true]);
});

test("only the first adash-comparison meta in the head counts, as in the browser", () => {
  expect(hasComparisonReadyMarker('<html><head><meta name="adash-comparison" content="pending"><meta name="adash-comparison" content="ready"></head></html>')).toBe(false);
  expect(hasComparisonReadyMarker(`<html><head></head><body><h1>404</h1>${COMPARISON_READY_META}</body></html>`)).toBe(false);
  expect(hasComparisonReadyMarker(`<!doctype html><h1>404</h1>${COMPARISON_READY_META}`)).toBe(false);
  expect(hasComparisonReadyMarker('<html><head></head><body><div data-adash-comparison="ready"></div></body></html>')).toBe(false);
});

test("markComparisonReady adds a real marker next to a fake one and is idempotent", () => {
  for (const [name, page] of Object.entries(FAKE_MARKERS)) {
    const marked = markComparisonReady(page);
    expect([name, hasComparisonReadyMarker(marked)]).toEqual([name, true]);
    expect([name, markComparisonReady(marked)]).toEqual([name, marked]);
  }
  for (const [name, page] of Object.entries(REAL_MARKERS)) expect([name, markComparisonReady(page)]).toEqual([name, page]);
  expect(markComparisonReady("<!doctype html><html><head><title>x</title></head></html>")).toBe(`<!doctype html><html><head>${COMPARISON_READY_META}<title>x</title></head></html>`);
  expect(markComparisonReady("<!doctype html><svg></svg>")).toBe(`<!doctype html>${COMPARISON_READY_META}<svg></svg>`);
});
