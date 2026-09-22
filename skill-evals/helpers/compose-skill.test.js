const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  composeSkill,
  writeCompositionManifest,
} = require("./compose-skill.js");
const transformVars = require("./transform-vars.js");

const repoRoot = path.resolve(__dirname, "../..");

test("composes SKILL.md and sorted references for cmux-agents", () => {
  const composition = composeSkill("cmux-agents", { repoRoot });
  const expectedFiles = [
    "skills/golem-powers/cmux-agents/SKILL.md",
    "skills/golem-powers/cmux-agents/references/delivery-and-recovery.md",
    "skills/golem-powers/cmux-agents/references/monitoring-and-collaboration.md",
    "skills/golem-powers/cmux-agents/references/platform-notes.md",
    "skills/golem-powers/cmux-agents/references/tool-contracts.md",
  ];

  assert.deepEqual(
    composition.files.map((file) => file.path),
    expectedFiles,
  );
  assert.match(composition.text, /--- SKILL\.md ---/);
  assert.match(
    composition.text,
    /--- references\/platform-notes\.md ---\n[\s\S]*Codex detached-child reap/,
  );
  assert.doesNotMatch(
    fs.readFileSync(path.join(repoRoot, expectedFiles[0]), "utf8"),
    /Codex detached-child reap/,
  );
  assert.doesNotMatch(composition.text, /--- adapters\//);
  assert.doesNotMatch(composition.text, /--- evals\//);
  assert.doesNotMatch(composition.text, /--- scripts\//);
  assert.doesNotMatch(composition.text, /--- workflows\//);
});

test("writes a deterministic manifest with a sha256 for every measured file", () => {
  const outputDir = fs.mkdtempSync(
    path.join(repoRoot, "skill-evals/results/.compose-skill-test-"),
  );
  const manifestPath = path.join(outputDir, "results.composition.json");

  try {
    writeCompositionManifest(["cmux-agents"], manifestPath, { repoRoot });
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

    assert.equal(manifest.schema_version, 1);
    assert.equal(manifest.skills[0].skill_name, "cmux-agents");
    assert.equal(manifest.skills[0].files.length, 5);
    for (const file of manifest.skills[0].files) {
      assert.match(file.sha256, /^[a-f0-9]{64}$/);
    }
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("injects composed text only for the with-skill provider", () => {
  const withSkill = transformVars(
    {
      skill_name: "cmux-agents",
      skill_system_prompt: "compose://cmux-agents",
    },
    { provider: { label: "with_skill" } },
  );
  const withoutSkill = transformVars(
    {
      skill_name: "missing-on-purpose",
      skill_system_prompt: "compose://missing-on-purpose",
    },
    { provider: { label: "without_skill" } },
  );

  assert.match(withSkill.skill_system_prompt, /Codex detached-child reap/);
  assert.equal(withoutSkill.skill_system_prompt, "");
});

test("resolves evaluated skills retired into the tracked archive", () => {
  const composition = composeSkill("commit", { repoRoot });

  assert.deepEqual(composition.files.map((file) => file.path), [
    "skills/golem-powers/_archive/commit/SKILL.md",
  ]);
});
