const path = require("node:path");

const { writeCompositionManifest } = require("./compose-skill.js");

const repoRoot = path.resolve(__dirname, "../..");
const manifestPath = path.join(
  repoRoot,
  "skill-evals/results/overnight-march26.composition.json",
);

function beforeAll(context) {
  const skillNames = (context.suite.tests || [])
    .map((test) => test.vars && test.vars.skill_system_prompt)
    .filter((value) => value && value.startsWith("compose://"))
    .map((value) => value.slice("compose://".length));

  if (skillNames.length === 0) {
    throw new Error("[composition-manifest] No compose:// skill prompts found");
  }

  writeCompositionManifest(skillNames, manifestPath, { repoRoot });
}

module.exports = { beforeAll };
