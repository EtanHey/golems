import {
  closeSync,
  fstatSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const MAX_STOP_INPUT_BYTES = 512 * 1024;
export const MAX_TRANSCRIPT_TAIL_BYTES = 512 * 1024;
export const MAX_STATE_FILE_BYTES = 256 * 1024;
export const MAX_STATE_FILES = 200;
export const MAX_STATE_DIR_ENTRIES = 120;

const ARRAY_STATE_KEYS = [
  "queue",
  "queueItems",
  "queue_items",
  "backlog",
  "tasks",
  "workers",
  "agents",
  "panes",
  "seats",
  "watches",
  "monitors",
  "crons",
  "loops",
  "scheduledTasks",
  "scheduled_tasks",
];
const SCALAR_STATE_KEYS = ["session_id", "sessionId", "seatRole", "role"];
const REGISTRY_STATE_KEYS = [
  "monitorRegistry",
  "registry",
  "nowMs",
  "heartbeatWindowMs",
  "activeChannel",
  "activeSprint",
  "standDownAcked",
];

export class StopHookInputError extends Error {
  constructor(code, message, receipt = {}) {
    super(message);
    this.name = "StopHookInputError";
    this.code = code;
    this.receipt = receipt;
  }
}

function emptyReceipt(stdinBytes = 0) {
  return {
    schema: "golems.stop-read.v1",
    stdinBytes,
    transcriptBytesRead: 0,
    transcriptBytesTotal: 0,
    transcriptTail: false,
    stateBytesRead: 0,
    stateFilesAttempted: 0,
    bytesRead: stdinBytes,
  };
}

function addReadBytes(receipt, field, count) {
  receipt[field] += count;
  receipt.bytesRead += count;
}

function parseJsonOrJsonl(raw, { source = "", tail = false } = {}) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim());
  const looksJsonl =
    tail ||
    source.endsWith(".jsonl") ||
    (lines.length > 1 && lines.every((line) => {
      try {
        JSON.parse(line);
        return true;
      } catch {
        return false;
      }
    }));
  if (looksJsonl) return lines.map((line) => JSON.parse(line));
  return JSON.parse(trimmed);
}

function readExactRange(fd, start, length) {
  const buffer = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    const count = readSync(fd, buffer, offset, length - offset, start + offset);
    if (count === 0) break;
    offset += count;
  }
  return buffer.subarray(0, offset);
}

function readTranscriptFile(filePath, receipt, maxBytes = MAX_TRANSCRIPT_TAIL_BYTES) {
  if (typeof filePath !== "string" || !filePath) return null;
  const fd = openSync(filePath, "r");
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return null;

    receipt.transcriptBytesTotal = stat.size;
    if (stat.size <= maxBytes) {
      const raw = readExactRange(fd, 0, stat.size);
      addReadBytes(receipt, "transcriptBytesRead", raw.byteLength);
      return parseJsonOrJsonl(raw.toString("utf8"), { source: filePath });
    }

    receipt.transcriptTail = true;
    const tailStart = stat.size - maxBytes;
    const readStart = Math.max(0, tailStart - 1);
    const raw = readExactRange(fd, readStart, stat.size - readStart);
    addReadBytes(receipt, "transcriptBytesRead", raw.byteLength);

    let completeTail = raw;
    if (tailStart > 0) {
      if (raw[0] === 0x0a) {
        completeTail = raw.subarray(1);
      } else {
        const firstNewline = raw.indexOf(0x0a);
        if (firstNewline === -1) {
          throw new StopHookInputError(
            "oversized-transcript-unreadable",
            `oversized transcript ${filePath} has no complete JSONL record in its last ${maxBytes} bytes`,
            receipt,
          );
        }
        completeTail = raw.subarray(firstNewline + 1);
      }
    }

    try {
      return parseJsonOrJsonl(completeTail.toString("utf8"), { source: filePath, tail: true });
    } catch (error) {
      throw new StopHookInputError(
        "oversized-transcript-unreadable",
        `oversized transcript ${filePath} tail is not valid JSONL: ${error.message}`,
        receipt,
      );
    }
  } finally {
    closeSync(fd);
  }
}

function readStateFile(filePath, receipt) {
  if (typeof filePath !== "string" || !filePath) return null;
  const fd = openSync(filePath, "r");
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return null;
    if (stat.size > MAX_STATE_FILE_BYTES) {
      throw new StopHookInputError(
        "oversized-state",
        `durable state file ${filePath} exceeds ${MAX_STATE_FILE_BYTES} bytes`,
        receipt,
      );
    }
    const raw = readExactRange(fd, 0, stat.size);
    addReadBytes(receipt, "stateBytesRead", raw.byteLength);
    return parseJsonOrJsonl(raw.toString("utf8"), { source: filePath });
  } finally {
    closeSync(fd);
  }
}

