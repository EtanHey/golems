export interface ShellbookUsageRow {
  created_at?: string | null;
  model?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_tokens?: number | null;
  cache_read_tokens?: number | null;
  cost_usd?: number | null;
}

export interface ShellbookModelBreakdown {
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  cost: number;
}

export interface ShellbookDailyUsage {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  totalCost: number;
  modelsUsed: string[];
  modelBreakdowns: ShellbookModelBreakdown[];
}

export interface ShellbookUsageExport {
  daily: ShellbookDailyUsage[];
  totals: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    totalTokens: number;
    totalCost: number;
  };
}

function numberValue(value: number | null | undefined): number {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function emptyBreakdown(modelName: string): ShellbookModelBreakdown {
  return {
    modelName,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    cost: 0,
  };
}

function addRow(target: ShellbookModelBreakdown, row: ShellbookUsageRow) {
  target.inputTokens += numberValue(row.input_tokens);
  target.outputTokens += numberValue(row.output_tokens);
  target.cacheCreationTokens += numberValue(row.cache_creation_tokens);
  target.cacheReadTokens += numberValue(row.cache_read_tokens);
  target.cost += numberValue(row.cost_usd);
  target.totalTokens =
    target.inputTokens +
    target.outputTokens +
    target.cacheCreationTokens +
    target.cacheReadTokens;
}

export function buildShellbookUsageExport(
  rows: ShellbookUsageRow[],
): ShellbookUsageExport {
  const byDay = new Map<string, Map<string, ShellbookModelBreakdown>>();

  for (const row of rows) {
    const date = row.created_at?.slice(0, 10);
    if (!date) continue;

    const modelName = row.model?.trim() || "unknown";
    let day = byDay.get(date);
    if (!day) {
      day = new Map();
      byDay.set(date, day);
    }

    let breakdown = day.get(modelName);
    if (!breakdown) {
      breakdown = emptyBreakdown(modelName);
      day.set(modelName, breakdown);
    }

    addRow(breakdown, row);
  }

  const daily: ShellbookDailyUsage[] = Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, modelMap]) => {
      const modelBreakdowns = Array.from(modelMap.values()).sort((a, b) =>
        a.modelName.localeCompare(b.modelName),
      );
      const totals = modelBreakdowns.reduce(
        (acc, item) => {
          acc.inputTokens += item.inputTokens;
          acc.outputTokens += item.outputTokens;
          acc.cacheCreationTokens += item.cacheCreationTokens;
          acc.cacheReadTokens += item.cacheReadTokens;
          acc.totalTokens += item.totalTokens;
          acc.totalCost += item.cost;
          return acc;
        },
        {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          totalTokens: 0,
          totalCost: 0,
        },
      );

      return {
        date,
        ...totals,
        modelsUsed: modelBreakdowns.map((item) => item.modelName),
        modelBreakdowns,
      };
    });

  const totals = daily.reduce(
    (acc, item) => {
      acc.inputTokens += item.inputTokens;
      acc.outputTokens += item.outputTokens;
      acc.cacheCreationTokens += item.cacheCreationTokens;
      acc.cacheReadTokens += item.cacheReadTokens;
      acc.totalTokens += item.totalTokens;
      acc.totalCost += item.totalCost;
      return acc;
    },
    {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      totalCost: 0,
    },
  );

  return { daily, totals };
}
