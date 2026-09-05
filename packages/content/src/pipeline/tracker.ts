/**
 * Pipeline performance tracker — logs runs to Supabase and provides
 * performance analytics for the learning loop.
 *
 * Table: pipeline_runs (created via Supabase migration)
 */

import { getSupabase } from "@golems/shared/lib/supabase-factory";

export interface PipelineRunLog {
  pipelineId: string;
  idea: string;
  ideaType: string;
  success: boolean;
  durationMs: number;
  qualityScore?: number;
  userFeedback?: number; // 1-5 from Telegram reactions
  outputFormat?: string;
  error?: string;
}

export interface PipelineStats {
  pipelineId: string;
  totalRuns: number;
  successfulRuns: number;
  successRate: number;
  avgQualityScore: number;
  avgDurationMs: number;
  topIdeaTypes: string[];
}

/** Log a pipeline run to Supabase. */
export async function logPipelineRun(run: PipelineRunLog): Promise<void> {
  const supabase = getSupabase();

  await supabase.from("pipeline_runs").insert({
    pipeline_id: run.pipelineId,
    idea: run.idea.slice(0, 500), // Truncate long ideas
    idea_type: run.ideaType,
    success: run.success,
    duration_ms: run.durationMs,
    quality_score: run.qualityScore ?? null,
    user_feedback: run.userFeedback ?? null,
    output_format: run.outputFormat ?? null,
    error: run.error ?? null,
    created_at: new Date().toISOString(),
  });
}

/** Update user feedback for a pipeline run. */
export async function updateUserFeedback(
  runId: string,
  feedback: number,
): Promise<void> {
  const supabase = getSupabase();

  await supabase
    .from("pipeline_runs")
    .update({ user_feedback: feedback })
    .eq("id", runId);
}

/** Get aggregate performance stats per pipeline. */
export async function getPerformanceStats(): Promise<PipelineStats[]> {
  const supabase = getSupabase();

  const { data: runs } = await supabase
    .from("pipeline_runs")
    .select("pipeline_id, success, duration_ms, quality_score, idea_type")
    .order("created_at", { ascending: false })
    .limit(500);

  if (!runs || runs.length === 0) return [];

  // Aggregate by pipeline
  const statsMap = new Map<
    string,
    {
      total: number;
      successful: number;
      qualitySum: number;
      qualityCount: number;
      durationSum: number;
      ideaTypes: Map<string, number>;
    }
  >();

  for (const run of runs) {
    const pid = run.pipeline_id as string;
    const existing = statsMap.get(pid) ?? {
      total: 0,
      successful: 0,
      qualitySum: 0,
      qualityCount: 0,
      durationSum: 0,
      ideaTypes: new Map(),
    };

    existing.total++;
    if (run.success) existing.successful++;
    if (run.quality_score != null) {
      existing.qualitySum += Number(run.quality_score);
      existing.qualityCount++;
    }
    existing.durationSum += Number(run.duration_ms) || 0;

    const ideaType = run.idea_type as string;
    existing.ideaTypes.set(
      ideaType,
      (existing.ideaTypes.get(ideaType) ?? 0) + 1,
    );

    statsMap.set(pid, existing);
  }

  return [...statsMap.entries()].map(([pipelineId, s]) => ({
    pipelineId,
    totalRuns: s.total,
    successfulRuns: s.successful,
    successRate: s.total > 0 ? s.successful / s.total : 0,
    avgQualityScore: s.qualityCount > 0 ? s.qualitySum / s.qualityCount : 0,
    avgDurationMs: s.total > 0 ? s.durationSum / s.total : 0,
    topIdeaTypes: [...s.ideaTypes.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([type]) => type),
  }));
}

/** Get recent runs for a specific pipeline. */
export async function getRecentRuns(
  pipelineId: string,
  limit = 20,
): Promise<PipelineRunLog[]> {
  const supabase = getSupabase();

  const { data } = await supabase
    .from("pipeline_runs")
    .select("*")
    .eq("pipeline_id", pipelineId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map((r: Record<string, unknown>) => ({
    pipelineId: r.pipeline_id as string,
    idea: r.idea as string,
    ideaType: r.idea_type as string,
    success: r.success as boolean,
    durationMs: Number(r.duration_ms),
    qualityScore: r.quality_score as number | undefined,
    userFeedback: r.user_feedback as number | undefined,
    outputFormat: r.output_format as string | undefined,
    error: r.error as string | undefined,
  }));
}
