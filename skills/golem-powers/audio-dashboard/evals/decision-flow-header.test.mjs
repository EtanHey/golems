// Header contract: a phone-short heading, with status collapsed under a Details disclosure.
import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { boot, scene, DEFAULT_DECISIONS } from "./decision-flow-harness.mjs";

import { renderDecisionFlow } from "../src/decision-flow.mjs";

const SCOPE = "Answers save only for this dashboard on this device.";

function render(extra = {}) {
  const html = renderDecisionFlow({ heading: "Two calls", scenes: [scene("a1"), scene("a2"), scene("b1")], decisions: DEFAULT_DECISIONS, ...extra });
  const window = new Window(); window.document.write(html);
  return { html, document: window.document };
}

test("subtitle renders escaped inside the header's Details disclosure", () => {
  const { html, document } = render({ subtitle: "<script>alert(1)</script> & status" });
  const details = document.querySelector(".df-top details.df-context");
  expect(details).not.toBeNull();
  expect(details.open).toBe(false);
  expect(details.querySelector("summary").textContent.trim()).toBe("Details");
  expect(details.querySelector(".df-subtitle").textContent).toBe("<script>alert(1)</script> & status");
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; status");
  expect(details.querySelector("script")).toBeNull();
  expect(details.querySelector(".df-scope").textContent).toBe(SCOPE);
});

test("an absent or empty subtitle still renders a valid disclosure with the scope note", () => {
  for (const subtitle of [undefined, ""]) {
    const { document } = render({ subtitle });
    const details = document.querySelector(".df-top details.df-context");
    expect(details.firstElementChild.tagName).toBe("SUMMARY");
    expect(details.querySelector(".df-subtitle")).toBeNull();
    expect(details.querySelector(".df-scope").textContent).toBe(SCOPE);
  }
});

test("no header template slot leaks into the output", () => {
  for (const subtitle of [undefined, "Status line"]) {
    const { html } = render({ subtitle });
    expect(html).not.toContain("{{SUBTITLE}}");
    expect(html).not.toContain("{{CONTEXT}}");
    expect(html).not.toMatch(/\{\{[A-Z_]+\}\}/);
  }
});

test("storage error stays outside the disclosure and is announced", () => {
  const { document } = boot({ storageError: () => true });
  const state = document.getElementById("df-storage-state");
  expect(state.closest("details")).toBeNull();
  expect(state.getAttribute("aria-live")).toBe("polite");
  document.querySelector(".df-option input").click();
  expect(state.classList.contains("is-error")).toBe(true);
  expect(state.textContent).toContain("Storage unavailable");
});
