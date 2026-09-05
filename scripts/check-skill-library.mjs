#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const DEFAULT_RETIRED = [
  "brave",
  "catchup",
  "claude-web-research",
  "commit",
  "context7",
  "convex",
  "critique-waves",
  "github",
  "interview-practice",
  "maintenance",
  "notebooklm-research",
  "research",
  "research-ab-test",
  "research-prompt-quality",
  "review-router",
  "test-plan",
  "video-showcase",
  "worktrees",
];

const SECRET_VALUE_PREFIXES = [
  "akia",
  "asia",
  "ghp_",
  "gho_",
  "ghs_",
  "github_pat_",
  "sk-",
  "sk_live_",
  "sk_test_",
  "xoxb-",
  "xoxp-",
  "xapp-",
  "aiza",
  "glpat-",
];
const ENVIRONMENT_VARIABLE_NAME = /^[A-Z][A-Z0-9_]*$/;
const PRINTABLE_INVALID_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;
const MIN_OPAQUE_VALUE_LENGTH = 16;

const args = new Map();
for (const arg of process.argv.slice(2)) {
  const [key, value] = arg.split("=", 2);
  args.set(key, value ?? "true");
}

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const skillsRoot = resolve(
  args.get("--skills-root") ?? join(repoRoot, "skills", "golem-powers"),
);
const maxDescription = Number(args.get("--max-description") ?? "1024");
const enforceRetired = args.has("--enforce-retired");
const retired = new Set(
  (args.get("--retired") ?? DEFAULT_RETIRED.join(","))
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean),
);

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function stripTrailingComment(value) {
  let quote = null;

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (quote) {
      if (char === quote && value[i - 1] !== "\\") quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === "#" && i > 0 && /\s/.test(value[i - 1])) {
      return value.slice(0, i).trim();
    }
  }

  return value;
}

function normalizeRequiresValue(value) {
  return unquote(value).replace(/\p{Cf}/gu, "");
}

function hasCredentialLikeEnvironmentNameShape(value) {
  return (
    ENVIRONMENT_VARIABLE_NAME.test(value) &&
    value.length >= MIN_OPAQUE_VALUE_LENGTH &&
    /\d/.test(value) &&
    !value.includes("_")
  );
}

function isValidRequirementName(value) {
  return (
    ENVIRONMENT_VARIABLE_NAME.test(value) &&
    !hasCredentialLikeEnvironmentNameShape(value)
  );
}

function isSafeInvalidValueToPrint(value) {
  return (
    value === "[]" ||
    /\s/.test(value) ||
    (value.length < MIN_OPAQUE_VALUE_LENGTH && PRINTABLE_INVALID_NAME.test(value))
  );
}

function secretValueReason(value) {
  const normalized = normalizeRequiresValue(value);

  // Valid environment variable names take precedence over credential-prefix
  // collisions. The digit-bearing, underscore-free shape remains rejected.
  if (isValidRequirementName(normalized)) return null;

  const lowercased = normalized.toLowerCase();
  if (SECRET_VALUE_PREFIXES.some((prefix) => lowercased.includes(prefix))) {
    return "known credential prefix";
  }

  if (hasCredentialLikeEnvironmentNameShape(normalized)) {
    return `credential-like shape: ${normalized.length} characters, contains a digit, and has no underscore`;
  }

  if (
    normalized.length >= MIN_OPAQUE_VALUE_LENGTH &&
    !/\s/.test(normalized)
  ) {
    return `opaque value: ${normalized.length} characters with no whitespace`;
  }

  if (!isSafeInvalidValueToPrint(normalized)) {
    return "value is not provably safe to print";
  }

  return null;
}

function failSecretValue(skillName, location, reason, expected) {
  fail(
    `ERROR ${skillName}: requires ${location} detected a suspected secret value (${reason}); ${expected}; declare variable names, never secret values`,
  );
}

