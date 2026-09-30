// Deterministic replay gate for fleet-wrap-gate (gen-18 Track 1 #6).
// Pinned RED (terminal-state cron-still-armed) + GREEN (cron-count=0 / N-A)
// transcript fixtures ARE the replayable gate — same fixtures in → same pass/fail
// out (R-003/R-014 pattern, T6 smoke-spec shape). Runs under `bun test` and
// `node --test`.

import { test, expect, setDefaultTimeout } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { detectFleetWrap } from "../src/fleet-wrap-gate.mjs";

// These tests spawn node/bun; a cold CI runner can exceed bun's 5s default.
setDefaultTimeout(15_000);

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

test("fixture coverage: specimens + state-file REDs + GREEN references present", () => {
  expect(reds.length).toBe(28);
  expect(greens.length).toBeGreaterThanOrEqual(14);
});

test("a generic recurring job (digest/driver) relabeled 'one inbound monitor' FLAGs", () => {
  const bad = {
    events: [
      { role: "user", text: "stand down" },
      {
        role: "assistant",
        text: "Standing by for Etan, one inbound monitor only.",
        tools: [{ name: "CronCreate", input: { prompt: "nightly digest of all PRs" } }],
      },
    ],
  };
  expect(detectFleetWrap(bad).verdict).toBe("FLAG");
});

test("a genuine inbound relay CronCreate (or empty payload) under inbound framing PASSes", () => {
  for (const input of [{ prompt: "inbound: relay any Etan reply" }, {}]) {
    const ok = {
      events: [
        { role: "user", text: "stand down" },
        {
          role: "assistant",
          text: "Standing by for Etan, one inbound monitor. No polling.",
          tools: [{ name: "CronCreate", input }],
        },
      ],
    };
    expect(detectFleetWrap(ok).verdict).toBe("PASS");
  }
});

test("a same-turn CronDelete does NOT clear a freshly-created GENERIC cron", () => {
  const bad = {
    events: [
      { role: "user", text: "wrap" },
      {
        role: "assistant",
        text: "Fleet wrapped. Deleted the old job, armed a new digest cron.",
        tools: [
          { name: "CronDelete", input: {} },
          { name: "CronCreate", input: { prompt: "nightly digest" } },
        ],
      },
    ],
  };
  expect(detectFleetWrap(bad).verdict).toBe("FLAG");
});

test("a /loop poll admitted only in narrative still FLAGs", () => {
  const bad = {
    events: [
      { role: "user", text: "wrap" },
      { role: "assistant", text: "Fleet wrapped. Left a /loop poll running on the PRs." },
    ],
  };
  expect(detectFleetWrap(bad).verdict).toBe("FLAG");
});

test("a strong wrap marker + 'more work queued' + a CronCreate is evaluated, not escaped", () => {
  const bad = {
    events: [
      { role: "user", text: "wrap" },
      {
        role: "assistant",
        text: "Fleet wrapped — more work is queued, so I armed a cron.",
        tools: [{ name: "CronCreate", input: { prompt: "drive queue" } }],
      },
    ],
  };
  expect(detectFleetWrap(bad).verdict).toBe("FLAG");
});

test("casual 'loop back later' prose at a clean wrap does NOT FLAG", () => {
  const ok = {
    events: [
      { role: "user", text: "wrap" },
      { role: "assistant", text: "Fleet wrapped — cron-count=0. I'll loop back later if needed." },
    ],
  };
  expect(detectFleetWrap(ok).verdict).toBe("PASS");
});

test("a for/seq sleep-poll loop with a non-'i' loop variable still FLAGs", () => {
  const bad = {
    events: [
      { role: "user", text: "wrap" },
      {
        role: "assistant",
        text: "Fleet wrapped.",
        tools: [{ name: "Bash", input: { command: "for n in $(seq 1 99); do gh pr list; sleep 30; done" } }],
      },
    ],
  };
  expect(detectFleetWrap(bad).verdict).toBe("FLAG");
});

