/**
 * PromptFoo transform-vars helper for behavioral eval suite.
 * Loads skill SKILL.md content into the with_skill provider's system prompt.
 * For without_skill provider, skill_system_prompt is left empty.
 *
 * Usage: Referenced in promptfoo-behavioral.yaml via transformVars
 */

const fs = require("fs");
const path = require("path");

module.exports = function transformVars(vars, context) {
  // Load skill content from file if it's a file:// reference
  if (
    vars.skill_system_prompt &&
    vars.skill_system_prompt.startsWith("file://")
  ) {
    const filePath = vars.skill_system_prompt.replace("file://", "");
    const resolvedPath = path.resolve(process.cwd(), filePath);
    try {
      vars.skill_system_prompt = fs.readFileSync(resolvedPath, "utf-8");
    } catch (err) {
      // Fail fast for with_skill provider — missing skill file means broken eval
      if (!context.provider || context.provider.label !== "without_skill") {
        throw new Error(
          `[transform-vars] Could not load skill file: ${resolvedPath} — ${err.message}`,
        );
      }
      vars.skill_system_prompt = "";
    }
  }

  // For without_skill provider, clear the skill prompt
  if (context.provider && context.provider.label === "without_skill") {
    vars.skill_system_prompt = "";
  }

  return vars;
};
