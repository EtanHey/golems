// Deterministic replay gate for false-green-gate (gen-18 Track 2).
// Pinned RED (false-green) + GREEN (live-probed / N-A) transcript fixtures ARE
// the replayable gate — same fixtures in → same pass/fail out (R-003/R-014
// pattern, T6 smoke-spec shape). Runs under `bun test` and `node --test`.

import { test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { detectFalseGreen as detectCodeTurn } from "../src/false-green-gate.mjs";

// Preserve the original domain/probe assertions inside an explicit code turn.
function detectFalseGreen(transcript) {
  if (typeof transcript !== "string") return detectCodeTurn(transcript);
  return detectCodeTurn({ events: [
    { role: "assistant", tools: [{ name: "Edit", input: { file_path: "src/example.ts" } }] },
    { role: "assistant", text: transcript },
  ] });
}

const here = path.dirname(fileURLToPath(import.meta.url));
const redDir = path.join(here, "fixtures", "red");
const greenDir = path.join(here, "fixtures", "green");

function loadFixtures(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ file: f, ...JSON.parse(readFileSync(path.join(dir, f), "utf8")) }));
}

const reds = loadFixtures(redDir);
const greens = loadFixtures(greenDir);

test("fixture coverage: original corpus plus goal-required RED/GREEN cases present", () => {
  expect(reds.length).toBeGreaterThanOrEqual(19);
  expect(greens.length).toBeGreaterThanOrEqual(15);
});

for (const fx of reds) {
  test(`RED ${fx.file} (${fx.specimen}) → FLAG ${fx.violation}`, () => {
    const result = detectFalseGreen(fx);
    expect(result.verdict).toBe("FLAG");
    const codes = result.violations.map((v) => v.code);
    expect(codes).toContain(fx.violation);
  });
}

for (const fx of greens) {
  test(`GREEN ${fx.file} (${fx.specimen}) → PASS`, () => {
    const result = detectFalseGreen(fx);
    expect(result.verdict).toBe("PASS");
    expect(result.violations.length).toBe(0);
  });
}

test("replay is deterministic", () => {
  for (const fx of [...reds, ...greens]) {
    expect(JSON.stringify(detectFalseGreen(fx))).toBe(JSON.stringify(detectFalseGreen(fx)));
  }
});

test("a completion claim with NO probe of any kind is always a FLAG", () => {
  const bare = "All done ✅ everything works.";
  expect(detectFalseGreen(bare).verdict).toBe("FLAG");
});

// References and deferred markers are not delivery claims; actual claims remain gated.
test("a review URL does not select dashboard requirements for a generic claim", () => {
  const result = detectFalseGreen("Fixed. Review: https://github.com/example/repo/pull/1");
  expect(result.domains).not.toContain("dashboard");
  expect(result.violations.map(v => v.code)).toEqual(["FALSE_GREEN_LIVE_PROBE"]);
});

test("a published URL still requires dashboard probes", () => {
  const result = detectFalseGreen("Published at https://example.com/release.");
  expect(result.violations.map(v => v.code)).toContain("FALSE_GREEN_DASHBOARD_200");
  expect(result.violations.map(v => v.code)).toContain("FALSE_GREEN_CLICK_THROUGH");
});

test("attribution and a deferred marker cannot hide a separate dashboard claim", () => {
  const result = detectFalseGreen("w6's 5 false positives are fixed. My report and DONE marker wait for approval. The dashboard is ready to use.");
  expect(result.violations.map(v => v.code)).toContain("FALSE_GREEN_DASHBOARD_200");
});

test("an emitted DONE marker is still a completion claim", () => {
  expect(detectFalseGreen("My DONE marker is ready.").verdict).toBe("FLAG");
});

for (const text of [
  "Published for review at https://dashboard.example.net/fleet.html",
  "Done. Review: https://dashboard.example.net/dashboards/fleet.html",
  "w6's fixes landed and I deployed the fleet dashboard to the tailnet hub, which is verified.",
  "Claude's dashboard on the tailnet is done.",
  "The agent's patch merged, I published the panel and it is complete.",
]) {
  test(`review-summary exceptions preserve dashboard claims: ${text}`, () => {
    const result = detectFalseGreen(text);
    expect(result.verdict).toBe("FLAG");
    expect(result.violations.map(v => v.code)).toContain("FALSE_GREEN_DASHBOARD_200");
    expect(result.violations.map(v => v.code)).toContain("FALSE_GREEN_CLICK_THROUGH");
  });
}

test("a newline separates a completion claim from a deferred marker", () => {
  const result = detectFalseGreen("Everything is done\nmarker waits for the lead GO");
  expect(result.verdict).toBe("FLAG");
  expect(result.violations.map(v => v.code)).toContain("FALSE_GREEN_LIVE_PROBE");
});


test("scope follows this turn's activity, independent of seat", () => {
  const claim = { role: "assistant", text: "✅ fixed." };
  const edit = { role: "assistant", tools: [{ name: "Edit", input: {} }] };
  expect(detectCodeTurn({ seat: "coachClaude", events: [edit, claim] }).verdict).toBe("FLAG");
  expect(detectCodeTurn({ seat: "exampleCodex", events: [claim] }).verdict).toBe("PASS");
  expect(detectCodeTurn({ events: [edit, { role: "user", text: "Next drill" }, claim] }).verdict).toBe("PASS");
});

for (const name of ["Write", "NotebookEdit", "MultiEdit", "mcp__github__create_pull_request", "mcp__git__git_push"]) {
  test(`code activity ${name} still requires a probe`, () => {
    const result = detectCodeTurn({ events: [{ role: "assistant", text: "✅ fixed.", tools: [{ name, input: {} }] }] });
    expect(result.violations.map(v => v.code)).toContain("FALSE_GREEN_LIVE_PROBE");
  });
}

for (const command of ['git -C repo commit -m fix', 'git -c user.name=example push', 'gh pr create --title fix']) {
  test(`code command ${command} still requires a probe`, () => {
    const result = detectCodeTurn({ events: [{ role: "assistant", text: "✅ fixed.", tools: [{ name: "Bash", input: { command } }] }] });
    expect(result.violations.map(v => v.code)).toContain("FALSE_GREEN_LIVE_PROBE");
  });
}

for (const command of ['git status', 'echo "git commit -m fix"', "cat <<'EOF'\ngit push\nEOF"]) {
  test(`read-only or quoted command ${command} is not code activity`, () => {
    expect(detectCodeTurn({ events: [{ role: "assistant", text: "✅ drill.", tools: [{ name: "Bash", input: { command } }] }] }).verdict).toBe("PASS");
  });
}
