import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

type JSONValue = null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue };
type Entry = JSONValue;
type NoulQuestion = {
  id: string;
  type: "noul";
  instructions: Entry;
  criteria?: { true?: Entry; false?: Entry };
  fallbackAnswer: number;
};
type ChoiceQuestion = {
  id: string;
  type: "choice";
  instructions: Entry;
  criteria: Record<string, Entry>;
  fallbackAnswer: string;
};
type ScoreQuestion = {
  id: string;
  type: "score";
  instructions: Entry;
  criteria: Entry[];
  fallbackAnswer: number;
};
export type JevQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export type JevAnswer = {
  questionId: string;
  type: JevQuestion["type"];
  answer: number | string;
  confidence: number | null;
  probabilities?: Record<string, number>;
  fallbackAnswer: number | string;
  acted: boolean;
  source: "jev" | "fallback";
};

export type JevRequest = {
  state: JSONValue;
  model: string;
  questions: Record<string, Omit<JevQuestion, "id" | "fallbackAnswer">>;
};
type JevResponse = {
  model: string;
  answers: Record<string, unknown>;
  usage: { input_tokens: number; output_tokens: number };
};
export type JevTransport = (request: JevRequest, apiKey: string) => Promise<JevResponse>;
export type JevOptions = {
  site: string;
  stateDir?: string;
  keyFile?: string;
  transport?: JevTransport;
  model?: string;
  timeoutMs?: number;
  lockWaitMs?: number;
};

const PRICE_PER_INPUT_TOKEN = 0.042 / 1_000_000;
const MAX_REQUEST_USD = 64_000 * PRICE_PER_INPUT_TOKEN;

export async function jev(state: JSONValue, questions: JevQuestion[], sanitizer: (state: JSONValue) => JSONValue, options: JevOptions): Promise<JevAnswer[]> {
  return runJev(state, questions, sanitizer, options, false);
}

export async function jevShadow(state: JSONValue, questions: JevQuestion[], sanitizer: (state: JSONValue) => JSONValue, options: JevOptions): Promise<JevAnswer[]> {
  const mode = siteMode(options.site);
  if (mode !== "shadow") throw new Error("jevShadow requires shadow mode");
  return runJev(state, questions, sanitizer, options, true, mode);
}

