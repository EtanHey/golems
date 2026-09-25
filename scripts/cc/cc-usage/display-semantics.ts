export const API_RATE_VALUE_NOTE = "at API rates";
export const CURSOR_LOWER_BOUND_VALUE_NOTE =
  "visible transcript lower bound; missing tool results/codebase context";

export function isLowerBoundProvider(provider: string): boolean {
  return provider === "cursor";
}

export function isLowerBoundSource(source: string): boolean {
  return source === "cursor" || source === "cursor-cli";
}

export function valuePrefixForProvider(provider: string): string {
  return isLowerBoundProvider(provider) ? ">=" : "";
}

export function valueNoteForProvider(provider: string): string {
  return isLowerBoundProvider(provider)
    ? CURSOR_LOWER_BOUND_VALUE_NOTE
    : API_RATE_VALUE_NOTE;
}

export function hasLowerBoundProviderCost(
  rows: Iterable<{ provider: string; cost: number }>,
): boolean {
  for (const row of rows) {
    if (isLowerBoundProvider(row.provider) && row.cost > 0) return true;
  }
  return false;
}

export function hasLowerBoundSourceCost(
  rows: Iterable<{ source: string; cost: number }>,
): boolean {
  for (const row of rows) {
    if (isLowerBoundSource(row.source) && row.cost > 0) return true;
  }
  return false;
}
