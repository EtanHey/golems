import { recentAssistantModel } from "../lib/transcript.mjs";

const SPAWN_TOOLS = new Set(["Agent", "Task", "Workflow"]);
const WORKER_MODEL_RE = /\b(opus|sonnet|haiku)\b/i;
const FABLE_RE = /\bfable\b/i;

function baseName(name) {
  const n = String(name ?? "");
  if (n.startsWith("mcp__")) {
    const parts = n.split("__");
    return parts[parts.length - 1] || n;
  }
  return n;
}

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function modelText(input) {
  if (!isObject(input)) return "";
  const value = input.model ?? input.model_name ?? input.modelName;
  return typeof value === "string" ? value.trim() : "";
}

function isFableModel(model) {
  return FABLE_RE.test(String(model ?? ""));
}

function hasNonFableModelPin(input) {
  const model = modelText(input);
  return Boolean(model && !isFableModel(model) && WORKER_MODEL_RE.test(model));
}

function workflowCounts(script) {
  const source = typeof script === "string" ? script : "";
  const agentCalls = source.match(/\bagent\s*\(/g) ?? [];
  const modelPins = source.match(/\bmodel\s*:/g) ?? [];
  return { agentCalls: agentCalls.length, modelPins: modelPins.length };
}

function emptyResult(verdict = "PASS") {
  return {
    verdict,
    seatModel: "",
    tool: "",
    violations: [],
    advisories: [],
  };
}

export function detectModelPin(payload) {
  const result = emptyResult();
  if (!isObject(payload)) return result;

  const tool = baseName(payload.tool_name ?? payload.toolName);
  result.tool = tool;
  if (!SPAWN_TOOLS.has(tool)) return result;

  const seatModel = recentAssistantModel(payload.transcript);
  result.seatModel = seatModel;
  if (!seatModel || !isFableModel(seatModel)) return result;

  const input = payload.tool_input ?? payload.toolInput;
  if (!isObject(input)) return result;

  const pinnedModel = modelText(input);
  if ((tool === "Agent" || tool === "Task") && pinnedModel && isFableModel(pinnedModel)) {
    return {
      ...result,
      verdict: "FLAG",
      violations: [
        {
          code: "MODELPIN_FABLE_BELOW_APEX",
          evidence: `${tool} pins ${pinnedModel} from Fable seat ${seatModel}`,
          action: "pin subagents to model:'opus'|'sonnet'|'haiku'; never pin Fable below apex seats",
        },
      ],
    };
  }

  if ((tool === "Agent" || tool === "Task") && !pinnedModel) {
    return {
      ...result,
      verdict: "FLAG",
      violations: [
        {
          code: "MODELPIN_AGENT_UNPINNED",
          evidence: `${tool} call from Fable seat ${seatModel} has no tool_input.model`,
          action: "add model:'opus'|'sonnet'|'haiku' to the spawn",
        },
      ],
    };
  }

  if ((tool === "Agent" || tool === "Task") && hasNonFableModelPin(input)) {
    return result;
  }

  if (tool === "Workflow") {
    const { agentCalls, modelPins } = workflowCounts(input.script);
    if (agentCalls > modelPins) {
      return {
        ...result,
        verdict: "ADVISORY",
        advisories: [
          {
            code: "MODELPIN_WORKFLOW_AGENT_MODEL_ADVISORY",
            evidence: `Workflow script has ${agentCalls} agent() calls and ${modelPins} model: pins`,
            action: "ensure every agent() call carries model:'opus'|'sonnet'|'haiku'",
          },
        ],
      };
    }
  }

  return result;
}
