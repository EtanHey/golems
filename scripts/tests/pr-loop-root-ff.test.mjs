import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Executes the documented root fast-forward block (pr-loop § After Merge:
// Update Tracking, step 1) against throwaway Git fixtures. "Leads keep the root
// checkout ff-only current after each merge." (Etan 2026-10-19, via orc) The
// block must fail closed: off the default branch, on a fetch failure or on a
// divergent root it stops nonzero before the diff and leaves every ref as it was.
const here = path.dirname(fileURLToPath(import.meta.url));
const doc = path.join(here, "..", "..", "skills", "golem-powers", "pr-loop", "references",
  "merge-and-verification.md");

test("cleanup receipt requires removal proof and escalates preserved worktrees", () => {
  const receipt = readFileSync(doc, "utf8").split("### Cleanup Receipt")[1];
  assert.ok(receipt.includes("- worktree: <path> removed; proof: absent from git worktree list --porcelain after git worktree prune"));
  assert.ok(receipt.includes("OR worktree: <path> kept because <reason>; escalated to <lead>"));
  assert.ok(receipt.includes("A receipt without removal proof or an escalated preservation exception is invalid."));
  assert.match(receipt, /local-only[\s\S]*dirty[\s\S]*lead/);
  const recipe = receipt.match(/```bash\n([\s\S]*?)\n\s*```/)[1];
  assert.match(recipe, /worktree remove[\s\S]*worktree prune[\s\S]*worktree list --porcelain/);
  assert.ok(!recipe.includes("--force"));
  assert.ok(recipe.includes('echo "worktree: $WT removed; proof:'), "recipe must print the receipt worktree field");
});

// Discover guidance recursively, including every adapter format. Test/eval data
// and executable helpers are not agent instructions; Markdown/YAML anywhere
// under skills and all adapter files are, without a fixed skill/path allowlist.
function* skillGuidance(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* skillGuidance(file);
    else if (entry.isFile() && (/\.(md|ya?ml)$/i.test(file) || file.split(path.sep).includes("adapters"))) yield file;
  }
}

test("all skill guidance and adapters mentioning git worktree remove require prune and absence proof", () => {
  const skills = path.resolve(here, "../../skills");
  const violations = [];
  let checked = 0;
  for (const file of skillGuidance(skills)) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("git worktree remove")) continue;
    checked++;
    for (const [requirement, pattern] of [
      ["git worktree prune", /git worktree prune/],
      ["porcelain absence proof", /absent\s+from\s+`?git worktree list --porcelain/],
      ["no forced removal", /(?:no|without) (?:`)?--force/],
      ["dirty preservation", /dirty/i],
      ["local-only preservation", /local-only/],
      ["lead escalation", /(?:escalat[\s\S]*lead|lead[\s\S]*escalat)/i],
    ]) {
      if (!pattern.test(text)) violations.push(`${path.relative(skills, file)}: missing ${requirement}`);
    }
  }
  assert.ok(checked > 0, "no worktree removal guidance discovered");
  assert.deepEqual(violations, []);
});

test("cleanup root field grammar accepts proof or STOP and rejects incomplete receipts", () => {
  const receipt = readFileSync(doc, "utf8").split("### Cleanup Receipt")[1];
  const grammar = new RegExp(receipt.match(/```regex\n([^\n]+)\n```/)[1]);
  const sha = "a".repeat(40);
  for (const remote of ["origin/main", "upstream/master"]) {
    const ok = `root: /repo HEAD=${sha} ${remote}=${sha} ahead/behind=0/0`;
    assert.equal(grammar.test(ok), true);
    for (const counts of ["0/1", "1/0", "1/1"]) assert.equal(grammar.test(ok.replace("0/0", counts)), false);
    assert.equal(grammar.test(ok.replace(`HEAD=${sha}`, `HEAD=${"b".repeat(40)}`)), false);
    assert.equal(grammar.test(ok.replaceAll(sha, "abc123")), false);
  }
  for (const line of ["ROOT-FF STOP: not merged", "ROOT-FF STOP: ff-only failed"]) assert.equal(grammar.test(line), true);
  for (const line of ["root: ok", "", "worktree: /repo removed", "ROOT-FF STOP: "]) assert.equal(grammar.test(line), false);
});

function documentedBlock() {
  const section = readFileSync(doc, "utf8").split("### After Merge: Update Tracking (MANDATORY)")[1];
  const fenced = section.match(/^( *)```bash\n([\s\S]*?)^\1```/m);
  if (!fenced) throw new Error("no bash block under After Merge: Update Tracking");
  const indent = fenced[1].length;
  return fenced[2].split("\n").map((line) => line.slice(indent)).join("\n");
}

