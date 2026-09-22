#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_REPO_ROOT = path.resolve(__dirname, "../..");
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function countLines(content) {
  if (content.length === 0) return 0;
  const newlineCount = (content.match(/\n/g) || []).length;
  return newlineCount + (content.endsWith("\n") ? 0 : 1);
}

function isGitIgnored(repoRoot, absolutePath) {
  const relativePath = path.relative(repoRoot, absolutePath);
  const result = spawnSync(
    "git",
    ["check-ignore", "--quiet", "--", relativePath],
    { cwd: repoRoot, stdio: "ignore" },
  );

  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(
    `[compose-skill] git check-ignore failed for ${relativePath}`,
  );
}

function resolveSkillDirectory(skillName, repoRoot) {
  if (!SKILL_NAME_PATTERN.test(skillName)) {
    throw new Error(`[compose-skill] Invalid skill name: ${skillName}`);
  }

  const skillDirectory = path.join(repoRoot, "skills/golem-powers", skillName);

  if (!fs.existsSync(path.join(skillDirectory, "SKILL.md"))) {
    throw new Error(
      `[compose-skill] Skill not found: ${skillName} (checked active skills)`,
    );
  }
  return skillDirectory;
}

function listSkillFiles(skillName, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || DEFAULT_REPO_ROOT);
  const skillDirectory = resolveSkillDirectory(skillName, repoRoot);
  const skillFile = path.join(skillDirectory, "SKILL.md");
  const referenceDirectory = path.join(skillDirectory, "references");
  const referenceFiles = fs.existsSync(referenceDirectory)
    ? fs
        .readdirSync(referenceDirectory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map((entry) => path.join(referenceDirectory, entry.name))
        .filter((filePath) => !isGitIgnored(repoRoot, filePath))
        .sort()
    : [];

  return [skillFile, ...referenceFiles];
}

function composeSkill(skillName, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || DEFAULT_REPO_ROOT);
  const absoluteFiles = listSkillFiles(skillName, { repoRoot });
  const skillDirectory = path.dirname(absoluteFiles[0]);
  const files = absoluteFiles.map((absolutePath) => {
    const content = fs.readFileSync(absolutePath, "utf8");
    return {
      path: path.relative(repoRoot, absolutePath).split(path.sep).join("/"),
      header: path
        .relative(skillDirectory, absolutePath)
        .split(path.sep)
        .join("/"),
      sha256: crypto.createHash("sha256").update(content).digest("hex"),
      line_count: countLines(content),
      content,
    };
  });
  const text = files
    .map((file) => `--- ${file.header} ---\n${file.content}`)
    .join("\n");

  return {
    skill_name: skillName,
    files,
    source_line_count: files[0].line_count,
    composed_line_count: countLines(text),
    text,
  };
}

function writeCompositionManifest(skillNames, manifestPath, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || DEFAULT_REPO_ROOT);
  const skills = [...new Set(skillNames)].sort().map((skillName) => {
    const composition = composeSkill(skillName, { repoRoot });
    return {
      skill_name: skillName,
      files: composition.files.map(({ path: filePath, sha256 }) => ({
        path: filePath,
        sha256,
      })),
    };
  });
  const manifest = { schema_version: 1, skills };
  const resolvedManifestPath = path.resolve(repoRoot, manifestPath);

  fs.mkdirSync(path.dirname(resolvedManifestPath), { recursive: true });
  fs.writeFileSync(
    resolvedManifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return manifest;
}

function runCli(args) {
  if (args[0] === "--stats") {
    const skillNames = args.slice(1);
    if (skillNames.length === 0) {
      throw new Error("Usage: compose-skill.js --stats <skill> [skill ...]");
    }
    process.stdout.write("skill\tSKILL.md lines\tcomposed lines\tfiles\n");
    for (const skillName of skillNames) {
      const composition = composeSkill(skillName);
      process.stdout.write(
        `${skillName}\t${composition.source_line_count}\t${composition.composed_line_count}\t${composition.files.length}\n`,
      );
    }
    return;
  }

  if (args.length !== 1) {
    throw new Error("Usage: compose-skill.js <skill>");
  }
  process.stdout.write(composeSkill(args[0]).text);
}

if (require.main === module) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  composeSkill,
  listSkillFiles,
  writeCompositionManifest,
};
