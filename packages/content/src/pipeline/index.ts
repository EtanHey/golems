/**
 * Pipeline intelligence — barrel export.
 */

export {
  getRegistry,
  getRegistryForPrompt,
  type PipelineCapability,
  type PipelineInput,
  type OutputFormat,
  type PipelineRegistry,
} from "./registry";

export {
  routeIdea,
  type RoutingRequest,
  type RoutingResult,
  type PipelineStep,
} from "./router";

export {
  executePlan,
  type ExecutionResult,
  type ExecutionContext,
  type StepOutput,
} from "./executor";

export {
  logPipelineRun,
  updateUserFeedback,
  getPerformanceStats,
  getRecentRuns,
  type PipelineRunLog,
  type PipelineStats,
} from "./tracker";