test("multiple CronCreates narrated as 'one inbound monitor' FLAG (one-monitor law)", () => {
  const bad = {
    events: [
      { role: "user", text: "stand down" },
      {
        role: "assistant",
        text: "Standing by for Etan, just one inbound monitor.",
        tools: [
          { name: "CronCreate", input: { prompt: "inbound a" } },
          { name: "CronCreate", input: { prompt: "inbound b" } },
        ],
      },
    ],
  };
  expect(detectFleetWrap(bad).verdict).toBe("FLAG");
});

test("a health-watch hidden in the CronCreate payload is not excused by 'inbound' narrative", () => {
  const bad = {
    events: [
      { role: "user", text: "stand down" },
      {
        role: "assistant",
        text: "Standing by for Etan, one inbound monitor only.",
        tools: [{ name: "CronCreate", input: { prompt: "FLEET HEALTH WATCH poll panes" } }],
      },
    ],
  };
  expect(detectFleetWrap(bad).verdict).toBe("FLAG");
});

test("monitor-law exception is NOT dead code: a CronCreate framed as the inbound monitor PASSes", () => {
  const ok = {
    events: [
      { role: "user", text: "stand down" },
      {
        role: "assistant",
        text: "Standing down — one inbound monitor to catch your reply, awaiting an Etan decision. No health-watch.",
        tools: [{ name: "mcp__cmuxlayer__CronCreate", input: { prompt: "inbound listen" } }],
      },
    ],
  };
  expect(detectFleetWrap(ok).verdict).toBe("PASS");
});

test("a same-turn CronDelete does NOT excuse a freshly-armed health-watch (delete-old + create-new)", () => {
  const bad = {
    events: [
      { role: "user", text: "wrap" },
      {
        role: "assistant",
        text: "Fleet wrapped. Deleted the old poll, armed a fresh health-watch cron.",
        tools: [
          { name: "CronDelete", input: {} },
          { name: "CronCreate", input: { prompt: "health watch" } },
        ],
      },
    ],
  };
  expect(detectFleetWrap(bad).verdict).toBe("FLAG");
});

test("monitor-law: a pure inbound standby monitor (no health-watch/poll) is a PASS", () => {
  const ok = {
    events: [
      { role: "user", text: "anything else?" },
      { role: "assistant", text: "Nope — standing by for Etan, one inbound monitor up. No polling crons." },
    ],
  };
  const result = detectFleetWrap(ok);
  expect(result.verdict).toBe("PASS");
  expect(result.terminal).toBe(true);
});

for (const fx of reds) {
  test(`RED ${fx.file} (${fx.specimen}) → FLAG ${fx.violation}`, () => {
    const result = detectFleetWrap(fx);
    expect(result.verdict).toBe("FLAG");
    const codes = result.violations.map((v) => v.code);
    expect(codes).toContain(fx.violation);
  });
}

for (const fx of greens) {
  test(`GREEN ${fx.file} (${fx.specimen}) → PASS`, () => {
    const result = detectFleetWrap(fx);
    expect(result.verdict).toBe("PASS");
    expect(result.violations.length).toBe(0);
  });
}

test("replay is deterministic", () => {
  for (const fx of [...reds, ...greens]) {
    expect(JSON.stringify(detectFleetWrap(fx))).toBe(JSON.stringify(detectFleetWrap(fx)));
  }
});

test("a fleet wrap with a still-armed health-watch cron is always a FLAG", () => {
  const bare = {
    events: [
      { role: "user", text: "wrap the fleet" },
      {
        role: "assistant",
        text: "Fleet wrapped — leaving the health-watch cron running overnight.",
      },
    ],
  };
  expect(detectFleetWrap(bare).verdict).toBe("FLAG");
});

test("a fleet wrap that clears all crons (cron-count=0) is a PASS", () => {
  const ok = {
    events: [
      { role: "user", text: "wrap the fleet" },
      {
        role: "assistant",
        text: "Fleet wrapped — all crons cleared (cron-count=0), going silent.",
      },
    ],
  };
  const result = detectFleetWrap(ok);
  expect(result.verdict).toBe("PASS");
  expect(result.terminal).toBe(true);
});