const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.com",
  GIT_COMMITTER_NAME: "fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.com",
};
const dirs = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function git(cwd, ...args) {
  const run = spawnSync("git", args, { cwd, env, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
  return run.stdout.trim();
}

function commit(repo, file, text) {
  writeFileSync(path.join(repo, file), text);
  git(repo, "add", file);
  git(repo, "commit", "-q", "-m", `edit ${file}`);
  return git(repo, "rev-parse", "HEAD");
}

// origin.git (bare) <- root (the lead's main checkout) and upstream (another
// clone that lands the merged PR on origin/main).
function fixture(defaultBranch = "main", remote = "origin") {
  const dir = mkdtempSync(path.join(os.tmpdir(), "root-ff-"));
  dirs.push(dir);
  const origin = path.join(dir, "origin.git");
  git(dir, "init", "-q", "--bare", "-b", defaultBranch, origin);
  const seed = path.join(dir, "seed");
  git(dir, "clone", "-q", origin, seed);
  git(seed, "switch", "-q", "-c", defaultBranch);
  commit(seed, "AGENTS.md", "v1\n");
  commit(seed, "app.txt", "v1\n");
  git(seed, "push", "-q", "origin", defaultBranch);
  const root = path.join(dir, "root");
  git(dir, "clone", "-q", origin, root);
  if (remote !== "origin") {
    git(root, "remote", "rename", "origin", remote);
    git(root, "remote", "add", "origin", seed);
  }
  const upstream = path.join(dir, "upstream");
  git(dir, "clone", "-q", origin, upstream);
  const land = (file = "AGENTS.md") => {
    const sha = commit(upstream, file, `merged ${Math.random()}\n`);
    git(upstream, "push", "-q", "origin", defaultBranch);
    return sha;
  };
  return { root, land };
}

const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
function runBlock(shell, root, defaultBranch = "main") {
  const block = documentedBlock()
    .replace("'<root>'", quote(root))
    .replace("'<default>'", quote(defaultBranch));
  return spawnSync(shell, ["-c", block], { env, encoding: "utf8" });
}

const shells = ["bash", ...(spawnSync("zsh", ["-c", "true"]).status === 0 ? ["zsh"] : [])];

test("the documented block carries placeholders and never forces", () => {
  const block = documentedBlock();
  assert.ok(block.includes("'<root>'"));
  assert.ok(block.includes("'<default>'"));
  assert.ok(block.includes("merge -q --ff-only"));
  assert.doesNotMatch(block, /\breset\b|--force|\bstash\b|\brebase\b|\bpull\b|\bcheckout\b|\bswitch\b/);
});

for (const shell of shells) {
  for (const [remote, defaultBranch] of [["origin", "main"], ["upstream", "master"]]) {
    test(`${shell}: ${remote}/${defaultBranch} fast-forwards and prints root proof`, () => {
      const { root, land } = fixture(defaultBranch, remote);
      git(root, "config", "--add", `remote.${remote}.fetch`, `^refs/heads/${defaultBranch}`);
      const merged = land("AGENTS.md");
      const run = runBlock(shell, root, defaultBranch);
      assert.equal(run.status, 0);
      assert.equal(git(root, "rev-parse", "HEAD"), merged);
      assert.deepEqual(run.stdout.trim().split("\n"), ["AGENTS.md", `root: ${root} HEAD=${merged} ${remote}/${defaultBranch}=${merged} ahead/behind=0/0`]);
    });
  }

  for (const state of ["ahead", "no-upstream"]) {
    test(`${shell}: ${state} root emits STOP, never OK proof`, () => {
      const { root } = fixture();
      if (state === "ahead") commit(root, "app.txt", "local work\n");
      else git(root, "branch", "--unset-upstream");
      const before = git(root, "rev-parse", "HEAD");
      const run = runBlock(shell, root);
      assert.notEqual(run.status, 0);
      assert.ok(run.stderr.includes("ROOT-FF STOP:"));
      assert.ok(!run.stdout.includes("root:"));
      assert.equal(git(root, "rev-parse", "HEAD"), before);
    });
  }

  test(`${shell}: a root on a feature branch stops nonzero and merges nothing`, () => {
    const { root, land } = fixture();
    const mainBefore = git(root, "rev-parse", "main");
    git(root, "switch", "-q", "-c", "feature");
    const featureBefore = git(root, "rev-parse", "HEAD");
    land();
    const run = runBlock(shell, root);
    assert.notEqual(run.status, 0);
    assert.ok(run.stderr.includes("not merging"));
    assert.equal(run.stdout, "");
    assert.equal(git(root, "rev-parse", "main"), mainBefore);
    assert.equal(git(root, "rev-parse", "feature"), featureBefore);
  });

  test(`${shell}: a divergent root stops nonzero before the diff and keeps its commit`, () => {
    const { root, land } = fixture();
    const local = commit(root, "app.txt", "local work\n");
    land();
    const run = runBlock(shell, root);
    assert.notEqual(run.status, 0);
    assert.ok(run.stderr.includes("never force"));
    assert.equal(run.stdout, "");
    assert.equal(git(root, "rev-parse", "HEAD"), local);
  });

  test(`${shell}: a failed fetch stops nonzero before the merge`, () => {
    const { root, land } = fixture();
    const before = git(root, "rev-parse", "HEAD");
    land();
    git(root, "remote", "set-url", "origin", path.join(path.dirname(root), "missing.git"));
    const run = runBlock(shell, root);
    assert.notEqual(run.status, 0);
    assert.ok(run.stderr.includes("fetch failed"));
    assert.equal(run.stdout, "");
    assert.equal(git(root, "rev-parse", "HEAD"), before);
  });

  test(`${shell}: unsubstituted placeholders fail closed`, () => {
    const run = spawnSync(shell, ["-c", documentedBlock()], { env, encoding: "utf8" });
    assert.notEqual(run.status, 0);
    assert.equal(run.stdout, "");
  });
}
