// Real-layout checks in headless Chromium. Skips (loudly) where Playwright/Chromium is unavailable.
import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { renderDecisionFlow } from "../src/decision-flow.mjs";

let chromium = null;
try {
  ({ chromium } = await import("playwright"));
  const probe = await chromium.launch();
  await probe.close();
} catch (error) {
  console.warn(`decision-flow layout tests skipped: ${error?.message?.split("\n")[0]}`);
  chromium = null;
}
const layoutTest = chromium ? test : test.skip;

function scene(id) {
  const words = "one two three four five six seven eight nine ten".split(" ");
  return {
    id, title: `Scene ${id}`, script: words.join(" "), duration: 2, audioUrl: "data:audio/mpeg;base64,SUQz",
    words: words.map((word, index) => ({ word, start: index * 0.15, end: index * 0.15 + 0.1 })),
  };
}

function fixture(ids = ["v00", "d00", "d01", "d02", "d03", "d04", "d05", "d06"], extra = {}) {
  const html = renderDecisionFlow({
    ...extra,
    storageKey: "dbx:layout-test",
    heading: "Check the new VoiceBar first, then 25 calls to make.",
    scenes: ids.map(scene),
    decisions: ids.map((id, index) => ({
      id, rank: index === 0 ? "✓" : index - 1, title: index === 0 ? "Check VoiceBar 2.2.57" : `Pristine sprints with new leads ${index}`,
      options: ["A. Keep going", "B. Stop"], sceneIds: [id],
      body: "A written briefing to cite while deciding.",
      ...(index === 0 ? { checklist: [{ title: "Fixed", items: ["History row", "Pauses"] }] } : {}),
    })),
  });
  const dir = mkdtempSync(path.join(tmpdir(), "decision-flow-layout-"));
  const file = path.join(dir, "dashboard.html");
  writeFileSync(file, html);
  return `file://${file}`;
}

async function waitForScrollSettle(page) {
  await page.evaluate(() => new Promise(resolve => { let y = scrollY, since = performance.now(); function poll(now) { if (scrollY !== y) { y = scrollY; since = now; } if (now - since >= 200) resolve(); else requestAnimationFrame(poll); } requestAnimationFrame(poll); }));
}

layoutTest("header Details summary is a 44px target that never overlaps the heading or mode label", async () => {
  const browser = await chromium.launch(), failures = [];
  try { for (const width of [360, 390, 1280]) for (const cinemaUrl of [undefined, "./layout-test-audio.html"]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: "reduce" });
    await page.goto(fixture(undefined, { subtitle: "Status: 3 merged, 2 waiting on review, storage healthy.", cinemaUrl }));
    const box = selector => page.locator(selector).first().boundingBox();
    const summary = await box(".df-context > summary");
    if (summary.width < 44 || summary.height < 44) failures.push({ width, summary });
    if (cinemaUrl) {
      expect(await page.locator(".df-cinema-link").isVisible()).toBe(true);
      // The link wraps as one unit, never split across lines.
      if ((await page.locator(".df-cinema-link").evaluate(node => node.getClientRects().length)) !== 1) failures.push({ width, split: ".df-cinema-link" });
    }
    for (const selector of [".df-top h1", ".df-mode-label", ".df-kicker", ...(cinemaUrl ? [".df-cinema-link"] : [])]) {
      // Rendered text rects, not element boxes: the header text reserves room for the summary with padding.
      const lines = await page.locator(selector).first().evaluate(node => { const range = document.createRange(); range.selectNodeContents(node); return [...range.getClientRects()].map(r => ({ x: r.x, y: r.y, width: r.width, height: r.height })); });
      for (const other of lines) if (summary.x < other.x + other.width && other.x < summary.x + summary.width && summary.y < other.y + other.height && other.y < summary.y + summary.height) failures.push({ width, selector, summary, other });
    }
    expect(await page.locator(".df-subtitle").isVisible()).toBe(false);
    await page.locator(".df-context > summary").focus(); await page.keyboard.press("Enter");
    expect(await page.locator(".df-subtitle").isVisible()).toBe(true);
    expect(await page.locator(".df-scope").isVisible()).toBe(true);
    await page.close();
  } } finally { await browser.close(); }
  expect(failures).toEqual([]);
}, 30000);

