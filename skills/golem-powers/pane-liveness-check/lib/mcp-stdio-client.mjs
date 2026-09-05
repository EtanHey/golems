import { spawn } from "node:child_process";
import readline from "node:readline";

const DEFAULT_PROTOCOL_VERSION = "2025-03-26";

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

export class McpStdioClient {
  constructor({
    command = "cmuxlayer",
    args = [],
    env = {},
    timeoutMs = 10_000,
    spawnImpl = spawn,
  } = {}) {
    this.command = command;
    this.args = args;
    this.env = env;
    this.timeoutMs = timeoutMs;
    this.spawnImpl = spawnImpl;
    this.child = null;
    this.readline = null;
    this.pending = new Map();
    this.nextId = 1;
    this.stderr = "";
    this.connected = false;
    this.connecting = null;
    this.closed = false;
  }

  connect() {
    if (this.connected) return Promise.resolve();
    if (this.connecting) return this.connecting;
    if (this.closed) return Promise.reject(new Error("MCP client is closed"));

    this.connecting = this.#connect();
    return this.connecting;
  }

  async #connect() {
    this.child = this.spawnImpl(this.command, this.args, {
      env: { ...process.env, ...this.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stderr?.on("data", (chunk) => {
      this.stderr = `${this.stderr}${String(chunk)}`.slice(-16_384);
    });
    this.child.once("error", (error) => this.#rejectAll(error));
    this.child.once("exit", (code, signal) => {
      if (!this.closed && this.pending.size > 0) {
        this.#rejectAll(new Error(`MCP process exited code=${code} signal=${signal ?? "none"}`));
      }
    });
    this.readline = readline.createInterface({ input: this.child.stdout });
    this.readline.on("line", (line) => this.#onLine(line));

    await this.#request("initialize", {
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "pane-liveness-check", version: "1" },
    });
    this.#notify("notifications/initialized", {});
    this.connected = true;
  }

  #onLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id === undefined || message.id === null) return;
    const pending = this.pending.get(String(message.id));
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(String(message.id));
    if (message.error) {
      pending.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
      return;
    }
    pending.resolve(message.result);
  }

  #request(method, params) {
    if (!this.child?.stdin?.writable) {
      return Promise.reject(new Error("MCP stdin is not writable"));
    }
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(String(id));
        const stderr = this.stderr.trim();
        reject(new Error(`MCP ${method} timed out after ${this.timeoutMs}ms${stderr ? `: ${stderr}` : ""}`));
      }, this.timeoutMs);
      timer.unref?.();
      this.pending.set(String(id), { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(String(id));
        reject(error);
      });
    });
  }

  #notify(method, params) {
    if (!this.child?.stdin?.writable) return;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  #rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  async callTool(name, args = {}) {
    await this.connect();
    const result = await this.#request("tools/call", { name, arguments: args });
    if (result?.isError) {
      const detail = Array.isArray(result.content)
        ? result.content.map((item) => item?.text).filter(Boolean).join("\n")
        : "tool returned isError";
      throw new Error(detail || "tool returned isError");
    }
    return result?.structuredContent ?? result;
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.connected = false;
    this.#rejectAll(new Error("MCP client closed"));
    this.readline?.close();
    const child = this.child;
    if (!child) return;
    child.stdin?.end();
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        resolve();
      }, 500);
      timer.unref?.();
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

export function describeMcpError(error) {
  return errorText(error);
}