async function runJev(state: JSONValue, questions: JevQuestion[], sanitizer: (state: JSONValue) => JSONValue, options: JevOptions, returnShadow: boolean, resolvedMode?: "off" | "shadow" | "on"): Promise<JevAnswer[]> {
  validateQuestions(questions);
  const fallback = fallbackAnswers(questions);
  const stateDir = options.stateDir ?? join(homedir(), ".local", "state", "jev");
  try {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  } catch {
    return fallback;
  }

  let sanitized: JSONValue;
  try {
    sanitized = sanitizer(state);
    canonicalJSON(sanitized);
  } catch {
    appendDecisions(stateDir, decisionRows(options.site, hash("sanitizer_error"), questions, fallback, false, "sanitizer_error"));
    return fallback;
  }
  const stateHash = hash(canonicalJSON(sanitized));
  const mode = resolvedMode ?? siteMode(options.site);
  if (mode === "off") {
    appendDecisions(stateDir, decisionRows(options.site, stateHash, questions, fallback, false, "disabled"));
    return fallback;
  }

  const apiKey = loadApiKey(options.keyFile);
  if (!apiKey) {
    appendDecisions(stateDir, decisionRows(options.site, stateHash, questions, fallback, false, "missing_api_key"));
    return fallback;
  }

  const lock = join(stateDir, ".cost.lock");
  const timeoutMs = options.timeoutMs ?? 10_000;
  const lockWaitMs = options.lockWaitMs ?? 1_000;
  const lockToken = await acquireCostLockWithRetry(lock, timeoutMs + 60_000, lockWaitMs);
  if (!lockToken) {
    appendDecisions(stateDir, decisionRows(options.site, stateHash, questions, fallback, false, "cost_lock_busy"));
    return fallback;
  }

  const reservationId = randomUUID();
  try {
    const cap = dailyCap();
    if (spentToday(stateDir) + MAX_REQUEST_USD > cap) {
      appendDecisions(stateDir, decisionRows(options.site, stateHash, questions, fallback, false, "cap_exceeded"));
      return fallback;
    }
    appendFileSync(
      join(stateDir, "usage.jsonl"),
      `${JSON.stringify({
        ts: new Date().toISOString(),
        site: options.site,
        model: options.model ?? "jev-latest",
        kind: "reservation",
        reservation_id: reservationId,
        reserved_input_tokens: 64_000,
        cost_usd: MAX_REQUEST_USD,
      })}\n`,
    );
  } catch {
    appendDecisions(stateDir, decisionRows(options.site, stateHash, questions, fallback, false, "usage_log_error"));
    return fallback;
  } finally {
    releaseCostLock(lock, lockToken);
  }

  const request = buildRequest(sanitized, questions, options.model ?? "jev-latest");
  let response: JevResponse;
  try {
    const pending = options.transport ? options.transport(request, apiKey) : fetchTransport(request, apiKey, timeoutMs);
    response = await withTimeout(pending, timeoutMs);
  } catch (error) {
    appendDecisions(stateDir, decisionRows(options.site, stateHash, questions, fallback, false, transportFallbackReason(error)));
    return fallback;
  }

  if (!response || typeof response !== "object" || !response.answers || typeof response.answers !== "object") {
    appendDecisions(stateDir, decisionRows(options.site, stateHash, questions, fallback, false, "response_invalid"));
    return fallback;
  }
  const reportedInputTokens = response.usage?.input_tokens;
  if (reportedInputTokens !== undefined && !validTokenCount(reportedInputTokens)) {
    appendDecisions(stateDir, decisionRows(options.site, stateHash, questions, fallback, false, "usage_out_of_range"));
    return fallback;
  }

  let vendorAnswers: JevAnswer[];
  try {
    vendorAnswers = parseAnswers(questions, response.answers);
  } catch {
    appendDecisions(stateDir, decisionRows(options.site, stateHash, questions, fallback, false, "response_invalid"));
    return fallback;
  }

  const inputTokens = reportedInputTokens ?? 64_000;
  const reconcileToken = await acquireCostLockWithRetry(lock, timeoutMs + 60_000, lockWaitMs);
  if (reconcileToken) {
    try {
      appendFileSync(
        join(stateDir, "usage.jsonl"),
        `${JSON.stringify({
          ts: new Date().toISOString(),
          site: options.site,
          model: response.model,
          kind: "reconciliation",
          reservation_id: reservationId,
          input_tokens: inputTokens,
          cost_usd: inputTokens * PRICE_PER_INPUT_TOKEN - MAX_REQUEST_USD,
        })}\n`,
      );
    } finally {
      releaseCostLock(lock, reconcileToken);
    }
  }

  const acted = mode === "on";
  if (!appendDecisions(stateDir, decisionRows(options.site, stateHash, questions, vendorAnswers, acted, null))) return fallback;
  return acted || returnShadow
    ? vendorAnswers.map((answer) => ({
        ...answer,
        acted,
        source: "jev",
      }))
    : fallback;
}

export async function voteMostCautious<T>(vote: () => Promise<T>, cautiousness: (value: T) => number, n = 3): Promise<T> {
  if (!Number.isInteger(n) || n < 1) throw new Error("n must be a positive integer");
  const values: T[] = [];
  for (let index = 0; index < n; index += 1) values.push(await vote());
  return values.reduce((best, value) => (cautiousness(value) > cautiousness(best) ? value : best));
}

