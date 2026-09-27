// Fixture replay for reviewer-order-gate: every fixture is fed to the real hook
// wrapper on stdin, with `gh` stubbed on PATH. No network: the stub serves a
// canned `gh pr view --json` response, hangs, or is absent.

import { test, expect } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { classifyChecks, extractPrRefs, lastNonEmptyLine } from "../src/reviewer-order-gate.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(here, "..", "scripts", "reviewer-order-gate-hook.mjs");
const NODE = Bun.which("node") ?? "node";
const DENY_PREFIX = "REVIEWER-ORDER-GATE: implementer not done —";

const fixtures = readdirSync(path.join(here, "fixtures"))
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => ({ file: f, ...JSON.parse(readFileSync(path.join(here, "fixtures", f), "utf8")) }));

function sub(value, dir) {
  return JSON.parse(JSON.stringify(value).replaceAll("{{DIR}}", dir));
}

function writeStub(bin, body) {
  const gh = path.join(bin, "gh");
  writeFileSync(gh, `#!/bin/sh\n${body}\n`);
  chmodSync(gh, 0o755);
}

// Returns { stdout, log, elapsedMs } for one hook run.
function runHook({ payload, files = {}, gh, env = {} }, stdinOverride) {
  const dir = mkdtempSync(path.join(tmpdir(), "reviewer-order-gate-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const p = path.join(dir, rel);
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, content.replaceAll("{{DIR}}", dir));
    }
    const bin = path.join(dir, "bin");
    mkdirSync(bin);
    const log = path.join(dir, "gh.log");
    let PATH = `${bin}:/usr/bin:/bin`;
    if (gh === "missing") {
      PATH = bin;
    } else if (gh === "hang") {
      writeStub(bin, `printf '%s\\n' "$*" >> '${log}'\nexec sleep 5`);
    } else if (typeof gh === "string") {
      writeStub(bin, `printf '%s\\n' "$*" >> '${log}'\n${gh}`);
    } else if (gh) {
      const committedDate = new Date(Date.now() - gh.head_age_minutes * 60_000).toISOString();
      const resp = path.join(dir, "gh-response.json");
      writeFileSync(resp, JSON.stringify({ ...gh.pr, commits: [{ oid: "older", committedDate: "2020-01-01T00:00:00Z" }, { oid: gh.pr.headRefOid, committedDate }] }));
      writeStub(bin, `printf '%s\\n' "$*" >> '${log}'\ncat '${resp}'`);
    } else {
      writeStub(bin, `printf '%s\\n' "$*" >> '${log}'\necho 'stub: unexpected gh call' >&2\nexit 1`);
    }
    const started = performance.now();
    const proc = spawnSync(NODE, [HOOK], {
      input: stdinOverride ?? JSON.stringify(sub(payload, dir)),
      encoding: "utf8",
      env: { PATH, HOME: dir, ...env },
      timeout: 8000,
    });
    const elapsedMs = performance.now() - started;
    expect(proc.status).toBe(0);
    return {
      stdout: JSON.parse(proc.stdout || "{}"),
      log: existsSync(log) ? readFileSync(log, "utf8") : "",
      elapsedMs,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("fixture coverage: every brief-required specimen is present", () => {
  const specimens = fixtures.map((fx) => fx.specimen);
  for (const s of [
    "reviewer-with-no-evidence-is-denied",
    "reviewer-citing-report-whose-last-line-is-done-is-allowed",
    "report-whose-done-marker-is-not-the-last-line-is-denied",
    "reviewer-citing-pr-with-pending-checks-is-denied",
    "reviewer-citing-pr-with-finished-checks-is-allowed",
    "cloud-branch-pr-whose-head-is-under-ten-minutes-old-is-denied",
    "cloud-branch-pr-with-stable-head-and-finished-checks-is-allowed",
    "implementor-spawn-is-untouched",
    "boot-prompt-path-brief-is-read-for-evidence",
    "gh-missing-fails-open-with-advisory",
    "gh-timeout-fails-open-with-advisory",
  ]) expect(specimens).toContain(s);
});

for (const fx of fixtures) {
  test(`${fx.file}: ${fx.specimen} → ${fx.expect}`, () => {
    const { stdout, log, elapsedMs } = runHook(fx);
    expect(elapsedMs).toBeLessThan(5000);
    const hso = stdout.hookSpecificOutput;
    if (fx.expect === "ALLOW" || fx.expect === "UNTOUCHED") {
      expect(stdout).toEqual({});
    } else if (fx.expect === "DENY") {
      expect(hso?.hookEventName).toBe("PreToolUse");
      expect(hso?.permissionDecision).toBe("deny");
      expect(hso?.permissionDecisionReason.startsWith(DENY_PREFIX)).toBe(true);
      expect(hso?.permissionDecisionReason).not.toContain("\n");
      expect(hso?.permissionDecisionReason).toContain(fx.reason_contains);
    } else if (fx.expect === "ADVISORY") {
      expect(hso?.permissionDecision).toBeUndefined();
      expect(hso?.additionalContext).toContain("REVIEWER-ORDER-GATE advisory");
      expect(hso?.additionalContext).toContain(fx.reason_contains);
    } else {
      throw new Error(`unknown expect ${fx.expect}`);
    }
    if (fx.expect === "UNTOUCHED") expect(log).toBe("");
    if (fx.expect_gh_args) expect(log.split("\n")[0].startsWith(fx.expect_gh_args.join(" "))).toBe(true);
  });
}

const reviewerPr = {
  hook_event_name: "PreToolUse",
  tool_name: "mcp__cmuxlayer__spawn_agent",
  tool_input: { role: "reviewer", prompt: "Review golems #293." },
};

test("gh returning garbage (gate crash) fails open with an advisory", () => {
  const { stdout } = runHook({ payload: reviewerPr, gh: "echo 'not json{'" });
  expect(stdout.hookSpecificOutput?.permissionDecision).toBeUndefined();
  expect(stdout.hookSpecificOutput?.additionalContext).toContain("REVIEWER-ORDER-GATE advisory");
});

test("gh auth failure fails open; only a not-found PR counts as missing evidence", () => {
  const auth = runHook({ payload: reviewerPr, gh: "echo 'gh auth login required' >&2; exit 4" });
  expect(auth.stdout.hookSpecificOutput?.additionalContext).toContain("REVIEWER-ORDER-GATE advisory");
  const notFound = runHook({ payload: reviewerPr, gh: "echo 'GraphQL: Could not resolve to a PullRequest with the number of 293.' >&2; exit 1" });
  expect(notFound.stdout.hookSpecificOutput?.permissionDecision).toBe("deny");
});

test("malformed stdin fails open with an advisory", () => {
  const { stdout } = runHook({ payload: {} }, "{not json");
  expect(stdout.hookSpecificOutput?.permissionDecision).toBeUndefined();
  expect(stdout.hookSpecificOutput?.additionalContext).toContain("REVIEWER-ORDER-GATE advisory");
});

test("unreadable boot_prompt_path fails open with an advisory", () => {
  const { stdout } = runHook({
    payload: { ...reviewerPr, tool_input: { role: "reviewer", boot_prompt_path: "{{DIR}}/nope.md" } },
  });
  expect(stdout.hookSpecificOutput?.additionalContext).toContain("REVIEWER-ORDER-GATE advisory");
});

test("lastNonEmptyLine ignores trailing blank lines and CRLF", () => {
  expect(lastNonEmptyLine("a\r\nDONE_X\r\n\r\n  \n")).toBe("DONE_X");
  expect(lastNonEmptyLine("")).toBe("");
});

test("extractPrRefs finds URLs, owner/repo#N and bare #N once each", () => {
  const refs = extractPrRefs("See https://github.com/EtanHey/golems/pull/12 and EtanHey/cmuxlayer#7, then #12 and (#9).");
  expect(refs).toEqual([
    { label: "https://github.com/EtanHey/golems/pull/12", args: ["https://github.com/EtanHey/golems/pull/12"] },
    { label: "EtanHey/cmuxlayer#7", args: ["7", "--repo", "EtanHey/cmuxlayer"] },
    { label: "#12", args: ["12"] },
    { label: "#9", args: ["9"] },
  ]);
});

test("classifyChecks: CheckRun status and StatusContext state both count", () => {
  expect(classifyChecks([])).toEqual({ total: 0, pending: [] });
  expect(classifyChecks([
    { __typename: "CheckRun", name: "a", status: "QUEUED" },
    { __typename: "CheckRun", name: "b", status: "COMPLETED", conclusion: "FAILURE" },
    { __typename: "StatusContext", context: "c", state: "EXPECTED" },
    { __typename: "StatusContext", context: "d", state: "ERROR" },
  ])).toEqual({ total: 4, pending: ["a", "c"] });
});
