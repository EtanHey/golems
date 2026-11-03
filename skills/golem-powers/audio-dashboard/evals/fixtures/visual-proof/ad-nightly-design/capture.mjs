#!/usr/bin/env node
// Visual proof for the nightly decisions-first design pass. Synthetic content only: no private nightly cards.
// Usage: node capture.mjs <path-to-src/decision-flow.mjs> <before|after> <out-dir>
// Renders one synthetic five-card spec (two open questions with options, a copy-block command, a checklist,
// a free-text question, and a reply appended as the last card) at 1280x900 and 390x844 in Chromium.
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const [, , renderer, label, outDir] = process.argv;
if (!renderer || !["before", "after"].includes(label) || !outDir) {
  console.error("usage: node capture.mjs <src/decision-flow.mjs> <before|after> <out-dir>");
  process.exit(2);
}
const { renderDecisionFlow } = await import(path.resolve(renderer));

const timed = (text) => text.split(/\s+/).map((word, index) => ({ word, start: index * 0.32, end: index * 0.32 + 0.26 }));
function scene(id, title, script, role, speaker) {
  const words = timed(script);
  // Stub media: layout proof only. No audio is generated or played.
  return { id, title, script, role, speaker, duration: Math.ceil(words.at(-1).end + 0.4), audioUrl: "data:audio/mpeg;base64,SUQz", words };
}
const LONG_URL = "https://example.com/reports/2026/11/nightly/synthetic-release-lane-comparison-with-a-long-unbroken-slug-for-wrapping?view=full";
const spec = {
  id: "synthetic-nightly",
  title: "Synthetic nightly decisions",
  kicker: "Nightly · synthetic fixture",
  heading: "Three calls before morning",
  subtitle: "Synthetic content for layout review.",
  storageKey: "dbx:synthetic-nightly",
  cinemaUrl: "./synthetic-nightly-audio.html",
  scenes: [
    scene("lane-q", "Question", "Which release lane should tonight's build take, the steady lane or the fast lane?", "host", "host"),
    scene("lane-a", "Trade-off", "The steady lane waits for the full suite and lands tomorrow morning. The fast lane ships tonight but skips the long browser checks.", "expert", "guide"),
    scene("clean-q", "Question", "Should the worker run the cache cleanup now or leave it for the weekend?", "host", "host"),
    scene("clean-a", "Trade-off", "Running it now frees disk space before the next batch. The exact command is on the card so you can paste it yourself.", "expert", "guide"),
    scene("checks-a", "Checklist", "Before you sleep, tick the three checks that matter most for tomorrow.", "expert", "guide"),
    scene("name-a", "Open question", "What should the new morning summary be called? A short phrase is enough.", "expert", "guide"),
    scene("reply-a", "Reply", "You asked whether the fast lane can be undone. Yes. A single revert restores the steady build.", "expert", "guide"),
  ],
  decisions: [
    { id: "release-lane", rank: 1, title: "Pick tonight's release lane", status: "OPEN", sceneIds: ["lane-q", "lane-a"],
      summary: "Steady waits for the full suite; fast ships tonight without the long browser checks.",
      body: `The full comparison is in the [release notes draft](https://example.com/notes/release-lane). Evidence: ${LONG_URL}\nPick one lane, or write your own condition below.`,
      options: [{ label: "Steady lane", summary: "Lands tomorrow after the full suite." }, { label: "Fast lane", summary: "Ships tonight, skips long browser checks." }],
      rail: [{ label: "Owner", value: "Release worker" }, { label: "PR", value: "#12", href: "https://github.com/example/demo/pull/12" }] },
    { id: "cache-cleanup", rank: 2, title: "Run the cache cleanup now?", status: "OPEN", sceneIds: ["clean-q", "clean-a"],
      body: "It is safe to repeat. To run it yourself, paste this:\n```bash\nbun run cache:prune --older-than 7d\nbun run cache:report\n```\nOtherwise pick an option.",
      options: ["Run it now", "Leave it for the weekend"] },
    { id: "morning-checks", rank: 3, title: "Morning checks", status: "OPEN", sceneIds: ["checks-a"], body: "Tick what you have confirmed.",
      checklist: [{ title: "Before sleep", items: ["Tonight's build is green", "No reader-facing copy changed"] }, "Tomorrow's first card is the release lane"] },
    { id: "summary-name", rank: 4, title: "Name the morning summary", status: "OPEN", sceneIds: ["name-a"], body: "Any short phrase. No options on purpose.", options: [] },
    { id: "reply-fast-lane-undo", rank: 5, title: "Reply: can the fast lane be undone?", status: "REPLY", sceneIds: ["reply-a"],
      body: "Answering your note on card 1. A single revert restores the steady build; saved answers are untouched.",
      options: ["Thanks, that settles it", "Still unsure"] },
  ],
};