function siteMode(site: string): "off" | "shadow" | "on" {
  if (process.env.CI || process.env.JEV_ENABLED === "0") return "off";
  const value = process.env[`JEV_SITE_${site.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`];
  return value === "off" || value === "on" || value === "shadow" ? value : "shadow";
}

function dailyCap(): number {
  const value = Number(process.env.JEV_DAILY_USD_CAP ?? "5");
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function spentToday(stateDir: string): number {
  try {
    const date = new Date().toISOString().slice(0, 10);
    return readFileSync(join(stateDir, "usage.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .reduce((sum, line) => {
        const row = JSON.parse(line) as { ts: string; cost_usd: number };
        if (typeof row.ts !== "string" || !Number.isFinite(row.cost_usd)) throw new Error("Invalid usage row");
        return row.ts.startsWith(date) ? sum + row.cost_usd : sum;
      }, 0);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? 0 : Number.POSITIVE_INFINITY;
  }
}

function loadApiKey(keyFile = join(homedir(), ".config", "typesafe", "api-key")): string | null {
  const envKey = process.env.TYPESAFE_API_KEY?.trim();
  if (envKey) return envKey;
  try {
    return readFileSync(keyFile, "utf8").trim() || null;
  } catch {
    return null;
  }
}

async function fetchTransport(request: JevRequest, apiKey: string, timeoutMs: number): Promise<JevResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (!response.ok) throw new JevHTTPError(response.status);
    return (await response.json()) as JevResponse;
  } finally {
    clearTimeout(timer);
  }
}

function buildRequest(state: JSONValue, questions: JevQuestion[], model: string): JevRequest {
  return {
    state,
    model,
    questions: Object.fromEntries(questions.map(({ id, fallbackAnswer: _, ...question }) => [id, question])),
  };
}

function parseAnswers(questions: JevQuestion[], answers: Record<string, unknown>): JevAnswer[] {
  return questions.map((question) => {
    const raw = answers[question.id] as Record<string, unknown> | undefined;
    if (!raw || raw.type !== question.type) throw new Error("Invalid Jev response");
    if (question.type === "noul" && validProbability(raw.noul)) return answer(question, raw.noul, null);
    if (question.type === "choice" && typeof raw.choice === "string" && Object.hasOwn(question.criteria, raw.choice) && validProbability(raw.confidence)) {
      return answer(question, raw.choice, raw.confidence, probabilities(raw.probabilities, Object.keys(question.criteria)));
    }
    if (question.type === "score" && typeof raw.score === "number" && raw.score >= 0 && raw.score <= question.criteria.length - 1 && validProbability(raw.confidence)) {
      return answer(
        question,
        raw.score,
        raw.confidence,
        probabilities(
          raw.probabilities,
          question.criteria.map((_, index) => String(index)),
        ),
      );
    }
    throw new Error("Invalid Jev response");
  });
}

function answer(question: JevQuestion, value: number | string, confidence: number | null, probs?: Record<string, number>): JevAnswer {
  return {
    questionId: question.id,
    type: question.type,
    answer: value,
    confidence,
    probabilities: probs,
    fallbackAnswer: question.fallbackAnswer,
    acted: false,
    source: "jev",
  };
}

function fallbackAnswers(questions: JevQuestion[]): JevAnswer[] {
  return questions.map((question) => ({
    ...answer(question, question.fallbackAnswer, null),
    source: "fallback",
  }));
}

function validateQuestions(questions: JevQuestion[]): void {
  if (!questions.length || new Set(questions.map((question) => question.id)).size !== questions.length) throw new Error("Questions need unique ids");
  for (const question of questions) {
    if (!question.id) throw new Error("Question id is required");
    if (!(["noul", "choice", "score"] as string[]).includes(question.type)) throw new Error("Invalid question type");
    if (question.type === "noul" && !validProbability(question.fallbackAnswer)) throw new Error("Invalid noul fallback");
    if (question.type === "choice" && !Object.hasOwn(question.criteria, question.fallbackAnswer)) throw new Error("Invalid choice fallback");
    if (question.type === "score" && (question.criteria.length < 2 || question.criteria.length > 10 || question.fallbackAnswer < 0 || question.fallbackAnswer > question.criteria.length - 1))
      throw new Error("Invalid score criteria or fallback");
  }
}

