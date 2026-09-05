import { execFile } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

function defaultRun(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

export function readRegistryRecords(stateDir) {
  if (!stateDir || !existsSync(stateDir)) return [];
  const records = [];
  for (const entry of readdirSync(stateDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const statePath = path.join(stateDir, entry.name, "state.json");
    if (!existsSync(statePath)) continue;
    try {
      const record = JSON.parse(readFileSync(statePath, "utf8"));
      if (record && typeof record === "object") records.push(record);
    } catch {
      // A malformed record is ignored; absence of unique UUID evidence fails closed later.
    }
  }
  return records;
}

export function findRegistryRecordByUuid(records, surfaceUuid) {
  const key = typeof surfaceUuid === "string" ? surfaceUuid.trim().toLowerCase() : "";
  if (!key || !key.includes("-")) return null;
  const matches = records.filter(
    (record) =>
      typeof record?.surface_uuid === "string" && record.surface_uuid.trim().toLowerCase() === key,
  );
  return matches.length === 1 ? matches[0] : null;
}

export async function inspectGitArtifact(worktreePath, { run = defaultRun } = {}) {
  let statusOutput;
  try {
    ({ stdout: statusOutput } = await run("git", [
      "-C",
      worktreePath,
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]));
  } catch (error) {
    return {
      status: "unknown",
      uncommitted: null,
      unpushed: null,
      path: worktreePath,
      reason: `git status failed: ${errorText(error)}`,
    };
  }

  const statusLines = String(statusOutput).split("\n").filter(Boolean);
  const uncommitted = statusLines.length > 0;
  const untrackedCount = statusLines.filter((line) => line.startsWith("?? ")).length;

  let upstream;
  try {
    ({ stdout: upstream } = await run("git", [
      "-C",
      worktreePath,
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ]));
  } catch (error) {
    return {
      status: uncommitted ? "uncommitted" : "unknown",
      uncommitted,
      untracked_count: untrackedCount,
      unpushed: null,
      path: worktreePath,
      reason: `upstream is not verifiable: ${errorText(error)}`,
    };
  }

  let ahead;
  try {
    const result = await run("git", [
      "-C",
      worktreePath,
      "rev-list",
      "--count",
      `${String(upstream).trim()}..HEAD`,
    ]);
    ahead = Number.parseInt(String(result.stdout).trim(), 10);
    if (!Number.isInteger(ahead) || ahead < 0) throw new Error("invalid ahead count");
  } catch (error) {
    return {
      status: uncommitted ? "uncommitted" : "unknown",
      uncommitted,
      untracked_count: untrackedCount,
      unpushed: null,
      path: worktreePath,
      reason: `unpushed count is not verifiable: ${errorText(error)}`,
    };
  }

  return {
    status: uncommitted ? "uncommitted" : ahead > 0 ? "unpushed" : "clean",
    uncommitted,
    untracked_count: untrackedCount,
    unpushed: ahead,
    path: worktreePath,
  };
}

function screenText(parsed, atomicReceipt) {
  return [parsed?.content, parsed?.screen_preview, parsed?.parsed?.response, atomicReceipt?.text]
    .filter((value) => typeof value === "string")
    .join("\n");
}

function screenBranch(raw) {
  const statusMatch = raw.match(/(?:^|\n)\s*⎇\s*([^|\n]+?)(?:\s*\||\n)/);
  return statusMatch?.[1].trim() ?? null;
}

function gitCandidates(root, depth = 2) {
  if (!root || !existsSync(root)) return [];
  const found = [];
  const visit = (dir, remaining) => {
    if (existsSync(path.join(dir, ".git"))) {
      found.push(dir);
      return;
    }
    if (remaining <= 0) return;
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        visit(path.join(dir, entry.name), remaining - 1);
      }
    }
  };
  visit(root, depth);
  return found;
}

function parseWorktreeList(raw, branch) {
  const target = `refs/heads/${branch}`;
  const matches = [];
  for (const block of String(raw).trim().split(/\n\n+/)) {
    const lines = block.split("\n");
    const worktree = lines.find((line) => line.startsWith("worktree "))?.slice(9);
    const branchLine = lines.find((line) => line.startsWith("branch "))?.slice(7);
    if (worktree && branchLine === target) matches.push(worktree);
  }
  return matches;
}