function descriptionFromFrontmatter(skillMdPath) {
  const text = readFileSync(skillMdPath, "utf8");
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") return null;

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === "---") return null;
    const match = line.match(/^description:\s*(.*)$/);
    if (!match) continue;

    const value = match[1];
    if (value === "|" || value === ">") {
      const collected = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        if (lines[j] === "---") break;
        if (/^\S[^:]*:/.test(lines[j])) break;
        collected.push(lines[j].replace(/^\s{2}/, ""));
      }
      return collected.join(value === ">" ? " " : "\n").trim();
    }

    return unquote(value);
  }

  return null;
}

function requiresFromFrontmatter(skillMdPath) {
  const text = readFileSync(skillMdPath, "utf8");
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") return null;

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === "---") return null;
    const match = line.match(/^requires:\s*(.*)$/);
    if (!match) continue;

    const value = stripTrailingComment(match[1].trim());
    if (!value) {
      const values = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        const candidate = lines[j];
        if (candidate === "---" || /^\S[^:]*:/.test(candidate)) break;
        if (!candidate.trim() || /^\s*#/.test(candidate)) continue;

        const item = candidate.match(/^\s+-\s*(.*)$/);
        if (!item) {
          values.push(unquote(candidate));
          continue;
        }
        values.push(unquote(item[1]));
      }
      return { values, offending: values.length ? null : "<empty list>" };
    }

    if (!value.startsWith("[") || !value.endsWith("]")) {
      return { values: null, offending: unquote(value) };
    }

    const contents = value.slice(1, -1).trim();
    if (!contents) return { values: [], offending: "[]" };

    return {
      values: contents.split(",").map((item) => unquote(item)),
      offending: null,
    };
  }

  return null;
}

const skillEntries = readdirSync(skillsRoot)
  .filter((name) => !name.startsWith(".") && !name.startsWith("_"))
  .map((name) => ({ name, dir: join(skillsRoot, name) }))
  .filter(({ dir }) => statSync(dir).isDirectory())
  .filter(({ dir }) => {
    try {
      return statSync(join(dir, "SKILL.md")).isFile();
    } catch {
      return false;
    }
  });

let totalDescriptionChars = 0;
let maxSeen = { name: "", chars: 0 };

for (const { name, dir } of skillEntries) {
  const skillMd = join(dir, "SKILL.md");
  const description = descriptionFromFrontmatter(skillMd);
  const requires = requiresFromFrontmatter(skillMd);

  if (!description) {
    fail(`ERROR ${name}: missing frontmatter description`);
    continue;
  }

  const chars = [...description].length;
  totalDescriptionChars += chars;
  if (chars > maxSeen.chars) maxSeen = { name, chars };

  if (chars > maxDescription) {
    fail(`ERROR ${name}: description is ${chars} chars; max is ${maxDescription}`);
  }

  if (requires) {
    const expected =
      "expected a non-empty list of environment variable names matching /^[A-Z][A-Z0-9_]*$/";

    if (!requires.values?.length) {
      const secretReason = secretValueReason(requires.offending);
      if (secretReason) {
        failSecretValue(name, "value", secretReason, expected);
      } else {
        fail(
          `ERROR ${name}: requires has invalid value ${JSON.stringify(requires.offending)}; ${expected}`,
        );
      }
    } else {
      for (const [index, value] of requires.values.entries()) {
        if (isValidRequirementName(value)) continue;

        const secretReason = secretValueReason(value);
        if (secretReason) {
          failSecretValue(
            name,
            `entry ${index + 1} of ${requires.values.length}`,
            secretReason,
            expected,
          );
          continue;
        }

        fail(
          `ERROR ${name}: requires has invalid value ${JSON.stringify(value)}; ${expected}`,
        );
      }
    }
  }

  if (enforceRetired && retired.has(name)) {
    fail(`ERROR ${name}: confirmed-retired skill is still active`);
  }
}

const estimatedTokens = Math.ceil(totalDescriptionChars / 4);
if (!process.exitCode) {
  console.log(
    [
      `OK skills=${skillEntries.length}`,
      `description_chars=${totalDescriptionChars}`,
      `estimated_tokens=${estimatedTokens}`,
      `max_description=${maxSeen.name}:${maxSeen.chars}`,
    ].join(" "),
  );
}
