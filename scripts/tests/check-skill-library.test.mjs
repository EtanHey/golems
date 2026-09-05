import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, test } from "node:test";

const checker = fileURLToPath(
  new URL("../check-skill-library.mjs", import.meta.url),
);
const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function runChecker(frontmatter, skillName = "fixture-skill") {
  const skillsRoot = mkdtempSync(join(tmpdir(), "check-skill-library-"));
  temporaryRoots.push(skillsRoot);

  const skillMd = join(skillsRoot, skillName, "SKILL.md");
  mkdirSync(dirname(skillMd), { recursive: true });
  writeFileSync(
    skillMd,
    [
      "---",
      `name: ${skillName}`,
      'description: "Use when testing skill metadata."',
      frontmatter,
      "---",
      "",
      `# ${skillName}`,
      "",
    ]
      .filter((line) => line !== null)
      .join("\n"),
  );

  return spawnSync(
    process.execPath,
    [checker, `--skills-root=${skillsRoot}`, "--max-description=1024"],
    { encoding: "utf8" },
  );
}

function escapedPattern(value) {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

function combinedOutput(result) {
  return `${result.stdout}${result.stderr}`;
}

function assertOrdinaryRejection(result, offending) {
  const output = combinedOutput(result);
  assert.notEqual(result.status, 0);
  assert.match(output, /ERROR invalid-requires-skill:/);
  assert.match(output, /requires/);
  assert.match(output, escapedPattern(offending));
  assert.match(output, /expected.*environment variable names/i);
}

function assertSecretRejection(result, secretValue) {
  const output = combinedOutput(result);
  assert.notEqual(result.status, 0);
  assert.match(output, /ERROR invalid-requires-skill:/);
  assert.match(output, /requires/);
  assert.match(output, /suspected secret value/i);
  assert.match(output, /environment variable names/i);
  assert.doesNotMatch(output, escapedPattern(secretValue));
}

test("accepts a skill with no requires declaration", () => {
  const result = runChecker(null);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^OK skills=1\b/);
});

test("accepts an inline requires list of environment variable names", () => {
  const result = runChecker("requires: [FOO_TOKEN, BAR_TOKEN]");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^OK skills=1\b/);
});

test("accepts a block requires list of environment variable names", () => {
  const result = runChecker("requires:\n  - FOO_TOKEN\n  - BAR_TOKEN");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^OK skills=1\b/);
});

test("accepts long legitimate names and names that collide with secret prefixes", () => {
  const result = runChecker(
    "requires: [AWS_SECRET_ACCESS_KEY_ID_OVERRIDE, BRAINLAYER_DB_PATH_V2, ASIA_PACIFIC_REGION, GITHUB_PAT_PATH, SK_LIVE_MODE_ENABLED, AKIA_KEY_ROTATION_DAYS, AIZAWA_ATTRACTOR_SEED]",
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^OK skills=1\b/);
});

for (const { name, declaration, offending } of [
  {
    name: "lowercase name",
    declaration: "requires: [foo_TOKEN]",
    offending: "foo_TOKEN",
  },
  {
    name: "hyphenated name",
    declaration: "requires: [FOO-TOKEN]",
    offending: "FOO-TOKEN",
  },
  {
    name: "quoted sentence",
    declaration: 'requires: ["needs the api key from 1password"]',
    offending: "needs the api key from 1password",
  },
  {
    name: "empty requires list",
    declaration: "requires: []",
    offending: "[]",
  },
  {
    name: "bare scalar",
    declaration: "requires: FOO_TOKEN",
    offending: "FOO_TOKEN",
  },
  {
    name: "empty block list",
    declaration: "requires:",
    offending: "<empty list>",
  },
  {
    name: "invalid block-list entry",
    declaration: "requires:\n  - foo_TOKEN",
    offending: "foo_TOKEN",
  },
]) {
  test(`rejects malformed requires metadata: ${name}`, () => {
    const result = runChecker(declaration, "invalid-requires-skill");

    assertOrdinaryRejection(result, offending);
  });
}