async function findWorktreeByBranch(branch, gitsDir, run) {
  if (!branch) return null;
  const paths = new Set();
  const inspectedRoots = new Set();
  for (const candidate of gitCandidates(gitsDir)) {
    let root;
    try {
      const result = await run("git", ["-C", candidate, "rev-parse", "--show-toplevel"]);
      root = String(result.stdout).trim();
    } catch {
      continue;
    }
    if (!root || inspectedRoots.has(root)) continue;
    inspectedRoots.add(root);
    try {
      const result = await run("git", ["-C", root, "worktree", "list", "--porcelain"]);
      for (const match of parseWorktreeList(result.stdout, branch)) paths.add(match);
    } catch {
      // Unknown/ambiguous stays null and therefore KEEP.
    }
  }
  return paths.size === 1 ? [...paths][0] : null;
}

async function resolveArtifactPath(surface, registry, parsed, atomicReceipt, { gitsDir, run, branchCache }) {
  if (
    typeof registry?.worktree_path === "string" &&
    registry.worktree_path &&
    existsSync(registry.worktree_path)
  ) {
    return registry.worktree_path;
  }

  const raw = screenText(parsed, atomicReceipt);
  const branch = screenBranch(raw);
  if (!branch) return null;
  if (!branchCache.has(branch)) {
    branchCache.set(branch, findWorktreeByBranch(branch, gitsDir, run));
  }
  return branchCache.get(branch);
}

function laneEvidence(registry) {
  const harvest = registry?.harvestability;
  if (harvest?.closeable === true && harvest?.closure_artifact_verified === true) {
    return {
      open_lane: "closed",
      harvest_verified: true,
      reported: harvest.report_exists === true,
    };
  }
  const state = String(registry?.state ?? "").toLowerCase();
  const task = String(registry?.task_summary ?? "").trim();
  if (["creating", "booting", "ready", "working"].includes(state) || (task && task !== "(auto-discovered)" && state !== "done")) {
    return { open_lane: "open", harvest_verified: false, reported: false };
  }
  return { open_lane: "unknown", harvest_verified: false, reported: false };
}

function processLiveness(controlState) {
  if (["dead", "stale_surface"].includes(controlState)) return false;
  if (["ready", "busy", "working", "thinking", "booting"].includes(controlState)) return true;
  return null;
}

export function createLiveAdapter({
  mcp,
  run = defaultRun,
  stateDir = path.join(homedir(), ".local", "state", "cmux-agents"),
  gitsDir = path.join(homedir(), "Gits"),
} = {}) {
  if (!mcp || typeof mcp.callTool !== "function") throw new Error("createLiveAdapter requires an MCP client");
  const branchCache = new Map();

  return {
    async listSurfaces(options) {
      const result = await mcp.callTool("list_surfaces", { verbose: options?.verbose === true });
      if (result?.ok === false) throw new Error(result.error ?? "list_surfaces failed");
      if (!Array.isArray(result?.surfaces)) throw new Error("verbose list_surfaces omitted surfaces");
      return result.surfaces;
    },

    async atomicRead(surfaceRef) {
      const result = await run("cmux", [
        "--json",
        "--id-format",
        "both",
        "read-screen",
        "--surface",
        surfaceRef,
        "--lines",
        "1",
      ]);
      return JSON.parse(result.stdout);
    },

    async readParsedScreen(surfaceRef) {
      const result = await mcp.callTool("read_screen", {
        surface: surfaceRef,
        lines: 50,
        scrollback: true,
        raw: true,
      });
      if (result?.ok === false) throw new Error(result.error ?? "read_screen failed");
      return result;
    },

    async collectEvidence(surface, { atomicReceipt, parsed }) {
      const registry = findRegistryRecordByUuid(readRegistryRecords(stateDir), surface.id);
      const artifactPath = await resolveArtifactPath(surface, registry, parsed, atomicReceipt, {
        gitsDir,
        run,
        branchCache,
      });
      const artifact = artifactPath
        ? await inspectGitArtifact(artifactPath, { run })
        : {
            status: "unknown",
            uncommitted: null,
            unpushed: null,
            reason: "no UUID-matched worktree or unique branch path",
          };
      const controlState = parsed?.parsed?.control_state ?? parsed?.control_state;
      return {
        registry,
        process_alive: processLiveness(controlState),
        artifact,
        ...laneEvidence(registry),
      };
    },
  };
}