layoutTest("page heading outranks card titles and, on desktop, shares the sidebar's top line", async () => {
  const browser = await chromium.launch(), failures = [];
  try { for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: "reduce" }); await page.goto(fixture());
    const size = selector => page.locator(selector).first().evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    const h1 = await size(".df-top h1"), card = await size(".df-card .df-title");
    if (h1 < card * 1.12) failures.push({ width, h1, card });
    if (width === 1280) {
      const kicker = await page.locator(".df-kicker").boundingBox(), first = await page.locator(".df-index a, .df-index li").first().boundingBox();
      if (Math.abs(kicker.y - first.y) > 1) failures.push({ width, kickerTop: kicker.y, sidebarTop: first.y });
    }
    await page.close();
  } } finally { await browser.close(); }
  expect(failures).toEqual([]);
}, 30000);

layoutTest("storage state is visually hidden until it reports an error", async () => {
  const browser = await chromium.launch();
  try { const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); await page.goto(fixture());
    const size = () => page.locator("#df-storage-state").evaluate(node => { const r = node.getBoundingClientRect(); return r.width * r.height; });
    expect(await size()).toBeLessThanOrEqual(1);
    await page.evaluate(() => { const node = document.getElementById("df-storage-state"); node.textContent = "Storage unavailable · use Copy answers"; node.classList.add("is-error"); });
    expect(await size()).toBeGreaterThan(100);
    expect(await page.locator("#df-storage-state").isVisible()).toBe(true);
  } finally { await browser.close(); }
});

const TRANSPORT_LABELS = [["▶", "Play"], ["⏸", "Pause"], ["▶", "Resume"], ["↻", "Again"]];

layoutTest("review: a real mouse drag between interior words offers Cite without seeking", async () => {
  const browser = await chromium.launch();
  try { for (const width of [390, 1280]) for (const view of ["list", "story"]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" }); await page.goto(fixture()); await page.click("#df-view-toggle");
    if (view === "list") { await page.click("#df-story-exit"); await page.locator('[data-chip-for="d00"]').click(); await page.locator('[data-decision="d00"] .df-play').click(); await page.locator('[data-decision="d00"] .df-teleprompter').evaluate(node => node.scrollIntoView({ block: "center" })); }
    // Scrolling can change the active navigation card; drag the transcript we opened.
    const card = page.locator(`[data-decision="${view === "list" ? "d00" : "v00"}"]`);
    const words = card.locator(".df-words").first().locator(".df-word");
    const audio = card.locator("audio").first();
    const beforeTime = await audio.evaluate(node => node.currentTime);
    const start = await words.nth(4).boundingBox(), end = await words.nth(7).boundingBox();
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2); await page.mouse.down();
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 12 }); await page.mouse.up();
    const selected = await page.evaluate(() => getSelection().toString()); expect(selected).toContain("six seven");
    expect(await page.locator("#df-cite").isVisible()).toBe(true);
    expect(await audio.evaluate(node => node.paused)).toBe(true);
    expect(await audio.evaluate(node => node.currentTime)).toBe(beforeTime);
    await page.click("#df-cite"); expect(await page.textContent("#df-note-quote")).toBe(selected.trim()); await page.close();
  } } finally { await browser.close(); }
}, 60000);

