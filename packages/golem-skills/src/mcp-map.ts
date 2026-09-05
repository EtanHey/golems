import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

/** Canonical skill → MCP dependency mapping. Single source of truth. */
export const SKILL_MCP_MAP: Record<
  string,
  { required: string[]; complement: string[] }
> = {
  coach: {
    required: ["google-calendar"],
    complement: ["sophtron", "brainlayer", "supabase"],
  },
  research: { required: ["exa"], complement: ["brainlayer"] },
  "whats-new": { required: ["exa"], complement: ["brainlayer"] },
  "youtube-pipeline": { required: ["exa"], complement: [] },
  "voice-sessions": { required: ["voicelayer"], complement: [] },
  "1password": { required: ["1password"], complement: [] },
  railway: { required: [], complement: ["railway"] },
  convex: { required: ["convex"], complement: ["supabase"] },
  catchup: { required: ["brainlayer"], complement: [] },
  "cmux-agents": { required: [], complement: ["voicelayer"] },
  "ecosystem-health": {
    required: ["supabase"],
    complement: ["brainlayer"],
  },
};

/** Check which MCPs are already configured in .mcp.json files. */
export async function getConfiguredMcps(
  reposPath?: string,
): Promise<Set<string>> {
  const configured = new Set<string>();

  const paths = [
    join(homedir(), ".claude", ".mcp.json"),
    join(homedir(), ".claude", "mcp.json"),
  ];
  if (reposPath) {
    const expanded = reposPath.replace(/^~/, homedir());
    paths.unshift(join(expanded, ".mcp.json"));
  }

  for (const p of paths) {
    try {
      const raw = await readFile(p, "utf8");
      const data = JSON.parse(raw);
      const servers = data.mcpServers || data;
      if (typeof servers === "object" && servers !== null) {
        for (const key of Object.keys(servers)) configured.add(key);
      }
    } catch {
      // file not found or invalid JSON — skip
    }
  }

  return configured;
}

/** Return MCP recommendations for installed skills, filtering out already-configured ones. */
export function recommendMcps(
  installedSkills: string[] | Set<string>,
  configuredMcps: Set<string>,
): Array<{ skill: string; mcp: string; type: "required" | "complement" }> {
  const recommendations: Array<{
    skill: string;
    mcp: string;
    type: "required" | "complement";
  }> = [];

  for (const skill of installedSkills) {
    const mapping = SKILL_MCP_MAP[skill];
    if (!mapping) continue;
    for (const mcp of mapping.required) {
      if (!configuredMcps.has(mcp))
        recommendations.push({ skill, mcp, type: "required" });
    }
    for (const mcp of mapping.complement) {
      if (!configuredMcps.has(mcp))
        recommendations.push({ skill, mcp, type: "complement" });
    }
  }

  return recommendations;
}