for (const { name, value } of [
  { name: "AWS access key", value: "AKIAIOSFODNN7EXAMPLE" },
  { name: "AWS temporary access key", value: "ASIAIOSFODNN7EXAMPLE" },
  { name: "GitHub classic PAT", value: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456" },
  { name: "GitHub OAuth token", value: "gho_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456" },
  { name: "GitHub server token", value: "ghs_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456" },
  {
    name: "GitHub fine-grained PAT",
    value: "github_pat_11AA0BBBB0CCCC0DDDD0EEEE0FFFF",
  },
  { name: "OpenAI legacy key", value: "SK-ABCDEFGHIJKLMNOP123456" },
  { name: "Stripe live key", value: "sk_live_ABCDEFGHIJKLMNOP123456" },
  { name: "Stripe test key", value: "sk_test_ABCDEFGHIJKLMNOP123456" },
  { name: "Slack bot token", value: "xoxb-1234567890-ABCDEFGHIJKLMNOP" },
  { name: "Slack user token", value: "xoxp-1234567890-ABCDEFGHIJKLMNOP" },
  { name: "Slack app token", value: "xapp-1234567890-ABCDEFGHIJKLMNOP" },
  { name: "Google API key", value: "AIzaSyABCDEFGHIJKLMNOP1234567890" },
  { name: "GitLab PAT", value: "glpat-ABCDEFGHIJKLMNOP123456" },
]) {
  test(`rejects and redacts known secret prefix: ${name}`, () => {
    const result = runChecker(
      `requires: [${value}]`,
      "invalid-requires-skill",
    );

    assertSecretRejection(result, value);
  });
}

for (const { name, value } of [
  {
    name: "GitHub fine-grained PAT with a body separator",
    value:
      "github_pat_11ABCDEFG0abcdefghijkl_MnOpQrStUvWxYz0123456789AbCdEfGhIjKlMnOpQrStUvWxYz01",
  },
  {
    name: "OpenAI project key with a base64url underscore",
    value: "sk-proj-Ab3d_EfGhIjKlMnOpQrStUvWxYz0123456789T3BlbkFJ",
  },
  {
    name: "Stripe key with an underscore in its body",
    value: "sk_live_51Lh12345_67890abcdefXYZ",
  },
  {
    name: "known prefix with an eleven-character remainder",
    value: "ghp_ABCDEFGHIJK",
  },
  {
    name: "known prefix followed by a zero-width space",
    value: "sk_live_\u200B51Lh1234567890abcdef",
  },
  {
    name: "unprefixed lowercase hexadecimal key",
    value: "9c8b7a6d5e4f3210abcdef9876543210",
  },
  {
    name: "unprefixed mixed-case base64 key",
    value: "Zk7QvR2mT9xW4bN6pL1aS8dF3gH5jK0c",
  },
  {
    name: "unrecognized provider key",
    value: "ant-api03-Xy9Zb2Kc4Md6Ne8Of0Pg1Qh3Ri5Sj7",
  },
  {
    name: "previously covered Stripe control",
    value: "sk_live_51Lh1234567890abcdef",
  },
]) {
  test(`rejects and redacts the reviewer probe: ${name}`, () => {
    const result = runChecker(
      `requires: [${value}]`,
      "invalid-requires-skill",
    );

    assertSecretRejection(result, value);
  });
}

for (const { name, value } of [
  {
    name: "known prefix after an alphanumeric character",
    value: "MYKEYsk_live_51Lh1234567890abcdef",
  },
  {
    name: "known prefix after an underscore",
    value: "TOKEN_sk_live_51Lh1234567890abcdef",
  },
]) {
  test(`rejects and redacts a secret with ${name}`, () => {
    const result = runChecker(
      `requires: [${value}]`,
      "invalid-requires-skill",
    );

    assertSecretRejection(result, value);
  });
}

test("normalizes a zero-width format character before prefix matching", () => {
  const value = "s\u200Bk_live_51Lh1234567890abcdef";
  const result = runChecker(
    `requires: [${value}]`,
    "invalid-requires-skill",
  );

  assertSecretRejection(result, value);
});

test("rejects a format-contaminated environment variable name", () => {
  const value = "FOO_TOK\u200BEN";
  const result = runChecker(
    `requires: [${value}]`,
    "invalid-requires-skill",
  );

  assertOrdinaryRejection(result, value);
});

test("rejects and redacts a credential-shaped alphanumeric value", () => {
  const value = "CREDENTIALVALUE123456";
  const result = runChecker(
    `requires: [${value}]`,
    "invalid-requires-skill",
  );

  assertSecretRejection(result, value);
  assert.match(result.stderr, /credential-like shape/i);
});

for (const { name, declaration } of [
  {
    name: "quoted scalar",
    declaration: 'requires: "sk_live_51Lh1234567890abcdef"',
  },
  {
    name: "unterminated inline list",
    declaration: "requires: [sk_live_51Lh1234567890abcdef",
  },
  {
    name: "flow map",
    declaration: "requires: {token: sk_live_51Lh1234567890abcdef}",
  },
  {
    name: "bare scalar",
    declaration: "requires: sk_live_51Lh1234567890abcdef",
  },
]) {
  test(`rejects and redacts a secret in the scalar/offending path: ${name}`, () => {
    const value = "sk_live_51Lh1234567890abcdef";
    const result = runChecker(declaration, "invalid-requires-skill");

    assertSecretRejection(result, value);
  });
}

test("accepts a valid inline list with a trailing YAML comment without echoing it", () => {
  const commentValue = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456";
  const result = runChecker(`requires: [FOO_TOKEN] # ${commentValue}`);

  assert.equal(result.status, 0, combinedOutput(result));
  assert.match(result.stdout, /^OK skills=1\b/);
  assert.doesNotMatch(combinedOutput(result), escapedPattern(commentValue));
});

test("reports a safe entry index for a redacted list value", () => {
  const value = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456";
  const result = runChecker(
    `requires: [ALPHA_TOKEN, ${value}, BETA_TOKEN, GAMMA_TOKEN]`,
    "invalid-requires-skill",
  );

  assertSecretRejection(result, value);
  assert.match(combinedOutput(result), /entry 2 of 4/i);
});

test("continues validating a block requires list after a comment", () => {
  const value = "sk_live_51Lh1234567890abcdef";
  const result = runChecker(
    `requires:\n  - FOO_TOKEN\n  # note\n  - ${value}`,
    "invalid-requires-skill",
  );

  assertSecretRejection(result, value);
});

test("continues validating a block requires list after a blank line", () => {
  const value = "foo-bad-token";
  const result = runChecker(
    `requires:\n  - FOO_TOKEN\n\n  - ${value}`,
    "invalid-requires-skill",
  );

  assertOrdinaryRejection(result, value);
});
