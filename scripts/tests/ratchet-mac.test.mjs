import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const here = resolve(import.meta.dir, "../ratchet");
const scratch = [];

afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
});

function repo() {
  const path = mkdtempSync(join(tmpdir(), "ratchet-mac-"));
  scratch.push(path);
  const git = (...args) => execFileSync("git", ["-C", path, ...args], { encoding: "utf8", stdio: "pipe" });
  git("init", "-q");
  const commit = (message) => {
    git("add", "-A");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", message);
    return git("rev-parse", "HEAD").trim();
  };
  return { path, git, commit };
}

describe("guarded-paths.sh (B1: FAIL, never skip, on a git error or a large diff)", () => {
  const guarded = (cwd, base, head) => spawnSync("bash", [join(here, "guarded-paths.sh"), base, head], { cwd, encoding: "utf8" });

  test("a guarded path is found even past a >64 KiB path list, and an unguarded diff is not", () => {
    const { path, commit } = repo();
    writeFileSync(join(path, "README"), "x\n");
    const base = commit("base");
    mkdirSync(join(path, "zdocs"));
    for (let i = 0; i < 4000; i += 1) writeFileSync(join(path, "zdocs", `page-${String(i).padStart(5, "0")}-with-a-long-name.md`), "x\n");
    const unguarded = commit("docs");
    expect(guarded(path, base, unguarded).status).toBe(1);
    mkdirSync(join(path, "scripts/hooks"), { recursive: true });
    writeFileSync(join(path, "scripts/hooks/a.py"), "x\n");
    const head = commit("hook");
    // The guarded path sorts FIRST, so an early-exiting grep would SIGPIPE the rest of the list.
    expect(execFileSync("git", ["-C", path, "diff", "--name-only", `${base}...${head}`], { encoding: "utf8" }).startsWith("scripts/hooks/a.py")).toBe(true);
    const names = execFileSync("git", ["-C", path, "diff", "--name-only", `${base}...${head}`], { encoding: "utf8" });
    expect(names.length).toBeGreaterThan(64 * 1024);
    expect(guarded(path, base, head).status).toBe(0);
  });

  test("a git error (unknown base) exits 2, never 'not guarded'", () => {
    const { path, commit } = repo();
    writeFileSync(join(path, "README"), "x\n");
    const head = commit("only");
    const out = guarded(path, "f".repeat(40), head);
    expect(out.status).toBe(2);
  });
});

describe("post decision (B2 + M3)", () => {
  const H = "c".repeat(40);
  const decide = (...args) => spawnSync("bash", ["-c", `source "${join(here, "lib.sh")}"; ratchet_post_mode "$@"`, "decide", ...args], { encoding: "utf8" }).stdout.trim();
  // args: install head with_count private_manifest private_files_count here_head here_dirty

  test("only the PR head, unmodified suite, run from a clean checkout AT the head, posts", () => {
    expect(decide(H, H, "0", "", "0", H, "0")).toBe("post");
  });

  test("any override that changes what is measured is a replay and never posts", () => {
    expect(decide("a".repeat(40), H, "0", "", "0", H, "0")).toMatch(/^replay/);
    expect(decide(H, H, "1", "", "0", H, "0")).toMatch(/^replay/);
    expect(decide(H, H, "0", "/x/manifest.json", "0", H, "0")).toMatch(/^replay/);
    expect(decide(H, H, "0", "", "1", H, "0")).toMatch(/^replay/);
  });

  test("a head run from another commit's scripts, or a dirty checkout, is refused", () => {
    expect(decide(H, H, "0", "", "0", "d".repeat(40), "0")).toMatch(/^refuse/);
    expect(decide(H, H, "0", "", "0", H, "1")).toMatch(/^refuse/);
  });
});