test("a non-terminal turn is N/A even when it arms a cron", () => {
  const midSprint = {
    events: [
      { role: "user", text: "go" },
      {
        role: "assistant",
        text: "Still driving the sprint, more work queued.",
        tools: [{ name: "mcp__cmuxlayer__CronCreate", input: { schedule: "*/5 * * * *", prompt: "tick" } }],
      },
    ],
  };
  const result = detectFleetWrap(midSprint);
  expect(result.verdict).toBe("PASS");
  expect(result.terminal).toBe(false);
});

test("registry truth beats a 'crons deleted' claim at wrap", () => {
  const result = detectFleetWrap({
    state: {
      crons: [
        {
          id: "cron-health-17",
          status: "active",
          prompt: "health-watch poll worker panes every 5 minutes",
        },
      ],
    },
    events: [
      { role: "user", text: "wrap the fleet" },
      {
        role: "assistant",
        text: "Fleet wrapped. All crons deleted, cron-count=0, going silent.",
      },
    ],
  });
  expect(result.verdict).toBe("FLAG");
  expect(result.violations.map((v) => v.code)).toContain("FLEETWRAP_CRON_ALIVE");
  expect(result.violations[0].action).toContain("delete cron cron-health-17");
});

test("terminal Etan-only decision with an armed loop blocks with TaskStop action", () => {
  const result = detectFleetWrap({
    state: {
      loops: [
        {
          id: "loop-etan-decision",
          status: "running",
          command: "/loop 5m check whether Etan decided",
        },
      ],
    },
    events: [
      { role: "user", text: "where are we?" },
      {
        role: "assistant",
        text: "Work is complete; only an Etan decision remains. Standing down.",
      },
    ],
  });
  expect(result.verdict).toBe("FLAG");
  expect(result.violations.map((v) => v.code)).toContain("FLEETWRAP_LOOP_ALIVE");
  expect(result.violations[0].action).toContain("TaskStop loop-etan-decision");
});

test("wrap with verified zero durable crons passes", () => {
  const result = detectFleetWrap({
    state: { crons: [], loops: [] },
    events: [
      { role: "user", text: "wrap the fleet" },
      { role: "assistant", text: "Fleet wrapped; decision left for Etan; going silent." },
    ],
  });
  expect(result.verdict).toBe("PASS");
  expect(result.terminal).toBe(true);
});

test("discussion about the fleet-wrap gate is not a terminal wrap state", () => {
  const result = detectFleetWrap({
    state: {
      crons: [{ id: "cron-mid-sprint", status: "active", prompt: "drive current sprint" }],
    },
    events: [
      { role: "user", text: "what should fleet-wrap-gate enforce?" },
      {
        role: "assistant",
        text: "The fleet-wrap gate should check durable cron state before a final stand-down claim.",
      },
    ],
  });
  expect(result.verdict).toBe("PASS");
  expect(result.terminal).toBe(false);
});

test("persistent inbound collab monitor stays at stand-down", () => {
  const result = detectFleetWrap({
    state: {
      monitors: [
        {
          id: "inbound-collab-1",
          status: "active",
          kind: "inbound_monitor",
          prompt: "relay any inbound Etan reply",
        },
      ],
      crons: [],
      loops: [],
    },
    events: [
      { role: "user", text: "stand down" },
      {
        role: "assistant",
        text: "Standing down. Inbound collab monitor stays; everything periodic is stopped.",
      },
    ],
  });
  expect(result.verdict).toBe("PASS");
  expect(result.terminal).toBe(true);
});

