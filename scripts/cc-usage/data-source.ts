export function shouldUseRawAggregation(
  period: string,
  snapshotCount: number,
): boolean {
  return period === "all" || snapshotCount === 0;
}
