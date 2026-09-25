export const NATIVE_USAGE_METHOD = "native-usage";
export const CURSOR_TRANSCRIPT_REPLAY_V2_METHOD = "cursor-transcript-replay-v2";
export const CURSOR_VISIBLE_TRANSCRIPT_LOWER_BOUND_METHOD =
  "cursor-visible-transcript-lower-bound-v3";

const ESTIMATION_METHOD_RANK: Record<string, number> = {
  [NATIVE_USAGE_METHOD]: 4,
  [CURSOR_VISIBLE_TRANSCRIPT_LOWER_BOUND_METHOD]: 3,
  [CURSOR_TRANSCRIPT_REPLAY_V2_METHOD]: 2,
};

export function estimationMethodRank(method: string | null | undefined): number {
  if (!method) return 0;
  return ESTIMATION_METHOD_RANK[method] || 0;
}