function mergeState(base, patch, arrayKey = null) {
  if (patch == null) return base;
  let normalized;
  if (arrayKey) {
    normalized = Array.isArray(patch)
      ? { [arrayKey]: patch }
      : patch && typeof patch === "object" && Array.isArray(patch[arrayKey])
        ? patch
        : { [arrayKey]: [patch] };
  } else {
    normalized = Array.isArray(patch) ? { tasks: patch } : patch;
  }
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) return base;

  const result = { ...base, ...normalized };
  for (const key of ARRAY_STATE_KEYS) {
    const value = normalized[key];
    if (Array.isArray(value)) {
      result[key] = [...(Array.isArray(base[key]) ? base[key] : []), ...value];
    } else if (value && typeof value === "object") {
      result[key] = {
        ...(base[key] && typeof base[key] === "object" && !Array.isArray(base[key])
          ? base[key]
          : {}),
        ...value,
      };
    }
  }
  return result;
}

function safeSessionId(value) {
  if (typeof value !== "string" || !value) return null;
  if (value === "." || value === ".." || path.isAbsolute(value)) return null;
  return path.basename(value) === value ? value : null;
}

function readTaskStateDir(dir, sessionId, receipt) {
  const tasks = [];
  if (typeof dir !== "string" || !dir) return { tasks };
  const top = readdirSync(dir, { withFileTypes: true }).slice(0, MAX_STATE_DIR_ENTRIES);
  let taskDirs;
  const scopedSessionId = safeSessionId(sessionId);
  const sessionScopeProvided = sessionId !== undefined && sessionId !== null && sessionId !== "";
  if (sessionScopeProvided && !scopedSessionId) return { tasks };
  if (scopedSessionId) {
    const scopedDir = path.join(dir, scopedSessionId);
    try {
      taskDirs = statSync(scopedDir).isDirectory() ? [scopedDir] : [];
    } catch {
      taskDirs = top.some((entry) => entry.isFile() && entry.name.endsWith(".json")) ? [dir] : [];
    }
  } else {
    taskDirs = top.filter((entry) => entry.isDirectory()).map((entry) => path.join(dir, entry.name));
  }

  let filesAttempted = 0;
  for (const subdir of taskDirs) {
    const children = readdirSync(subdir, { withFileTypes: true }).slice(0, MAX_STATE_DIR_ENTRIES);
    for (const child of children) {
      if (!child.name.endsWith(".json")) continue;
      if (filesAttempted >= MAX_STATE_FILES) return { tasks };
      filesAttempted += 1;
      receipt.stateFilesAttempted += 1;
      if (!child.isFile()) continue;
      const filePath = path.join(subdir, child.name);
      const fd = openSync(filePath, "r");
      let raw;
      try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.size > MAX_STATE_FILE_BYTES) continue;
        raw = readExactRange(fd, 0, stat.size);
      } finally {
        closeSync(fd);
      }
      addReadBytes(receipt, "stateBytesRead", raw.byteLength);
      const parsed = JSON.parse(raw.toString("utf8"));
      if (parsed && typeof parsed === "object") tasks.push(parsed);
    }
  }
  return { tasks };
}

function stateFromPayload(payload, receipt, options) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const hasExplicitState =
    (payload.state && typeof payload.state === "object") ||
    payload.state_path ||
    payload.statePath ||
    payload.cron_state_path ||
    payload.cronStatePath ||
    payload.loop_state_path ||
    payload.loopStatePath ||
    payload.tasks_dir ||
    payload.tasksDir ||
    [...ARRAY_STATE_KEYS, ...REGISTRY_STATE_KEYS].some((key) => payload[key] != null);
  let state = {};
  state = mergeState(state, payload.state);

  const directState = {};
  for (const key of [...ARRAY_STATE_KEYS, ...SCALAR_STATE_KEYS, ...REGISTRY_STATE_KEYS]) {
    if (payload[key] != null) directState[key] = payload[key];
  }
  state = mergeState(state, directState);

  const statePath = payload.state_path ?? payload.statePath;
  if (statePath) state = mergeState(state, readStateFile(statePath, receipt));

  const cronPath = payload.cron_state_path ?? payload.cronStatePath;
  if (cronPath) state = mergeState(state, readStateFile(cronPath, receipt), "crons");

  const loopPath = payload.loop_state_path ?? payload.loopStatePath;
  if (loopPath) state = mergeState(state, readStateFile(loopPath, receipt), "loops");

  const tasksDir = payload.tasks_dir ?? payload.tasksDir;
  const sessionId = payload.session_id ?? payload.sessionId;
  if (tasksDir) {
    state = mergeState(state, readTaskStateDir(tasksDir, sessionId, receipt));
  } else if (options.discoverDefaultTasks && !hasExplicitState) {
    const defaultDir =
      options.defaultTasksDir ??
      process.env.FLEET_WRAP_GATE_TASKS_DIR ??
      path.join(homedir(), ".claude", "tasks");
    try {
      state = mergeState(state, readTaskStateDir(defaultDir, sessionId, receipt));
    } catch {
      // Default discovery remains best-effort. Explicit state inputs fail loudly.
    }
  }
  return Object.keys(state).length > 0 ? state : null;
}

