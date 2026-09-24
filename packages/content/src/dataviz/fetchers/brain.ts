/**
 * Brain data fetcher — BrainLayer knowledge-base size and recent store rate.
 *
 * Reads BrainLayer's own published observability document (schema_version 1),
 * which its com.brainlayer.observability launchd job rewrites every 5 minutes
 * beside the database (`brainlayer observability --write`). This fetcher never
 * opens the database: the live DB is large and BrainLayer owns its queries.
 *
 * The document has no per-month or per-project history, so the chart is
 * "stores per hour over the last window" plus totals, not a growth curve.
 * Chunk previews in the document (`stores.latest`) are never read into chart data.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";

const DEFAULT_PATH = join(
  process.env.HOME ?? "",
  ".local/share/brainlayer/observability.json",
);

export interface ContentClassCount {
  contentClass: string;
  count: number;
}

export interface HourlyStores {
  hour: string;
  count: number;
}

export interface BrainData {
  /** "measured" when the document's stores section was measured; else "unavailable" with a reason. */
  state: "measured" | "unavailable";
  reason: string;
  totalChunks: number;
  contentClasses: ContentClassCount[];
  storesInWindow: number;
  windowHours: number;
  hourly: HourlyStores[];
  /** When BrainLayer generated the document. */
  generatedAt: string | null;
  fetchedAt: string;
}

const SUPPORTED_SCHEMA = 1;

interface ObservabilityDoc {
  schema_version?: number;
  generated_at?: string;
  window_hours?: number;
  stores?: {
    state?: string;
    reason?: string;
    total_chunks?: number;
    by_content_class?: Array<{ content_class: string | null; count: number }>;
    in_window?: { count?: number; by_hour?: Array<{ hour: string; count: number }> };
  };
}

function unavailable(reason: string, generatedAt: string | null = null): BrainData {
  return {
    state: "unavailable",
    reason,
    totalChunks: 0,
    contentClasses: [],
    storesInWindow: 0,
    windowHours: 0,
    hourly: [],
    generatedAt,
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchBrainData(
  opts: { path?: string } = {},
): Promise<BrainData> {
  const path = opts.path ?? process.env.BRAINLAYER_OBSERVABILITY_PATH ?? DEFAULT_PATH;
  if (!existsSync(path)) {
    return unavailable(`BrainLayer observability document not found: ${path}`);
  }

  let doc: ObservabilityDoc;
  try {
    doc = JSON.parse(readFileSync(path, "utf8")) as ObservabilityDoc;
  } catch (err) {
    return unavailable(`unreadable observability document ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const generatedAt = doc.generated_at ?? null;
  // A future schema may move or rename fields; charting it as "measured"
  // zeros is the silent-empty failure this fetcher replaced.
  if (doc.schema_version !== SUPPORTED_SCHEMA) {
    return unavailable(
      `unsupported observability schema_version ${doc.schema_version ?? "missing"} (expected ${SUPPORTED_SCHEMA}): ${path}`,
      generatedAt,
    );
  }
  const stores = doc.stores;
  if (!stores || stores.state !== "measured") {
    return unavailable(
      `stores not measured (${stores?.state ?? "missing"}): ${stores?.reason || "no reason given"}`,
      generatedAt,
    );
  }

  return {
    state: "measured",
    reason: "",
    totalChunks: stores.total_chunks ?? 0,
    contentClasses: (stores.by_content_class ?? [])
      .map((c) => ({ contentClass: c.content_class ?? "unclassified", count: c.count }))
      .sort((a, b) => b.count - a.count),
    storesInWindow: stores.in_window?.count ?? 0,
    windowHours: doc.window_hours ?? 0,
    hourly: (stores.in_window?.by_hour ?? []).map((h) => ({ hour: h.hour, count: h.count })),
    generatedAt,
    fetchedAt: new Date().toISOString(),
  };
}