describe("local-run.sh PR body forwarding", () => {
  const H = "c".repeat(40);
  function fixture() {
    const path = mkdtempSync(join(tmpdir(), "ratchet-local-run-"));
    scratch.push(path);
    const bin = join(path, "bin");
    mkdirSync(bin);
    mkdirSync(join(path, "repo/.git"), { recursive: true });
    const stub = (name, body) => writeFileSync(join(bin, name), `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, { mode: 0o755 });
    // Exercise the real shell entry point; isolate installs, keys, rows and network calls.
    stub("git", `
      if [ "$1" = -C ]; then shift 2; fi
      case "$1" in
        rev-parse)
          if [ "$2" = --git-common-dir ]; then echo "$FIXTURE/repo/.git"; else echo "$FIXTURE_HEAD"; fi ;;
        status|remote|fetch|checkout|worktree) ;;
        clone) while [ "$#" -gt 1 ]; do shift; done; mkdir -p "$1" ;;
        *) echo "unexpected git: $*" >&2; exit 1 ;;
      esac`);
    stub("gh", `
      printf '%s ' "$@" >> "$FIXTURE/gh-calls"
      printf '\\n' >> "$FIXTURE/gh-calls"
      case "$1 $2" in
        'pr view') echo "$FIXTURE_HEAD fixture-branch OPEN $FIXTURE_HEAD" ;;
        'api repos/EtanHey/golems/pulls/763')
          if [ "$BODY_FETCH_FAIL" = 1 ]; then echo 'body fetch failed' >&2; exit 1; fi
          cat "$FIXTURE/fetched-body.md" ;;
        'api user') echo EtanHey ;;
        'run list') ;;
        *) echo "unexpected gh: $*" >&2; exit 1 ;;
      esac`);
    stub("ssh-keygen", `
      while [ "$1" != -f ]; do shift; done
      : > "$2"
      echo 'ssh-ed25519 fixture' > "$2.pub"`);
    stub("chflags", ":");
    stub("python3", ":");
    stub("node", `
      case "$1" in
        */install-hooks.mjs) echo 'fixture installer' ;;
        */run-rows.mjs)
          while [ "$1" != --out ]; do shift; done
          echo '{}' > "$2" ;;
        */table.mjs) printf '%s\\n' "$@" > "$FIXTURE/table-args" ;;
        *) echo "unexpected node: $*" >&2; exit 1 ;;
      esac`);
    const body = "ratchet-loosen: installed-skill-parity lead ruling: candidate parity metric\n";
    writeFileSync(join(path, "fetched-body.md"), body);
    const invoke = (args = [], env = {}) => spawnSync("bash", [join(here, "local-run.sh"), "--pr", "763", ...args], {
      encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: join(path, "home"),
        GH_TOKEN: "fixture-token", FIXTURE: path, FIXTURE_HEAD: H, BODY_FETCH_FAIL: "0", ...env },
    });
    const tableArgs = () => readFileSync(join(path, "table-args"), "utf8").trim().split("\n");
    return { path, body, invoke, tableArgs };
  }

  test("post mode fetches the exact PR body and forwards its run file, overriding a supplied body", () => {
    const f = fixture();
    const supplied = join(f.path, "supplied body.md");
    writeFileSync(supplied, "ratchet-loosen: other caller-supplied ruling\n");
    const out = f.invoke(["--pr-body-file", supplied]);
    expect(out.status).toBe(0);
    const args = f.tableArgs();
    expect(args).toContain("--pr-body-file");
    const bodyPath = args[args.indexOf("--pr-body-file") + 1];
    expect(bodyPath.startsWith(join(f.path, "repo/docs.local/ratchet-runs", `pr763-${H.slice(0, 12)}-`))).toBe(true);
    expect(bodyPath.endsWith("/pr-body.md")).toBe(true);
    expect(readFileSync(bodyPath, "utf8")).toBe(f.body);
    expect(args).toContain("--pr");
    expect(readFileSync(join(f.path, "gh-calls"), "utf8")).toContain("api repos/EtanHey/golems/pulls/763 --jq .body");
  });

  test("a failed body fetch refuses to post or invoke table.mjs", () => {
    const f = fixture();
    const out = f.invoke([], { BODY_FETCH_FAIL: "1" });
    expect(out.status).toBe(2);
    expect(out.stderr).toContain("refusing to post");
    expect(existsSync(join(f.path, "table-args"))).toBe(false);
    expect(readFileSync(join(f.path, "gh-calls"), "utf8")).not.toContain("run list");
  });

  for (const args of [["--no-post"], ["--install", "a".repeat(40)]]) {
    test(`${args[0]} forwards an optional body file without fetching or posting`, () => {
      const f = fixture();
      const body = join(f.path, "replay body.md");
      writeFileSync(body, f.body);
      const out = f.invoke([...args, "--pr-body-file", body]);
      expect(out.status).toBe(0);
      const forwarded = f.tableArgs();
      expect(forwarded[forwarded.indexOf("--pr-body-file") + 1]).toBe(body);
      expect(forwarded).not.toContain("--pr");
      expect(readFileSync(join(f.path, "gh-calls"), "utf8")).not.toContain("api repos/");
    });
  }

  test("--no-post still accepts runs without a PR body file", () => {
    const f = fixture();
    expect(f.invoke(["--no-post"]).status).toBe(0);
    expect(f.tableArgs()).not.toContain("--pr-body-file");
  });
});

describe("status.sh (M1: an installer that fails to run is FAIL, never 0 problems)", () => {
  function fakeClone(installer) {
    const { path, commit } = repo();
    mkdirSync(join(path, "scripts/hooks"), { recursive: true });
    writeFileSync(join(path, "scripts/hooks/install-hooks.mjs"), installer);
    return { path, sha: commit("fake installer") };
  }
  const status = ({ path, sha }) => spawnSync("bash", [join(here, "mac/status.sh")], {
    encoding: "utf8", env: { ...process.env, RATCHET_RUN: path, RATCHET_CLONE: path, RATCHET_HOME: path, RATCHET_INSTALLED: sha },
  });

  test("a crashing installer FAILs", () => {
    expect(status(fakeClone("throw new Error('boom');\n")).status).not.toBe(0);
  });

  test("an installer that prints no complete status FAILs", () => {
    expect(status(fakeClone("console.log('hooks-live=x master=x drift=0');\n")).status).not.toBe(0);
  });

  test("a complete status with no problems prints 0", () => {
    const out = status(fakeClone("console.log('hooks-live=x master=x drift=0');\nconsole.log('settings-drift=0');\nprocess.exit(1);\n"));
    expect(out.status).toBe(0);
    expect(out.stdout.trim().split("\n").pop()).toBe("0");
  });
});