function transcriptFromPayload(payload, receipt) {
  if (payload == null) return null;
  if (typeof payload === "string" || Array.isArray(payload)) return payload;
  if (typeof payload !== "object") return null;

  if (payload.transcript != null) return payload.transcript;
  if (Array.isArray(payload.events)) return payload;
  if (payload.result != null) return payload;
  if (payload.type || payload.message) return payload;

  const transcriptPath = payload.transcript_path ?? payload.transcriptPath;
  if (transcriptPath) return readTranscriptFile(transcriptPath, receipt);

  const last = payload.last_assistant_message ?? payload.assistant_message ?? payload.response;
  if (typeof last === "string") return { result: last };
  return null;
}

export function loadStopHookContext(payload, options = {}) {
  const receipt = options.receipt ?? emptyReceipt(options.stdinBytes ?? 0);
  try {
    const transcript = transcriptFromPayload(payload, receipt);
    const state = stateFromPayload(payload, receipt, options);
    return {
      payload,
      transcript,
      state,
      sessionId: payload?.session_id ?? payload?.sessionId ?? null,
      receipt,
    };
  } catch (error) {
    if (error instanceof StopHookInputError) {
      error.receipt = receipt;
      throw error;
    }
    throw new StopHookInputError(
      "invalid-input",
      `Stop hook input is invalid or unreadable: ${error.message}`,
      receipt,
    );
  }
}

function readBoundedStdin(maxBytes = MAX_STOP_INPUT_BYTES) {
  const chunks = [];
  let total = 0;
  const buffer = Buffer.allocUnsafe(64 * 1024);
  for (;;) {
    const count = readSync(0, buffer, 0, buffer.length, null);
    if (count === 0) break;
    total += count;
    if (total > maxBytes) {
      throw new StopHookInputError(
        "oversized-stdin",
        `Stop hook stdin exceeds ${maxBytes} bytes; transcript tail could not be located safely`,
        emptyReceipt(total),
      );
    }
    chunks.push(Buffer.from(buffer.subarray(0, count)));
  }
  return { raw: Buffer.concat(chunks, total).toString("utf8"), bytes: total };
}

export function readStopHookContext(options = {}) {
  const { raw, bytes } = readBoundedStdin(options.maxInputBytes);
  const receipt = emptyReceipt(bytes);
  if (!raw.trim()) return loadStopHookContext(null, { ...options, receipt });
  let payload;
  try {
    payload = parseJsonOrJsonl(raw);
  } catch (error) {
    throw new StopHookInputError(
      "malformed-stdin",
      `Stop hook stdin is not valid JSON or JSONL: ${error.message}`,
      receipt,
    );
  }
  return loadStopHookContext(payload, { ...options, receipt });
}

export function publishStopHookReceipt(receipt) {
  const fd = Number(process.env.STOP_TELEMETRY_FD);
  if (!Number.isInteger(fd) || fd < 3 || !receipt) return;
  try {
    writeSync(fd, `${JSON.stringify(receipt)}\n`, null, "utf8");
  } catch {
    // Decision telemetry cannot alter the hook's decision path.
  }
}

export function readerFailurePayload(error, gateName) {
  if (error instanceof StopHookInputError && error.code === "malformed-stdin") return null;
  const status = error instanceof StopHookInputError && error.code.startsWith("oversized-")
    ? "skipped"
    : "error";
  const message = error instanceof StopHookInputError
    ? error.message
    : "internal evaluation failure";
  return {
    systemMessage: `${gateName} ${status}: ${message}`,
  };
}
