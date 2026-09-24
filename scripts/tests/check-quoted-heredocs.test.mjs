import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// An unquoted `<<EOF` runs the body's backticks and $() — a collab post with a
// code span once restarted VoiceBar. Deliberate WRONG examples carry ALLOW on the line above.
const UNQUOTED_APPEND = /\b(?:cat\s*>>|tee\s+-a)\s*\S+\s*<<-?\s*[A-Za-z_]/;
const ALLOW = "heredoc-lint: allow-unquoted";
const root = fileURLToPath(new URL("../..", import.meta.url));

test("skills append with quoted heredocs only", () => {
  const files = execFileSync("git", ["ls-files", "skills/golem-powers"], { cwd: root, encoding: "utf8" })
    .split("\n").filter((file) => file && !file.includes("/evals/fixtures/"));
  const hits = files.flatMap((file) => readFileSync(join(root, file), "utf8").split("\n").flatMap((line, i, lines) =>
    UNQUOTED_APPEND.test(line) && !lines[i - 1]?.includes(ALLOW) ? [`${file}:${i + 1}: ${line.trim()}`] : []));
  assert.deepEqual(hits, [], "use <<'EOF' (quoted) so the body stays literal");
});
