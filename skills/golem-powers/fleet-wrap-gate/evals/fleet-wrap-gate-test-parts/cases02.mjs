import { test, expect, setDefaultTimeout, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, spawnSync, tmpdir, fileURLToPath, path, detectFleetWrap, here, redDir, greenDir, loadFixtures, reds, greens, RECEIPT, receiptCodes, cli, runCli, realWatch, watchCommand, simpleWatch } from "./common.mjs";


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
  const { readReport, REPORT_MAX_BYTES } = await import("../../lib/report-reader.mjs");
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
test("real Orc watch shape passes as Claude JSONL and a running Bash task", () => {
  const raw = realWatch.events.map(e => ({
    type: e.role === "tool" ? "user" : e.role,
    message: { role: e.role === "tool" ? "user" : e.role, content: e.role === "tool"
      ? [{ type: "tool_result", tool_use_id: "watch", content: e.text }]
      : [...(e.tools ?? []).map(t => ({ type: "tool_use", id: "watch", ...t })), ...(e.text ? [{ type: "text", text: e.text }] : [])] },
  }));
  expect(detectFleetWrap(raw, { state: realWatch.state }).verdict).toBe("PASS");
});
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
for (const [name, command] of [
  ["E02 simple end anchor", simpleWatch + '; echo changed > out.txt'],
  ["E03 simple start anchor", 'echo changed > out.txt; ' + simpleWatch],
  ["E05 counted start anchor", 'echo changed > out.txt; ' + watchCommand],
  ["E07 pattern substitution", simpleWatch.replace('"event"', '"$(touch out.txt)"')],
  ["E10 event test required", 'f=collab/topic.md; while true; do sleep 10;\ndone'],
  ["E11 exit must be guarded", 'f=collab/topic.md; while true; do sleep 10; grep -q "event" "$f"; done'],
  ["E12 exact grep flags", simpleWatch.replace('grep -q', 'grep -rq')],
]) {
  test(`${name}: malformed watch remains an active loop`, () => {
    const result = detectFleetWrap({ events: [{ role: "assistant", text: "Standing down.", tools: [{ name: "Bash", input: { command, run_in_background: true } }] }] });
    expect(result.violations.map(v => v.code)).toContain("FLEETWRAP_LOOP_ALIVE");
  });
}

test("E13: a scheduled task cannot use the watch exemption", () => {
  const result = detectFleetWrap(realWatch, { state: { tasks: [{ status: "running", schedule: "*/5 * * * *", command: watchCommand, run_in_background: true }] } });
  expect(result.violations.map(v => v.code)).toContain("FLEETWRAP_LOOP_ALIVE");
});

test("E14: a loops registry watch remains independently active", () => {
  const result = detectFleetWrap(realWatch, { state: { loops: [{ status: "running", command: simpleWatch, run_in_background: true }] } });
  expect(result.violations.map(v => v.code)).toContain("FLEETWRAP_LOOP_ALIVE");
});

for (const name of ["ScheduleWakeup", "mcp__scheduler__schedule_wakeup"]) {
  test(`${name}: stop true ends the wakeup; absent or false re-arms`, () => {
    for (const input of [{ stop: true }, { stop: false }, {}]) {
      const result = detectFleetWrap({ events: [{ role: "assistant", text: "Standing down.", tools: [{ name, input }] }] });
      expect(result.verdict).toBe(input.stop === true ? "PASS" : "FLAG");
    }
  });
}

test("ScheduleWakeup stop cannot excuse CronCreate or a separate re-arm", () => {
  for (const name of ["CronCreate", "ScheduleWakeup"]) {
    const result = detectFleetWrap({ events: [{ role: "assistant", text: "Standing down.", tools: [
      { name: "ScheduleWakeup", input: { stop: true } }, { name, input: name === "CronCreate" ? { stop: true } : {} },
    ] }] });
    expect(result.violations.map(v => v.code)).toContain("FLEETWRAP_CRON_ALIVE");
  }
});
