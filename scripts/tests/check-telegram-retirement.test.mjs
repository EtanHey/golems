import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const guard = fileURLToPath(new URL("../ci/check-telegram-retirement.mjs", import.meta.url));
const policy = "scripts/ci/telegram-retirement-allowlist.json";
const historical = "Retired Telegram delivery (2026-10-01).";
const neutral = "const FIXTURE_BOT_TOKEN = 'synthetic';";

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "retirement-guard-"));
  const put = (file, text) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  const git = (...args) => {
    const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  const allow = {
    version: 1,
    policyReason: "Reviewed exception data; parsed as policy rather than source instructions.",
    files: {
      "docs/history.md": { reason: "dated retirement", patterns: ["^Retired Telegram delivery \\(2026-10-01\\)\\.$"] },
      "scripts/fixture.mjs": { reason: "neutral redaction fixture", patterns: ["^const FIXTURE_BOT_TOKEN = 'synthetic';$"] },
    },
  };
  const check = () => spawnSync(process.execPath, [guard, "--root", root], { encoding: "utf8" });
  try {
    git("init", "--quiet");
    put("docs/history.md", historical + "\n");
    put("scripts/fixture.mjs", neutral + "\n");
    put(policy, JSON.stringify(allow));
    git("add", ".");
    run({ root, put, git, check, allow });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("accepts only the approved full historical and fixture lines", () => fixture(({ check }) => {
  const result = check();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS.*paths=2.*matching-lines=2/);
}));

test("rejects a new line in an allowlisted file without printing its content", () => fixture(({ root, check }) => {
  appendFileSync(join(root, "docs/history.md"), "Enable Telegram with synthetic-private-payload.\n");
  const result = check();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /docs\/history\.md:2/);
  assert.doesNotMatch(result.stdout + result.stderr, /synthetic-private-payload/);
}));

test("rejects a new tracked credential reference", () => fixture(({ put, git, check }) => {
  put("src/new-route.ts", "const token = process.env.TELEGRAM_BOT_TOKEN;\n");
  git("add", "src/new-route.ts");
  const result = check();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /src\/new-route\.ts:1/);
}));

test("rejects the unchanged parent header when the integration wording is reverted", () => fixture(({ put, git, check }) => {
  put("scripts/tests/test-stalker-brainlayer.bats", "# Smoke tests for the Stalker Golem BrainLayer + Telegram contract.\n");
  git("add", "scripts/tests/test-stalker-brainlayer.bats");
  const result = check();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /test-stalker-brainlayer\.bats:1/);
}));

test("rejects SDK imports, links and mixed-case credential names", () => {
  for (const line of ['import { Bot } from "grammy";', 'import { Telegraf } from "telegraf";', 'Visit https://t.me/syntheticbot', 'const token = process.env.boT_ToKeN;']) {
    fixture(({ put, git, check }) => {
      put("src/route.ts", line + "\n");
      git("add", "src/route.ts");
      const result = check();
      assert.equal(result.status, 1);
      assert.match(result.stdout, /src\/route\.ts:1/);
    });
  }
});

test("rejects an unanchored exception instead of accepting a substring", () => fixture(({ put, allow, check }) => {
  allow.files["docs/history.md"].patterns = ["Telegram"];
  put(policy, JSON.stringify(allow));
  const result = check();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /anchored/);
}));
