/**
 * PromptFoo transform-vars helper for behavioral eval suite.
 * Loads composed skill content into the with_skill provider's system prompt.
 * For without_skill provider, skill_system_prompt is left empty.
 *
 * Usage: Referenced in promptfoo-behavioral.yaml via transformVars
 */

const { composeSkill } = require("./compose-skill.js");

module.exports = function transformVars(vars, context) {
  // For without_skill provider, clear the skill prompt
  if (context.provider && context.provider.label === "without_skill") {
    return { ...vars, skill_system_prompt: "" };
  }

  if (
    vars.skill_system_prompt &&
    vars.skill_system_prompt.startsWith("compose://")
  ) {
    const skillName = vars.skill_system_prompt.slice("compose://".length);
    return {
      ...vars,
      skill_system_prompt: composeSkill(skillName).text,
    };
  }

  return { ...vars };
};