mkdirSync(outDir, { recursive: true });
const html = renderDecisionFlow(spec);
const file = path.join(outDir, `${label}.html`);
writeFileSync(file, html);
const shot = (name) => path.join(outDir, `${name}-${label}.png`);
const browser = await chromium.launch();
const receipt = { label, htmlSha256: createHash("sha256").update(html).digest("hex"), viewports: {} };
try {
  for (const [width, height] of [[1280, 900], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, reducedMotion: "reduce" });
    await page.goto(`file://${path.resolve(file)}`);
    await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
    // One saved note on card 1 through the real dialog, so the note-count state is visible and named.
    await page.click("#decision-release-lane .df-card-note");
    await page.fill("#df-note-text", "Synthetic note");
    await page.click("#df-note-save");
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
    await page.screenshot({ path: shot(`decision-flow-${width}-top`) });
    // Card crops hide only the sticky controller and fixed dock, which would otherwise overlap the cropped card.
    const chrome = await page.addStyleTag({ content: ".df-controller,.df-dock{visibility:hidden!important}" });
    for (const [name, id] of [["copy", "cache-cleanup"], ["reply", "reply-fast-lane-undo"]]) {
      await page.locator(`#decision-${id}`).screenshot({ path: shot(`decision-flow-${width}-${name}-card`) });
    }
    await chrome.evaluate((node) => node.remove());
    receipt.viewports[width] = await page.evaluate(() => {
      const card = document.querySelector("#decision-release-lane").getBoundingClientRect();
      const text = getComputedStyle(document.querySelector(".df-question p")).color;
      const copy = document.querySelector("#decision-cache-cleanup [data-copy-block]"), box = copy.getBoundingClientRect();
      const hit = (x, y) => document.elementFromPoint(x, y) === copy;
      copy.scrollIntoView({ block: "center" });
      const b = copy.getBoundingClientRect();
      return {
        pageOverflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        proseLinksOutsideCard: [...document.querySelectorAll("#decision-release-lane .df-question a")].filter((a) => [...a.getClientRects()].some((r) => r.right > card.right + 0.5)).length,
        proseLinkColour: getComputedStyle(document.querySelector(".df-question a")).color, proseTextColour: text,
        noteButtonNames: [...document.querySelectorAll(".df-card-note")].map((button) => button.getAttribute("aria-label")),
        copyButtonPx: `${Math.round(box.width)}x${Math.round(box.height)}`,
        copyPressTargetPx: `${[...Array(Math.ceil(b.height) + 24).keys()].filter((d) => hit(b.left + b.width / 2, b.top - 12 + d + 0.5)).length}px tall at centre`,
        replyStatus: (() => { const s = document.querySelector('[data-status="reply"]'); const cs = getComputedStyle(s); return `${s.textContent} ${cs.color} radius=${cs.borderRadius}`; })(),
        cardIds: [...document.querySelectorAll(".df-card")].map((c) => c.id),
        answerInputs: document.querySelectorAll(".df-card input, .df-card textarea.note-area").length,
        playerControls: document.querySelectorAll(".df-play, .df-restart, #df-transport-play, #df-speed").length,
      };
    });
    if (width === 390) {
      // Keyboard: Tab from the top through card 1, capturing each focus stop for the GIF.
      // Reload so Tab starts at the document start; the saved note persists in the device-only fallback.
      await page.reload();
      await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
      const stops = [];
      for (let index = 0; index < 18; index += 1) {
        await page.keyboard.press("Tab");
        const stop = await page.evaluate(() => { const el = document.activeElement, r = el.getBoundingClientRect(), cs = getComputedStyle(el); return { name: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().replace(/\s+/g, " ").slice(0, 60), ring: cs.outlineStyle !== "none" || cs.boxShadow !== "none", inView: r.top >= 0 && r.bottom <= innerHeight }; });
        stops.push(stop);
        await page.screenshot({ path: path.join(outDir, `kbd-${label}-${String(index).padStart(2, "0")}.png`) });
      }
      receipt.viewports[width].keyboard = stops;
    }
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
    await page.screenshot({ path: shot(`decision-flow-${width}-full`), fullPage: true, scale: "css" });
    await page.close();
  }
} finally {
  await browser.close();
}
writeFileSync(path.join(outDir, `receipt-${label}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt, null, 2));