layoutTest("touch Cite reserves its space without moving controls and transport targets stay 44px", async () => {
  const browser = await chromium.launch({ args: ["--mute-audio"] }), failures = [];
  try { for (const width of [360, 390, 1280]) for (const view of ["list", "story"]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" }); await page.goto(fixture());
    if (view === "story") await page.locator("#df-view-toggle").tap();
    const geometry = () => page.evaluate(() => Object.fromEntries(["df-transport-prev", "df-transport-play", "df-transport-next", "df-transport-stop", "df-speed", "df-view-toggle"].map(id => document.getElementById(id)).filter(node => node.getClientRects().length).map(node => { const r = node.getBoundingClientRect(); return [node.id, { x: r.x, y: r.y, width: r.width, height: r.height }]; })));
    const before = await geometry();
    await page.locator(view === "story" ? ".df-card.is-active .df-words" : ".df-card.is-active .df-question p").first().evaluate(node => { const range = document.createRange(); range.selectNodeContents(node); getSelection().removeAllRanges(); getSelection().addRange(range); });
    await page.locator("#df-controller-cite").waitFor({ state: "visible" }); const selected = await geometry();
    await page.evaluate(() => getSelection().removeAllRanges()); await page.locator("#df-controller-cite").waitFor({ state: "hidden" }); const cleared = await geometry();
    for (const [id, rect] of Object.entries(before)) {
      if (["df-transport-prev", "df-transport-next"].includes(id) && (rect.width < 44 || rect.height < 44)) failures.push({ width, view, id, target: rect });
      for (const [phase, boxes] of [["selected", selected], ["cleared", cleared]]) if (Object.keys(rect).some(key => Math.abs(rect[key] - boxes[id][key]) > 0.25)) failures.push({ width, view, id, phase, before: rect, after: boxes[id] });
    }
    await page.close();
  } } finally { await browser.close(); }
  expect(failures).toEqual([]);
}, 30000);

layoutTest("review: transcript accessibility text preserves spaces between words", async () => {
  const browser = await chromium.launch();
  try { const page = await browser.newPage(); await page.goto(fixture()); await page.click("#df-view-toggle");
    expect(await page.locator(".df-card.is-active .df-words").first().ariaSnapshot()).toContain("one two three four five six seven eight nine ten");
  } finally { await browser.close(); }
});

layoutTest("touch selection offers reachable Cite in the controller or modal sheet", async () => {
  const browser = await chromium.launch({ args: ["--mute-audio"] });
  try { for (const width of [360, 390, 1280]) for (const view of ["list", "story", "sheet"]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" }); await page.goto(fixture());
    for (const selector of [".df-card-note", ".df-item-note"]) { const box = await page.locator(selector).first().boundingBox(); expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44); }
    if (view !== "list") await page.locator("#df-view-toggle").tap();
    if (view === "sheet") await page.locator(".df-card.is-active .df-answer-open").tap();
    const selected = await page.locator(view === "story" ? ".df-card.is-active .df-words" : view === "sheet" ? ".df-sheet.is-open .df-question p" : ".df-card.is-active .df-question p").first().evaluate(node => { const range = document.createRange(); range.selectNodeContents(node); getSelection().removeAllRanges(); getSelection().addRange(range); return getSelection().toString().trim(); });
    const cite = page.locator("#df-controller-cite"); await cite.waitFor({ state: "visible" }); expect(await page.locator("#df-speed").evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16); expect(await page.locator("#df-cite").isVisible()).toBe(false);
    const box = await cite.boundingBox(); expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
    if (view === "sheet") expect(await cite.evaluate(node => Boolean(node.closest(".df-sheet-head")))).toBe(true);
    else { expect(await cite.evaluate(node => node.previousElementSibling.id)).toBe("df-transport-next"); expect(await page.locator(".df-transport").evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true); }
    await cite.tap(); expect(await page.textContent("#df-note-quote")).toBe(selected); await page.locator("#df-note-cancel").tap();
    if (view === "sheet") expect(await page.locator(".df-sheet-done").first().evaluate(node => node === document.activeElement)).toBe(true);
    await page.close();
  } } finally { await browser.close(); }
}, 60000);

layoutTest("card heading names exclude answer status", async () => {
  const browser = await chromium.launch();
  try { const page = await browser.newPage(); await page.goto(fixture());
    expect(await page.getByRole("heading", { level: 2, name: "Check VoiceBar 2.2.57", exact: true }).count()).toBe(1);
  } finally { await browser.close(); }
});

