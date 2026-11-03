// Skill's dynamic expansion surface is limited to the measured, plain-text skill.
let input = "";
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
const skill = request.tool_input?.skill;
if (typeof skill !== "string" || skill.replace(/^\//, "") !== "pr-loop") {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse",
    permissionDecision: "deny", permissionDecisionReason: "This fixture permits Skill(pr-loop) only; use Read for catalog references." } }));
}
