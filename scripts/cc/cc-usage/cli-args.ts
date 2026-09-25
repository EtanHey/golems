import { DEFAULT_CACHE_RATIO } from "./hypothetical";

export interface UsageCliOptions {
  period: string;
  daily: boolean;
  byProject: boolean;
  byModel: boolean;
  byProvider: boolean;
  hypothetical: boolean;
  roi: boolean;
  jsonOutput: boolean;
  snapshot: boolean;
  exportFormat?: string;
  cacheRatio: number;
}

const POSITIONAL_PERIODS: Record<string, string> = {
  day: "today",
  daily: "today",
  today: "today",
  week: "week",
  weekly: "week",
  month: "month",
  monthly: "month",
  all: "all",
};

function flagValue(args: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  const arg = args.find((a) => a.startsWith(prefix));
  return arg?.slice(prefix.length);
}

function parseCacheRatio(value: string | undefined): number {
  if (!value) return DEFAULT_CACHE_RATIO;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return DEFAULT_CACHE_RATIO;
  }
  return parsed;
}

export function parseUsageArgs(args: string[]): UsageCliOptions {
  const positionalPeriod = args
    .filter((a) => !a.startsWith("-"))
    .map((a) => POSITIONAL_PERIODS[a])
    .find(Boolean);
  const explicitPeriod = flagValue(args, "--period");
  const cacheRatioArg = flagValue(args, "--cache-ratio");

  return {
    period: explicitPeriod || positionalPeriod || "month",
    daily: args.includes("--daily") || ["day", "daily", "today"].some((a) => args.includes(a)),
    byProject: args.includes("--by-project"),
    byModel: args.includes("--by-model"),
    byProvider: args.includes("--by-provider"),
    hypothetical: args.includes("--hypothetical"),
    roi: args.includes("--roi"),
    jsonOutput: args.includes("--json"),
    snapshot: args.includes("--snapshot"),
    exportFormat: flagValue(args, "--export"),
    cacheRatio: parseCacheRatio(cacheRatioArg),
  };
}