layoutTest("review: note modal animates open and closed, and reduced motion disables it", async () => {
  const browser = await chromium.launch();
  try { const page = await browser.newPage({ reducedMotion: "no-preference" }); await page.goto(fixture()); await page.locator(".df-card-note").first().click();
    const animations = () => page.evaluate(() => document.getElementById("df-note-dialog").getAnimations().map(animation => animation.transitionProperty));
    expect(await animations()).toContain("opacity"); await page.locator("#df-note-dialog").evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished))); await page.keyboard.press("Escape"); expect(await animations()).toContain("opacity");
    await page.emulateMedia({ reducedMotion: "reduce" }); await page.locator(".df-card-note").first().click(); expect(await animations()).toEqual([]);
  } finally { await browser.close(); }
}, 15000);

layoutTest("review: new buttons have press feedback and touch does not gain sticky hover", async () => {
  const browser = await chromium.launch();
  try { const page = await browser.newPage({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" }); await page.goto(fixture());
    const button = page.locator(".df-card-note").first(), color = await button.evaluate(node => getComputedStyle(node).color);
    await button.hover(); expect(await button.evaluate(node => getComputedStyle(node).color)).toBe(color);
    await page.mouse.down(); expect(await button.evaluate(node => new DOMMatrix(getComputedStyle(node).transform).a)).toBeLessThan(1); await page.mouse.up();
  } finally { await browser.close(); }
});

layoutTest("Cite & note fits mobile and desktop, traps native dialog focus and returns to the answer sheet", async () => {
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1280]) for (const view of ["list", "story"]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } }); await page.goto(fixture());
      if (view === "story") { await page.click("#df-view-toggle"); await page.click(".df-card.is-active .df-answer-open"); }
      const opener = '[data-decision="v00"] .df-item-note'; await page.locator(opener).first().click();
      expect(await page.textContent("#df-note-quote")).toBe("History row");
      const rect = await page.locator("#df-note-dialog").boundingBox();
      expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.x + rect.width).toBeLessThanOrEqual(width);
      expect(rect.y).toBeGreaterThanOrEqual(0); expect(rect.y + rect.height).toBeLessThanOrEqual(845);
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press(i % 3 ? "Tab" : "Shift+Tab");
        expect(await page.evaluate(() => Boolean(document.activeElement.closest("#df-note-dialog")))).toBe(true);
      }
      await page.keyboard.press("Escape");
      expect(await page.evaluate(() => document.activeElement.classList.contains("df-item-note"))).toBe(true);
      if (view === "story") expect(await page.locator(".df-sheet.is-open").count()).toBe(1);
      await page.evaluate(() => { const range = document.createRange(); range.selectNodeContents(document.querySelector('[data-decision="v00"] .df-question p')); getSelection().removeAllRanges(); getSelection().addRange(range); });
      await page.locator("#df-cite").click(); expect(await page.textContent("#df-note-quote")).toBe("A written briefing to cite while deciding.");
      await page.fill("#df-note-text", "This needs more detail."); await page.click("#df-note-save");
      expect(await page.locator('[data-chip-for="v00"] .df-note-count').textContent()).toBe("1");
      expect(await page.locator('[data-chip-for="v00"] .df-answer-status').getAttribute("aria-label")).toBe("Awaiting answer");
      expect(await page.isChecked('[data-decision="v00"] .df-check-input >> nth=0')).toBe(false);
      await page.reload();
      expect(await page.locator('[data-chip-for="v00"] .df-note-count').textContent()).toBe("1");
      if (view === "story") await page.click(".df-card.is-active .df-answer-open");
      await page.click('[data-decision="v00"] .df-clear');
      expect(await page.locator('[data-decision="v00"] .df-clear-confirm').isVisible()).toBe(true);
      await page.keyboard.press("Escape");
      expect(await page.evaluate(() => document.activeElement.classList.contains("df-clear"))).toBe(true);
      await page.click('[data-decision="v00"] .df-clear'); await page.click('[data-decision="v00"] .df-clear-apply');
      expect(await page.locator('[data-chip-for="v00"] .df-answer-status').getAttribute("aria-label")).toBe("Awaiting answer");
      expect(await page.locator('[data-chip-for="v00"] .df-note-count').isVisible()).toBe(false);
      await page.close();
    }
  } finally { await browser.close(); }
}, 60000);

