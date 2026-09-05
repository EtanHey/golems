import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createLiveAdapter,
  findRegistryRecordByUuid,
  inspectGitArtifact,
  readRegistryRecords,
} from "../lib/live-evidence.mjs";

test("registry lookup keys on surface_uuid and ignores a matching numeric ref", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pane-liveness-registry-"));
  try {
    const staleDir = path.join(dir, "stale");
    const exactDir = path.join(dir, "exact");
    mkdirSync(staleDir);
    mkdirSync(exactDir);
    writeFileSync(
      path.join(staleDir, "state.json"),
      JSON.stringify({ agent_id: "stale", surface_id: "surface:230", surface_uuid: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" }),
    );
    writeFileSync(
      path.join(exactDir, "state.json"),
      JSON.stringify({ agent_id: "exact", surface_id: "surface:999", surface_uuid: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB" }),
    );

    const records = readRegistryRecords(dir);
    expect(findRegistryRecordByUuid(records, "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB")?.agent_id).toBe("exact");
    expect(findRegistryRecordByUuid(records, "surface:230")).toBeNull();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Git inspection uses only read-only commands and reports dirty plus ahead", async () => {
  const calls = [];
  const run = async (command, args) => {
    calls.push([command, args]);
    const joined = args.join(" ");
    if (joined.includes("status --porcelain=v1 --untracked-files=all")) {
      return { stdout: "?? skills/golem-powers/convention-audit/\n", stderr: "" };
    }
    if (joined.includes("rev-parse --abbrev-ref --symbolic-full-name")) {
      return { stdout: "origin/feature\n", stderr: "" };
    }
    if (joined.includes("rev-list --count")) return { stdout: "2\n", stderr: "" };
    throw new Error(`unexpected command: ${command} ${joined}`);
  };

  const artifact = await inspectGitArtifact("/tmp/example-worktree", { run });
  expect(artifact.status).toBe("uncommitted");
  expect(artifact.uncommitted).toBe(true);
  expect(artifact.untracked_count).toBe(1);
  expect(artifact.unpushed).toBe(2);
  expect(calls.map(([, args]) => args[2])).toEqual(["status", "rev-parse", "rev-list"]);
  expect(calls.flatMap(([, args]) => args)).not.toContain("checkout");
  expect(calls.flatMap(([, args]) => args)).not.toContain("fetch");
  expect(calls.flatMap(([, args]) => args)).not.toContain("reset");
});

test("missing upstream fails closed as UNKNOWN", async () => {
  const run = async (_command, args) => {
    if (args.includes("status")) return { stdout: "", stderr: "" };
    const error = new Error("no upstream configured");
    error.stderr = "fatal: no upstream configured";
    throw error;
  };

  const artifact = await inspectGitArtifact("/tmp/example-worktree", { run });
  expect(artifact.status).toBe("unknown");
  expect(artifact.unpushed).toBeNull();
  expect(artifact.reason).toContain("upstream");
});

test("live adapter requests verbose surface IDs and atomic cmux UUID receipts", async () => {
  const mcpCalls = [];
  const processCalls = [];
  const uuid = "CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC";
  const mcp = {
    async callTool(name, args) {
      mcpCalls.push([name, args]);
      if (name === "list_surfaces") {
        return { surfaces: [{ id: uuid, ref: "surface:9", title: "worker", type: "terminal" }] };
      }
      if (name === "read_screen") {
        return { surface: "surface:9", parsed: { status: "working", control_state: "busy" }, content: "" };
      }
      throw new Error(`unexpected MCP tool ${name}`);
    },
  };
  const run = async (command, args) => {
    processCalls.push([command, args]);
    if (command === "cmux") return { stdout: JSON.stringify({ surface_id: uuid, surface_ref: "surface:9", text: "" }), stderr: "" };
    throw new Error("Git must not run without a verified worktree path");
  };
  const adapter = createLiveAdapter({ mcp, run, stateDir: "/missing", gitsDir: "/missing" });

  const listed = await adapter.listSurfaces({ verbose: true });
  const receipt = await adapter.atomicRead("surface:9", { expectedUuid: uuid });
  const screen = await adapter.readParsedScreen("surface:9");
  const evidence = await adapter.collectEvidence(listed[0], { atomicReceipt: receipt, parsed: screen });

  expect(mcpCalls[0]).toEqual(["list_surfaces", { verbose: true }]);
  expect(mcpCalls[1][0]).toBe("read_screen");
  expect(processCalls[0]).toEqual([
    "cmux",
    ["--json", "--id-format", "both", "read-screen", "--surface", "surface:9", "--lines", "1"],
  ]);
  expect(evidence.process_alive).toBe(true);
  expect(evidence.artifact.status).toBe("unknown");
  expect(evidence.owner).toBeUndefined();
});

test("current branch worktree outranks a stale registry launch directory", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "pane-liveness-path-"));
  try {
    const stateDir = path.join(root, "state");
    const agentDir = path.join(stateDir, "agent");
    const gitsDir = path.join(root, "Gits");
    const repo = path.join(gitsDir, "brainlayer");
    const actualWorktree = path.join(root, "worktrees", "pause-fix");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(path.join(repo, ".git"), { recursive: true });
    mkdirSync(actualWorktree, { recursive: true });

    const uuid = "DDDDDDDD-DDDD-4DDD-8DDD-DDDDDDDDDDDD";
    writeFileSync(
      path.join(agentDir, "state.json"),
      JSON.stringify({ surface_uuid: uuid, launch_cwd: repo, state: "idle" }),
    );

    const inspected = [];
    const run = async (_command, args) => {
      const joined = args.join(" ");
      if (joined.includes("rev-parse --show-toplevel")) return { stdout: `${repo}\n`, stderr: "" };
      if (joined.includes("worktree list --porcelain")) {
        return {
          stdout: `worktree ${repo}\nbranch refs/heads/master\n\nworktree ${actualWorktree}\nbranch refs/heads/fix/pause-actually-pauses\n`,
          stderr: "",
        };
      }
      if (joined.includes("status --porcelain=v1")) {
        inspected.push(args[1]);
        return { stdout: "", stderr: "" };
      }
      if (joined.includes("rev-parse --abbrev-ref")) return { stdout: "origin/fix/pause-actually-pauses\n", stderr: "" };
      if (joined.includes("rev-list --count")) return { stdout: "2\n", stderr: "" };
      throw new Error(`unexpected git call: ${joined}`);
    };
    const mcp = { callTool: async () => ({}) };
    const adapter = createLiveAdapter({ mcp, run, stateDir, gitsDir });
    const evidence = await adapter.collectEvidence(
      { id: uuid, ref: "surface:280", title: "UNPUSHED-fix/pause-actually-pauses (2 commits)" },
      {
        atomicReceipt: { text: "⎇ fix/pause-actually-pauses | +60,-0" },
        parsed: { parsed: { control_state: "ready" } },
      },
    );

    expect(inspected).toEqual([actualWorktree]);
    expect(evidence.artifact.unpushed).toBe(2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a stale title and launch directory cannot substitute for current worktree proof", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "pane-liveness-stale-title-"));
  try {
    const stateDir = path.join(root, "state");
    const agentDir = path.join(stateDir, "agent");
    const launchDir = path.join(root, "repo");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(launchDir, { recursive: true });
    const uuid = "EEEEEEEE-EEEE-4EEE-8EEE-EEEEEEEEEEEE";
    writeFileSync(
      path.join(agentDir, "state.json"),
      JSON.stringify({ surface_uuid: uuid, launch_cwd: launchDir, state: "done" }),
    );
    const calls = [];
    const run = async (command, args) => {
      calls.push([command, args]);
      throw new Error("Git inspection requires current worktree evidence");
    };
    const adapter = createLiveAdapter({ mcp: { callTool: async () => ({}) }, run, stateDir, gitsDir: path.join(root, "missing") });
    const evidence = await adapter.collectEvidence(
      { id: uuid, ref: "surface:241", title: "UNPUSHED-old-title (2 commits)" },
      { atomicReceipt: { text: "shell exited" }, parsed: { parsed: { control_state: "dead" } } },
    );

    expect(calls).toEqual([]);
    expect(evidence.artifact.status).toBe("unknown");
    expect(evidence.process_alive).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing process and closure evidence remain unknown instead of verified", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "pane-liveness-unknown-"));
  try {
    const stateDir = path.join(root, "state");
    const agentDir = path.join(stateDir, "agent");
    mkdirSync(agentDir, { recursive: true });
    const uuid = "FFFFFFFF-FFFF-4FFF-8FFF-FFFFFFFFFFFF";
    writeFileSync(
      path.join(agentDir, "state.json"),
      JSON.stringify({
        surface_uuid: uuid,
        state: "done",
        harvestability: { closeable: true, report_exists: true },
      }),
    );
    const adapter = createLiveAdapter({
      mcp: { callTool: async () => ({}) },
      run: async () => { throw new Error("Git must not run without worktree proof"); },
      stateDir,
      gitsDir: path.join(root, "missing"),
    });
    const evidence = await adapter.collectEvidence(
      { id: uuid, ref: "surface:9", title: "worker" },
      { atomicReceipt: { text: "" }, parsed: { parsed: {} } },
    );

    expect(evidence.process_alive).toBeNull();
    expect(evidence.open_lane).toBe("unknown");
    expect(evidence.harvest_verified).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