test("Stop hook scopes the shared task registry to the current session", () => {
  const root = mkdtempSync(path.join(tmpdir(), "fleet-wrap-session-scope-"));
  const currentSession = "current-session";
  const currentDir = path.join(root, currentSession);
  mkdirSync(currentDir);
  writeFileSync(path.join(currentDir, "1.json"), JSON.stringify({
    id: "1",
    status: "in_progress",
    subject: "P6.5-7: Deploy staging + QA walk",
  }));

  for (let index = 0; index < 120; index += 1) {
    const foreignDir = path.join(root, `foreign-${String(index).padStart(3, "0")}`);
    mkdirSync(foreignDir);
    for (let task = 1; task <= 2; task += 1) {
      writeFileSync(path.join(foreignDir, `${task}.json`), JSON.stringify({
        id: String(task),
        status: "in_progress",
        subject: `Deploy staging and health check for foreign session ${index}`,
      }));
    }
  }

  const hook = path.join(here, "..", "scripts", "fleet-wrap-gate-hook.mjs");
  const payload = {
    session_id: currentSession,
    tasks_dir: root,
    transcript: {
      events: [
        { role: "user", text: "Wrap this session." },
        { role: "assistant", text: "Fleet wrapped for this session; cron-count=0." },
      ],
    },
  };

  try {
    const result = spawnSync(process.execPath, [hook], {
      input: JSON.stringify(payload),
      encoding: "utf8",
      timeout: 5_000,
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── FLEETWRAP_CLEANUP_RECEIPT_MISSING (cleanliness standard Mechanism 1) ─────
// Advisory only: a lane DONE report (PR merged or handed off, a written
// DONE_<ID> marker, or a DONE line with a PR URL) must carry a CLEANUP RECEIPT.

const RECEIPT = [
  "CLEANUP RECEIPT",
  "- worktree: .worktrees/x kept because PR #88 awaits lead merge",
  "- branch: feat/x kept because PR #88 awaits lead merge",
  "- files this PR added outside src/tests: none",
  "- docs.local this lane created: none",
].join("\n");

function receiptCodes(transcript, options) {
  return detectFleetWrap(transcript, options).violations.map((v) => v.code);
}

test("a DONE_<ID> marker written with no receipt anywhere FLAGs the receipt advisory", () => {
  const codes = receiptCodes({
    events: [
      { role: "user", text: "finish" },
      {
        role: "assistant",
        text: "Lane finished.",
        tools: [{ name: "Bash", input: { command: "echo DONE_W7 >> ~/lanes/w7-report.md" } }],
      },
    ],
  });
  expect(codes).toEqual(["FLEETWRAP_CLEANUP_RECEIPT_MISSING"]);
});

test("a DONE_<ID> report written via Write with the receipt inside PASSes", () => {
  const result = detectFleetWrap({
    events: [
      { role: "user", text: "finish" },
      {
        role: "assistant",
        text: "Report written.",
        tools: [{
          name: "Write",
          input: {
            file_path: "/lanes/w7-report.md",
            content: `PR: https://github.com/EtanHey/golems/pull/88\n\n${RECEIPT}\n\nDONE_W7\n`,
          },
        }],
      },
    ],
  });
  expect(result.violations).toEqual([]);
});

test("a worker handing a PR to its lead with no receipt FLAGs", () => {
  const codes = receiptCodes({
    events: [
      { role: "user", text: "report" },
      { role: "assistant", text: "PR #88 is reviewed and green; handed it to the lead unmerged." },
    ],
  });
  expect(codes).toContain("FLEETWRAP_CLEANUP_RECEIPT_MISSING");
});

test("a receipt heading without worktree/branch lines is not a receipt", () => {
  const codes = receiptCodes({
    events: [
      { role: "user", text: "report" },
      {
        role: "assistant",
        text: "DONE: https://github.com/EtanHey/golems/pull/88\nCLEANUP RECEIPT: n/a",
      },
    ],
  });
  expect(codes).toContain("FLEETWRAP_CLEANUP_RECEIPT_MISSING");
});

test("negated or conditional merge talk is not a DONE report", () => {
  for (const text of [
    "PR #88 is not merged yet; waiting on CodeRabbit.",
    "Once PR #88 is merged I will clean up the worktree.",
    "Worker W2 DONE for the assigned file audit (no PR).",
  ]) {
    const result = detectFleetWrap({ events: [{ role: "user", text: "status" }, { role: "assistant", text }] });
    expect(result.violations.map((v) => v.code)).not.toContain("FLEETWRAP_CLEANUP_RECEIPT_MISSING");
  }
});

test("the receipt advisory carries an exact action and never pretends to be a cron", () => {
  const result = detectFleetWrap({
    events: [
      { role: "user", text: "merge" },
      { role: "assistant", text: "DONE — https://github.com/EtanHey/golems/pull/88 merged." },
    ],
  });
  const [violation] = result.violations;
  expect(violation.code).toBe("FLEETWRAP_CLEANUP_RECEIPT_MISSING");
  expect(violation.action).toContain("CLEANUP RECEIPT");
  expect(violation.action).not.toContain("delete cron");
});

test("an injected report reader supplies the cited report file", () => {
  const transcript = {
    events: [
      { role: "user", text: "finish" },
      {
        role: "assistant",
        text: "DONE — https://github.com/EtanHey/golems/pull/88. Report: /lanes/w7-report.md",
      },
    ],
  };
  const reads = [];
  const readReport = (p) => {
    reads.push(p);
    return p === "/lanes/w7-report.md" ? `${RECEIPT}\nDONE_W7\n` : null;
  };
  expect(detectFleetWrap(transcript, { readReport }).violations).toEqual([]);
  expect(reads).toEqual(["/lanes/w7-report.md"]);
  expect(receiptCodes(transcript, { readReport: () => null })).toContain("FLEETWRAP_CLEANUP_RECEIPT_MISSING");
});

test("Stop hook reads a cited report file on disk (bounded) and emits a typed advisory without it", () => {
  const root = mkdtempSync(path.join(tmpdir(), "fleet-wrap-receipt-"));
  const report = path.join(root, "w7-report.md");
  const hook = path.join(here, "..", "scripts", "fleet-wrap-gate-hook.mjs");
  const payloadFor = (file) => ({
    hook_event_name: "Stop",
    transcript: {
      events: [
        { role: "user", text: "finish" },
        { role: "assistant", text: `DONE — https://github.com/EtanHey/golems/pull/88. Report: ${file}` },
      ],
    },
  });
  const run = (payload) => spawnSync(process.execPath, [hook], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: 5_000,
  });
  try {
    writeFileSync(report, `${RECEIPT}\nDONE_W7\n`);
    const withReceipt = run(payloadFor(report));
    expect(withReceipt.status).toBe(0);
    expect(JSON.parse(withReceipt.stdout)).toEqual({});

    writeFileSync(report, "DONE_W7\n");
    const without = run(payloadFor(report));
    expect(without.status).toBe(0);
    const parsed = JSON.parse(without.stdout);
    expect(parsed.decision).toBeUndefined();
    expect(parsed.systemMessage).toStartWith("FLEET-WRAP-GATE advisory");
    expect(parsed.systemMessage).toContain("FLEETWRAP_CLEANUP_RECEIPT_MISSING");
    expect(parsed.systemMessage).not.toContain("terminal silence with live periodic work");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a receipt seen only in a tool result (another lane's report) does not satisfy this DONE", () => {
  const codes = receiptCodes({
    events: [
      { role: "user", text: "merge #88" },
      { role: "tool", text: `worker report:\n${RECEIPT}` },
      { role: "assistant", text: "DONE — https://github.com/EtanHey/golems/pull/88 merged." },
    ],
  });
  expect(codes).toContain("FLEETWRAP_CLEANUP_RECEIPT_MISSING");
});

// ── Round 2 (cx9 REQUEST_CHANGES at 9240eda7) ────────────────────────────────

const cli = path.join(here, "..", "scripts", "fleet-wrap-gate-cli.mjs");
const runCli = (fixture) => spawnSync(process.execPath, [cli, fixture], { encoding: "utf8", timeout: 5_000 });

test("R2-1: a receipt-only advisory keeps the CLI at exit 0 and still prints the reason", () => {
  const receiptOnly = runCli(path.join(redDir, "22-merged-pr-done-no-cleanup-receipt.json"));
  expect(receiptOnly.status).toBe(0);
  expect(receiptOnly.stdout).toContain("FLEETWRAP_CLEANUP_RECEIPT_MISSING");
});

test("R2-1: the pre-existing cron/loop FLAGs still exit 3 from the CLI", () => {
  const cron = runCli(path.join(redDir, "01-healthwatch-cron-left-armed.json"));
  expect(cron.status).toBe(3);
  expect(cron.stdout).toContain("FLEETWRAP_");
});

test("R2-2: an explicitly cited report is read before paths the turn merely wrote", () => {
  const reads = [];
  const readReport = (p) => {
    reads.push(p);
    return p === "/safe/final-report.md" ? `${RECEIPT}\nDONE_W7\n` : "# note\n";
  };
  const notes = [1, 2, 3, 4].map((i) => ({
    name: "Write",
    input: { file_path: `/safe/note${i}.md`, content: `note ${i}` },
  }));
  const transcript = {
    events: [
      { role: "user", text: "finish" },
      {
        role: "assistant",
        text: "DONE — https://github.com/EtanHey/golems/pull/88. Final report: /safe/final-report.md",
        tools: notes,
      },
    ],
  };
  expect(detectFleetWrap(transcript, { readReport }).violations).toEqual([]);
  expect(reads[0]).toBe("/safe/final-report.md");
});

test("R2-2: ineligible paths are filtered out before the 4-path cap", () => {
  const reads = [];
  const readReport = (p) => {
    reads.push(p);
    return p === "/safe/final-report.md" ? `${RECEIPT}\nDONE_W7\n` : null;
  };
  const transcript = {
    events: [
      { role: "user", text: "finish" },
      {
        role: "assistant",
        text: [
          "DONE — https://github.com/EtanHey/golems/pull/88.",
          "Notes: /safe/../etc/a.md /safe/x/../b.md ~/../c.md /safe/d/../../e.md",
          "Final report: /safe/final-report.md",
        ].join("\n"),
        tools: [{ name: "Write", input: { file_path: "notes/relative.md", content: "n" } }],
      },
    ],
  };
  expect(detectFleetWrap(transcript, { readReport }).violations).toEqual([]);
  expect(reads).toEqual(["/safe/final-report.md"]);
});

test("R2-3: a DONE_<ID> inside a fenced or quoted example is not a marker", () => {
  for (const text of [
    "Report shape:\n```\nDONE_W7\n```",
    "Report shape:\n~~~md\nDONE_W7\n~~~",
    "Quoted from the collab:\n> DONE_W7",
    "Quoted from the collab:\n> DONE — https://github.com/EtanHey/golems/pull/88",
    "Example:\n```\nPR #88 merged\n```",
  ]) {
    const codes = receiptCodes({ events: [{ role: "user", text: "shape?" }, { role: "assistant", text }] });
    expect(codes).not.toContain("FLEETWRAP_CLEANUP_RECEIPT_MISSING");
  }
});

test("R2-3: a gh pr merge that is only printed, quoted or commented is not a merge", () => {
  for (const command of [
    "echo gh pr merge 88 --merge",
    "printf '%s\\n' 'gh pr merge 88 --merge'",
    "echo \"run: gh pr merge 88\" && git status",
    "# gh pr merge 88 --merge\ngit status",
    "gh pr merge --help",
    "grep -n 'gh pr merge' skills/pr-loop/SKILL.md",
  ]) {
    const codes = receiptCodes({
      events: [
        { role: "user", text: "prep" },
        { role: "assistant", text: "Prepared.", tools: [{ name: "Bash", input: { command } }] },
      ],
    });
    expect(codes).not.toContain("FLEETWRAP_CLEANUP_RECEIPT_MISSING");
  }
});

test("R2-3: an executed gh pr merge still counts, behind env vars, wrappers and chains", () => {
  for (const command of [
    "gh pr merge 88 --merge",
    "GH_TOKEN=x gh pr merge 88 --squash",
    "cd repo && gh pr merge 88 --merge --delete-branch",
    "git fetch; command gh pr merge 88",
  ]) {
    const codes = receiptCodes({
      events: [
        { role: "user", text: "merge" },
        { role: "assistant", text: "Done with that.", tools: [{ name: "Bash", input: { command } }] },
      ],
    });
    expect(codes).toContain("FLEETWRAP_CLEANUP_RECEIPT_MISSING");
  }
});

test("R2-4: a here-document report write with DONE_<ID> and no receipt FLAGs; with a receipt it PASSes", () => {
  const heredoc = (body, open = "<<'EOF'") => ({
    events: [
      { role: "user", text: "finish" },
      {
        role: "assistant",
        text: "Report written.",
        tools: [{ name: "Bash", input: { command: `cat > /safe/w7-report.md ${open}\n${body}\nEOF` } }],
      },
    ],
  });
  const body = "PR: https://github.com/EtanHey/golems/pull/88\n\nDONE_W7";
  expect(receiptCodes(heredoc(body))).toEqual(["FLEETWRAP_CLEANUP_RECEIPT_MISSING"]);
  expect(receiptCodes(heredoc(body, "<<EOF"))).toEqual(["FLEETWRAP_CLEANUP_RECEIPT_MISSING"]);
  expect(receiptCodes({
    events: [
      { role: "user", text: "finish" },
      {
        role: "assistant",
        text: "Report written.",
        tools: [{ name: "Bash", input: { command: `tee -a /safe/w7-report.md <<-'EOF'\n\t${body}\n\tEOF` } }],
      },
    ],
  })).toEqual(["FLEETWRAP_CLEANUP_RECEIPT_MISSING"]);
  expect(receiptCodes(heredoc(`${body}\n\n${RECEIPT}`))).toEqual([]);
});

test("R2-4: a quoted here-document example is not a report write", () => {
  for (const tool of [
    { name: "Bash", input: { command: "echo \"cat > r.md <<EOF\nDONE_W7\nEOF\"" } },
    { name: "Bash", input: { command: "cat <<'EOF'\nDONE_W7\nEOF" } },
  ]) {
    const codes = receiptCodes({
      events: [
        { role: "user", text: "show me" },
        { role: "assistant", text: "Here is the shape.", tools: [tool] },
      ],
    });
    expect(codes).not.toContain("FLEETWRAP_CLEANUP_RECEIPT_MISSING");
  }
  const fencedNarrative = receiptCodes({
    events: [
      { role: "user", text: "show me" },
      { role: "assistant", text: "Shape:\n```bash\ncat > r.md <<EOF\nDONE_W7\nEOF\n```" },
    ],
  });
  expect(fencedNarrative).not.toContain("FLEETWRAP_CLEANUP_RECEIPT_MISSING");
});

test("R2-5: the report reader rejects symlinks to non-report targets, `..` paths, FIFOs and oversize files", async () => {
  const { readReport, REPORT_MAX_BYTES } = await import("../lib/report-reader.mjs");
  const root = mkdtempSync(path.join(tmpdir(), "fleet-wrap-reader-"));
  try {
    const sentinel = "SENTINEL-DO-NOT-ECHO";
    writeFileSync(path.join(root, "private.bin"), `${RECEIPT}\n${sentinel}\n`);
    writeFileSync(path.join(root, "real.md"), `${RECEIPT}\n`);
    symlinkSync(path.join(root, "private.bin"), path.join(root, "cited.md"));
    symlinkSync(path.join(root, "real.md"), path.join(root, "alias.md"));
    mkdirSync(path.join(root, "sub"));

    expect(readReport(path.join(root, "cited.md"))).toBeNull();
    expect(readReport(`${root}/sub/../real.md`)).toBeNull();
    expect(readReport(path.join(root, "real.md"))).toContain("CLEANUP RECEIPT");
    expect(readReport(path.join(root, "alias.md"))).toContain("CLEANUP RECEIPT");

    const fifo = path.join(root, "pipe.md");
    expect(spawnSync("mkfifo", [fifo]).status).toBe(0);
    expect(readReport(fifo)).toBeNull();

    writeFileSync(path.join(root, "big.md"), "x".repeat(REPORT_MAX_BYTES + 1));
    expect(readReport(path.join(root, "big.md"))).toBeNull();
    writeFileSync(path.join(root, "edge.md"), "x".repeat(REPORT_MAX_BYTES));
    expect(readReport(path.join(root, "edge.md"))?.length).toBe(REPORT_MAX_BYTES);

    const hook = path.join(here, "..", "scripts", "fleet-wrap-gate-hook.mjs");
    const run = spawnSync(process.execPath, [hook], {
      input: JSON.stringify({
        hook_event_name: "Stop",
        transcript: {
          events: [
            { role: "user", text: "finish" },
            { role: "assistant", text: `DONE — https://github.com/EtanHey/golems/pull/88. Report: ${path.join(root, "cited.md")}` },
          ],
        },
      }),
      encoding: "utf8",
      timeout: 5_000,
    });
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout).systemMessage).toContain("FLEETWRAP_CLEANUP_RECEIPT_MISSING");
    expect(run.stdout).not.toContain(sentinel);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const realWatch = greens.find(fx => fx.file === "26-real-orc-watch-task-state.json");
test("real Orc watch shape passes as Claude JSONL and a running Bash task", () => {
  const raw = realWatch.events.map(e => ({
    type: e.role === "tool" ? "user" : e.role,
    message: { role: e.role === "tool" ? "user" : e.role, content: e.role === "tool"
      ? [{ type: "tool_result", tool_use_id: "watch", content: e.text }]
      : [...(e.tools ?? []).map(t => ({ type: "tool_use", id: "watch", ...t })), ...(e.text ? [{ type: "text", text: e.text }] : [])] },
  }));
  expect(detectFleetWrap(raw, { state: realWatch.state }).verdict).toBe("PASS");
});

const watchCommand = realWatch.events[0].tools[0].input.command;
for (const [name, command] of [
  ["write", watchCommand.replace('sleep 10;', 'sleep 10; echo changed > out.txt;')],
  ["awk write", watchCommand.replace('print substr($0,1,220)', 'print > "out.txt"')],
  ["awk launch", watchCommand.replace('print substr($0,1,220)', 'system("gh pr list")')],
  ["substitution", watchCommand.replace('f=collab/topic.md', 'f=$(curl https://example.com)')],
  ["second loop", watchCommand + '; while true; do sleep 10; done'],
]) {
  test(`an event watch with ${name} still emits the exact loop violation`, () => {
    const result = detectFleetWrap({ events: [{ role: "assistant", text: "Standing down.", tools: [{ name: "Bash", input: { command, run_in_background: true } }] }] });
    expect(result.violations.map(v => v.code)).toContain("FLEETWRAP_LOOP_ALIVE");
  });
}

for (const name of ["CronCreate", "ScheduleWakeup"]) {
  test(`an exempt watch cannot excuse a separate ${name}`, () => {
    const result = detectFleetWrap({ events: [{ role: "assistant", text: "Standing down.", tools: [realWatch.events[0].tools[0], { name, input: { prompt: "health-watch" } }] }] });
    expect(result.violations.map(v => v.code)).toContain("FLEETWRAP_CRON_ALIVE");
  });
}

test("an exempt same-turn watch cannot excuse an independently live loop", () => {
  const result = detectFleetWrap(realWatch, { state: { loops: [{ id: "forgotten", status: "active", command: "while true; do sleep 10; done" }] } });
  expect(result.violations.map(v => v.code)).toContain("FLEETWRAP_LOOP_ALIVE");
});

test("rg option-shaped patterns cannot launch a preprocessor under the watch exemption", () => {
  const command = 'f=collab/topic.md; while true; do sleep 10; if rg -q "--pre=./agent" "$f"; then exit 0; fi; done';
  const result = detectFleetWrap({ events: [{ role: "assistant", text: "Standing down.", tools: [{ name: "Bash", input: { command, run_in_background: true } }] }] });
  expect(result.violations.map(v => v.code)).toContain("FLEETWRAP_LOOP_ALIVE");
});