layoutTest("controller fits the viewport in every transport, speed and view state", async () => {
  const url = fixture();
  const browser = await chromium.launch();
  const failures = [];
  try {
    for (const width of [360, 375, 390, 440, 720, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      await page.goto(url);
      for (const view of ["list", "story"]) {
        if ((await page.evaluate(() => document.body.dataset.view)) !== view) await page.click("#df-view-toggle");
        for (const rate of ["0.8", "1.75"]) {
          await page.selectOption("#df-speed", rate);
          for (const label of TRANSPORT_LABELS) {
            const result = await page.evaluate(([icon, word]) => {
              // Same structure updateTransport writes.
              document.getElementById("df-transport-play").innerHTML = `<span class="df-tplay-icon" aria-hidden="true">${icon}</span><span class="df-tplay-text">${word}</span>`;
              const limit = document.documentElement.clientWidth;
              const controls = [...document.querySelectorAll(".df-transport > *")].filter((node) => node.getClientRects().length);
              const out = controls.filter((node) => { const box = node.getBoundingClientRect(); return box.left < 0 || box.right > limit; })
                .map((node) => `${node.id || node.className}@${Math.round(node.getBoundingClientRect().right)}`);
              const clipped = [...document.querySelectorAll(".df-transport button, .df-transport select")]
                .filter((node) => node.scrollWidth > node.clientWidth + 1).map((node) => node.id || node.className);
              out.push(...clipped.map((name) => `${name}:content-clipped`));
              return { out, scrollWidth: document.documentElement.scrollWidth, limit, rows: controls.map((node) => { const box = node.getBoundingClientRect(); return (box.top + box.bottom) / 2; }).sort((x, y) => x - y).filter((center, index, all) => index === 0 || center - all[index - 1] > 6).length };
            }, label);
            if (result.out.length || result.scrollWidth > result.limit || result.rows !== 1) failures.push({ width, view, rate, label, ...result });
          }
        }
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
  expect(failures).toEqual([]);
}, 60000);

layoutTest("Stop belongs to story view only, at every width", async () => {
  const url = fixture();
  const browser = await chromium.launch();
  try {
    for (const width of [390, 440, 720, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      await page.goto(url);
      const display = () => page.evaluate(() => getComputedStyle(document.getElementById("df-transport-stop")).display);
      expect(await display()).toBe("none");
      await page.click("#df-view-toggle");
      expect(await display()).not.toBe("none");
      await page.close();
    }
  } finally {
    await browser.close();
  }
}, 60000);

layoutTest("top chip strip is visible and navigates at 390px and 1280px", async () => {
  const url = fixture();
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      await page.goto(url);
      const strip = await page.evaluate(() => {
        const node = document.querySelector(".df-controller .df-chips");
        const box = node.getBoundingClientRect();
        return { display: getComputedStyle(node).display, width: box.width, height: box.height, chips: node.querySelectorAll(".df-chip").length };
      });
      expect(strip.display).not.toBe("none");
      expect(strip.width).toBeGreaterThan(200);
      expect(strip.height).toBeGreaterThan(30);
      expect(strip.chips).toBe(8);
      await page.click('.df-chip[data-chip-for="d03"]');
      expect(await page.evaluate(() => document.querySelector('[data-decision="d03"]').classList.contains("is-active"))).toBe(true);
      expect(await page.getAttribute('.df-chip[data-chip-for="d03"]', "aria-current")).toBe("true");
      await page.close();
    }
  } finally {
    await browser.close();
  }
}, 60000);

layoutTest("story view is a full-screen stage: title, read-along and bottom transport all inside the viewport", async () => {
  const url = fixture();
  const browser = await chromium.launch();
  try {
    for (const [width, height] of [[390, 844], [1280, 800]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.goto(url);
      await page.click("#df-view-toggle");
      const box = await page.evaluate(() => {
        const rect = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }; };
        return {
          title: rect(".df-card.is-active h2"), words: rect(".df-card.is-active .df-teleprompter"), answer: rect(".df-card.is-active .df-answer-open"),
          controller: rect(".df-controller"), top: rect("#df-story-top"), stop: getComputedStyle(document.getElementById("df-transport-stop")).display,
          scrollWidth: document.documentElement.scrollWidth, innerWidth, innerHeight,
          visibleCards: [...document.querySelectorAll(".df-card")].filter((card) => card.getClientRects().length).length,
          titleAlign: getComputedStyle(document.querySelector(".df-card.is-active")).textAlign,
        };
      });
      expect(box.visibleCards).toBe(1);
      expect(box.scrollWidth).toBeLessThanOrEqual(box.innerWidth);
      expect(box.titleAlign).toBe("center");
      expect(box.title.top).toBeGreaterThanOrEqual(box.top.bottom - 1);
      expect(box.words.height).toBeGreaterThan(120);
      expect(box.answer.bottom).toBeLessThanOrEqual(box.controller.top + 24);
      expect(box.controller.bottom).toBeLessThanOrEqual(box.innerHeight + 1);
      expect(box.stop).not.toBe("none");
      await page.close();
    }
  } finally {
    await browser.close();
  }
}, 60000);

layoutTest("answer sheet fits the viewport, traps real Tab focus and Esc returns focus", async () => {
  const url = fixture();
  const browser = await chromium.launch();
  try {
    for (const [width, height] of [[390, 844], [1280, 800]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.goto(url);
      await page.click("#df-view-toggle");
      await page.click(".df-card.is-active .df-answer-open");
      await page.waitForTimeout(320); // let the 200ms open animation settle before measuring
      const sheet = await page.evaluate(() => { const node = document.querySelector(".df-sheet.is-open"); const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, role: node.getAttribute("role"), scrolls: node.scrollHeight >= node.clientHeight }; });
      expect(sheet.role).toBe("dialog");
      expect(sheet.left).toBeGreaterThanOrEqual(0);
      expect(sheet.right).toBeLessThanOrEqual(width);
      expect(sheet.top).toBeGreaterThanOrEqual(0);
      expect(sheet.bottom).toBeLessThanOrEqual(height + 1);
      for (let i = 0; i < 14; i += 1) {
        await page.keyboard.press(i % 5 === 4 ? "Shift+Tab" : "Tab");
        expect(await page.evaluate(() => Boolean(document.activeElement.closest(".df-sheet.is-open")))).toBe(true);
      }
      await page.keyboard.press("Escape");
      expect(await page.evaluate(() => document.querySelector(".df-sheet.is-open"))).toBeNull();
      expect(await page.evaluate(() => document.activeElement.classList.contains("df-answer-open"))).toBe(true);
      // Final card: Next inside the sheet must reach a visible, usable Copy answers.
      await page.click('.df-chip[data-chip-for="d06"]');
      await page.click(".df-card.is-active .df-answer-open");
      await page.waitForTimeout(320);
      await page.click(".df-sheet.is-open .df-next", { timeout: 2000 });
      const terminal = await page.evaluate(() => ({ open: Boolean(document.querySelector(".df-sheet.is-open")), inert: document.querySelectorAll("[inert]").length, focus: document.activeElement.classList.contains("df-story-copy"), ready: document.activeElement.classList.contains("is-ready"), visible: document.activeElement.getClientRects().length > 0 }));
      expect(terminal).toEqual({ open: false, inert: 0, focus: true, ready: true, visible: true });
      await page.click('.df-chip[data-chip-for="v00"]');
      // Real pointer: controls inside the sheet are clickable (nothing covers them), and a tap outside closes it.
      await page.click(".df-card.is-active .df-answer-open");
      await page.waitForTimeout(320);
      await page.click(".df-sheet.is-open .df-check", { timeout: 2000 });
      expect(await page.evaluate(() => document.querySelector(".df-sheet.is-open .df-check-input").checked)).toBe(true);
      await page.click(".df-sheet.is-open .df-option", { timeout: 2000 });
      await page.mouse.click(8, 8);
      expect(await page.evaluate(() => document.querySelector(".df-sheet.is-open"))).toBeNull();
      await page.close();
    }
  } finally {
    await browser.close();
  }
}, 60000);

layoutTest("a real far-chip tap lands on its requested card after smooth scrolling", async () => {
  const browser = await chromium.launch(), landings = [];
  try { for (const width of [390, 1280]) { const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "no-preference" });
    await page.goto(fixture(["v00", ...Array.from({ length: 24 }, (_, index) => "d" + index), "nl2", "nl3"]));
    expect(await page.evaluate(() => scrollY)).toBe(0); await page.locator('[data-chip-for="nl2"]').tap();
    await waitForScrollSettle(page);
    landings.push(await page.evaluate(() => { const target = document.querySelector('[data-decision="nl2"]'); return { width: innerWidth, y: scrollY, top: target.getBoundingClientRect().top, line: parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) + parseFloat(getComputedStyle(target).scrollMarginTop) }; }));
    expect(await page.evaluate(() => ({ card: document.querySelector(".df-card.is-active").dataset.decision, chip: document.querySelector('.df-chip[aria-current="true"]').dataset.chipFor, index: document.querySelector(".df-index a.is-active").dataset.indexFor }))).toEqual({ card: "nl2", chip: "nl2", index: "nl2" });
    await page.close();
  } } finally { await browser.close(); }
  console.info("far-tap landings", JSON.stringify(landings));
  for (const { top, line } of landings) expect(Math.abs(top - line)).toBeLessThanOrEqual(3);
}, 15000);