function decisionRows(site: string, stateHash: string, questions: JevQuestion[], values: JevAnswer[], acted: boolean, fallbackReason: string | null): object[] {
  const ts = new Date().toISOString();
  return questions.map((question, index) => ({
    ts,
    site,
    state_hash: stateHash,
    question_id: question.id,
    answer: values[index].answer,
    confidence: values[index].confidence,
    fallback_answer: question.fallbackAnswer,
    acted,
    fallback_reason: fallbackReason,
  }));
}

function appendDecisions(stateDir: string, rows: object[]): boolean {
  try {
    appendFileSync(join(stateDir, "decisions.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
    return true;
  } catch {
    return false;
  }
}

function acquireCostLock(lock: string, leaseMs: number): string | null {
  const token = randomUUID();
  const owner = { token, pid: process.pid, created_ms: Date.now() };
  try {
    createCostLock(lock, owner);
    return token;
  } catch {
    try {
      const owner = JSON.parse(readFileSync(join(lock, "owner.json"), "utf8")) as { pid: number; created_ms: number };
      if (Date.now() - owner.created_ms <= leaseMs || processAlive(owner.pid)) return null;
      rmSync(lock, { recursive: true });
      createCostLock(lock, { token, pid: process.pid, created_ms: Date.now() });
      return token;
    } catch {
      return null;
    }
  }
}

async function acquireCostLockWithRetry(lock: string, leaseMs: number, waitMs: number): Promise<string | null> {
  const deadline = Date.now() + Math.max(0, waitMs);
  while (true) {
    const token = acquireCostLock(lock, leaseMs);
    if (token) return token;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;
    await delay(Math.min(remaining, 5 + Math.floor(Math.random() * 16)));
  }
}

function createCostLock(lock: string, owner: { token: string; pid: number; created_ms: number }): void {
  mkdirSync(lock);
  try {
    writeFileSync(join(lock, "owner.json"), JSON.stringify(owner));
  } catch (error) {
    rmSync(lock, { recursive: true, force: true });
    throw error;
  }
}

function releaseCostLock(lock: string, token: string): void {
  try {
    const owner = JSON.parse(readFileSync(join(lock, "owner.json"), "utf8")) as { token: string };
    if (owner.token === token) rmSync(lock, { recursive: true });
  } catch {
    /* a missing or foreign lock is never removed */
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function withTimeout<T>(pending: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new JevTimeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class JevHTTPError extends Error {
  constructor(readonly status: number) {
    super("TypeSafe HTTP error");
    this.name = "JevHTTPError";
  }
}

class JevTimeoutError extends Error {
  constructor() {
    super("Jev request timed out");
    this.name = "JevTimeoutError";
  }
}

function transportFallbackReason(error: unknown): string {
  if (error instanceof JevHTTPError) return `http_error_${error.status}`;
  if (error instanceof JevTimeoutError) return "transport_timeout";
  const rawClass = error instanceof Error ? error.name || error.constructor.name : typeof error;
  const safeClass = rawClass.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "unknown";
  return `transport_error_${safeClass}`;
}

function canonicalJSON(value: JSONValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`)
      .join(",")}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("State must be JSON serializable");
  return encoded;
}
function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function validProbability(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && value <= 1;
}
function validTokenCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 64_000;
}
function probabilities(value: unknown, expectedKeys: string[]): Record<string, number> {
  if (!value || typeof value !== "object" || Object.keys(value).length !== expectedKeys.length || expectedKeys.some((key) => !validProbability((value as Record<string, unknown>)[key])))
    throw new Error("Invalid probabilities");
  return value as Record<string, number>;
}
