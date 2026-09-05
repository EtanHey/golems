/**
 * Custom assertion helpers for behavioral eval suite.
 * Used by per-skill YAML configs for argument validation
 * that PromptFoo built-in assertions can't cover.
 *
 * Usage: Referenced in behavioral/*.yaml via javascript assertions
 */

/**
 * Check that a specific tool was called with arguments containing a substring.
 * @param {object} output - PromptFoo output object with toolCalls array
 * @param {string} toolName - Name of the tool to check
 * @param {string} argSubstring - Substring that must appear in tool arguments
 * @returns {boolean}
 */
function toolCalledWithArg(output, toolName, argSubstring) {
  const toolCalls = output.toolCalls || [];
  return toolCalls.some((t) => {
    if (t.name !== toolName) return false;
    const argsStr = JSON.stringify(t.arguments || {});
    return argsStr.includes(argSubstring);
  });
}

/**
 * Check that tool A was called before tool B in the trajectory.
 * @param {object} output - PromptFoo output object
 * @param {string} toolA - First tool name
 * @param {string} toolB - Second tool name
 * @returns {boolean}
 */
function toolCalledBefore(output, toolA, toolB) {
  const toolCalls = output.toolCalls || [];
  const indexA = toolCalls.findIndex((t) => t.name === toolA);
  const indexB = toolCalls.findIndex((t) => t.name === toolB);
  if (indexA === -1 || indexB === -1) return false;
  return indexA < indexB;
}

/**
 * Count occurrences of a specific tool call.
 * @param {object} output - PromptFoo output object
 * @param {string} toolName - Tool name to count
 * @returns {number}
 */
function toolCallCount(output, toolName) {
  const toolCalls = output.toolCalls || [];
  return toolCalls.filter((t) => t.name === toolName).length;
}

/**
 * Check that no tool call matches a pattern (negative assertion).
 * @param {object} output - PromptFoo output object
 * @param {string} toolName - Tool name to check
 * @param {string} [argPattern] - Optional regex pattern for arguments
 * @returns {boolean} true if the tool was NOT called with matching args
 */
function toolNotCalledWith(output, toolName, argPattern) {
  const toolCalls = output.toolCalls || [];
  const matching = toolCalls.filter((t) => {
    if (t.name !== toolName) return false;
    if (!argPattern) return true;
    const argsStr = JSON.stringify(t.arguments || {});
    return new RegExp(argPattern).test(argsStr);
  });
  return matching.length === 0;
}

/**
 * Compute relative error reduction between with_skill and without_skill.
 * Formula: (baseline_error - skill_error) / baseline_error
 * Threshold: >= 0.20 (20% relative reduction)
 *
 * @param {number} baselineScore - Score without skill (0-1, higher = better)
 * @param {number} skillScore - Score with skill (0-1, higher = better)
 * @returns {{ reduction: number, passes: boolean, baseline: number, skill: number }}
 */
function relativeErrorReduction(baselineScore, skillScore) {
  const baselineError = 1 - baselineScore;
  const skillError = 1 - skillScore;

  // Avoid division by zero
  if (baselineError === 0) {
    return {
      reduction: skillError === 0 ? 0 : -Infinity,
      passes: skillError === 0,
      baseline: baselineScore,
      skill: skillScore,
    };
  }

  const reduction = (baselineError - skillError) / baselineError;
  return {
    reduction,
    passes: reduction >= 0.2,
    baseline: baselineScore,
    skill: skillScore,
  };
}

module.exports = {
  toolCalledWithArg,
  toolCalledBefore,
  toolCallCount,
  toolNotCalledWith,
  relativeErrorReduction,
};