for (const [width, height] of [[390, 844], [1280, 800]]) layoutTest(`bottom scroll selects the last card in every navigation surface at ${width}px`, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" }); await page.goto(fixture());
    await page.evaluate(async () => { window.scrollTo(0, document.documentElement.scrollHeight); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
    const state = await page.evaluate(() => ({ bottom: Math.abs(scrollY + innerHeight - document.documentElement.scrollHeight) < 2, card: document.querySelector(".df-card.is-active").dataset.decision, chip: document.querySelector('.df-chip[aria-current="true"]').dataset.chipFor, index: document.querySelector(".df-index a.is-active").dataset.indexFor, now: document.getElementById("df-now").textContent }));
    expect(state).toEqual({ bottom: true, card: "d06", chip: "d06", index: "d06", now: "6  Pristine sprints with new leads 7" });
  } finally { await browser.close(); }
});

for (const destination of ["bottom", "mid-page"]) layoutTest(`an interrupted far-chip jump reconciles ${destination} after the lock settles`, async () => {
  const browser = await chromium.launch(), states = [];
  try { for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "no-preference" });
    await page.goto(fixture(["v00", ...Array.from({ length: 24 }, (_, index) => "d" + index), "nl2", "nl3"]));
    await page.locator(destination === "bottom" ? '[data-chip-for="nl2"]' : '[data-chip-for="d20"]').tap();
    await page.evaluate(destination => window.scrollTo({ top: destination === "bottom" ? document.documentElement.scrollHeight : scrollY + document.querySelector('[data-decision="d20"]').getBoundingClientRect().top - (innerHeight - 57), behavior: "instant" }), destination);
    await waitForScrollSettle(page); // No extra scroll: reconcile the suppressed final event.
    states.push(await page.evaluate(() => ({ bottom: Math.abs(scrollY + innerHeight - document.documentElement.scrollHeight) < 2, card: document.querySelector(".df-card.is-active").dataset.decision, chip: document.querySelector('.df-chip[aria-current="true"]').dataset.chipFor, index: document.querySelector(".df-index a.is-active").dataset.indexFor })));
    await page.close();
  } } finally { await browser.close(); }
  const expected = destination === "bottom" ? "nl3" : "d19";
  expect(states).toEqual([390, 1280].map(() => ({ bottom: destination === "bottom", card: expected, chip: expected, index: expected })));
}, 15000);
