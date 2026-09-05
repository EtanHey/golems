import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
  buildHookEntry,
  buildLaunchdEntry,
  buildReport,
  findUnusedEnvironmentKeys,
  formatHumanReport,
  isManagedLabel,
  normalizePlist,
  parseLaunchctlPrint,
  plistsMatch,
  reportExitCode,
  selectManagedTarget,
} from "../deploy-drift-check-lib.mjs";
import {
  discoverGitRepositories,
  discoverInstalledPlists,
  inspectCheckout,
  inspectTarget,
  parseArgs,
  readPlist,
  sha256File,
} from "../deploy-drift-check.mjs";

describe("launchd plist semantics", () => {
  test("scopes only golems-owned labels", () => {
    expect(isManagedLabel("com.golems.render-service")).toBe(true);
    expect(isManagedLabel("com.golemszikaron.telegram")).toBe(true);
    expect(isManagedLabel("com.cmuxlayer.server")).toBe(false);
    expect(isManagedLabel("com.brainlayer.phoenix-eval")).toBe(false);
  });

  test("normalizes host paths and removes accepted host/secret environment overrides", () => {
    const source = {
      Label: "com.golemszikaron.telegram",
      ProgramArguments: ["/Users/source/Gits/golems/app.ts"],
      EnvironmentVariables: { HOME: "/Users/source", PATH: "/bin", PORT: "9000" },
    };
    const deployed = {
      EnvironmentVariables: {
        PORT: "9000",
        PATH: "/opt/homebrew/bin:/bin",
        HOME: "/Users/deployed",
        TELEGRAM_BOT_TOKEN: "must-never-appear",
      },
      ProgramArguments: ["/Users/deployed/Gits/golems/app.ts"],
      Label: "com.golemszikaron.telegram",
    };

    expect(plistsMatch(source, deployed)).toBe(true);
    expect(JSON.stringify(normalizePlist(deployed))).not.toContain("must-never-appear");
    expect(normalizePlist(deployed).ProgramArguments[0]).toBe("$HOME/Gits/golems/app.ts");
  });

  test("retains real configuration differences", () => {
    const base = {
      Label: "com.golems.example",
      EnvironmentVariables: { SAMPLE_SECONDS: "600" },
    };
    expect(plistsMatch(base, {
      ...base,
      EnvironmentVariables: { SAMPLE_SECONDS: "3600" },
    })).toBe(false);
  });

  test("selects the managed entrypoint behind common wrappers", () => {
    expect(selectManagedTarget({ ProgramArguments: ["/bin/bash", "/Users/e/Gits/golems/job.sh"] })).toBe("/Users/e/Gits/golems/job.sh");
    expect(selectManagedTarget({ ProgramArguments: ["/Users/e/.bun/bin/bun", "run", "/Users/e/Gits/golems/job.ts", "--execute"] })).toBe("/Users/e/Gits/golems/job.ts");
    expect(selectManagedTarget({ ProgramArguments: ["/venv/bin/python", "/Users/e/Gits/ComfyUI/main.py", "--listen"] })).toBe("/Users/e/Gits/ComfyUI/main.py");
    expect(selectManagedTarget({ ProgramArguments: ["/usr/bin/python3", "-m", "uvicorn", "--app-dir", "/Users/e/Gits/voicelayer/src"] })).toBe("/Users/e/Gits/voicelayer/src");
    expect(selectManagedTarget({ Program: "/opt/homebrew/bin/ollama" })).toBe("/opt/homebrew/bin/ollama");
  });
});

describe("launchctl print parsing", () => {
  test("extracts state, plist path, runs, and numeric last exit", () => {
    const parsed = parseLaunchctlPrint(`gui/501/com.golems.example = {\n\tpath = /Users/e/Library/LaunchAgents/com.golems.example.plist\n\tstate = not running\n\truns = 1729\n\tlast exit code = 127\n}`);
    expect(parsed).toEqual({
      isLoaded: true,
      state: "not running",
      lastExitCode: 127,
      plistPath: "/Users/e/Library/LaunchAgents/com.golems.example.plist",
      runs: 1729,
    });
  });

  test("represents never-exited jobs without inventing a code", () => {
    const parsed = parseLaunchctlPrint("state = running\nlast exit code = (never exited)\nruns = 1");
    expect(parsed.lastExitCode).toBeNull();
    expect(parsed.state).toBe("running");
  });
});

const trackedSource = {
  path: "/Users/e/Gits/golems/launchd/com.golems.example.plist",
  repoRoot: "/Users/e/Gits/golems",
  commit: "a".repeat(40),
  sha256: "b".repeat(64),
};
const deployed = {
  path: "/Users/e/Library/LaunchAgents/com.golems.example.plist",
  sha256: "c".repeat(64),
};
const healthyTarget = {
  path: "/Users/e/Gits/golems/scripts/example.sh",
  exists: true,
  repoRoot: "/Users/e/Gits/golems",
  tracked: true,
  ignored: false,
};
const cleanCheckout = {
  repoRoot: "/Users/e/Gits/golems",
  head: "a".repeat(40),
  upstream: "a".repeat(40),
  relation: "equal",
  dirty: false,
};

describe("launchd entry verdicts", () => {
  test("classifies a fully matching deployed job as OK", () => {
    const entry = buildLaunchdEntry({
      label: "com.golems.example",
      trackedSources: [trackedSource],
      deployed,
      plistMatch: true,
      target: healthyTarget,
      loaded: { isLoaded: true, state: "running", lastExitCode: null, plistPath: deployed.path, runs: 1 },
      checkout: cleanCheckout,
      envContract: { configuredKeys: [], unusedKeys: [] },
    });
    expect(entry.verdict).toBe("OK");
    expect(entry.reasons).toEqual([]);
  });

  test("classifies missing targets and failed loaded jobs as DEAD", () => {
    const missing = buildLaunchdEntry({
      label: "com.golems.render-service",
      trackedSources: [trackedSource],
      target: { ...healthyTarget, exists: false, tracked: false },
    });
    expect(missing.verdict).toBe("DEAD");
    expect(missing.reasons).toContain("execution target is missing");

    const failed = buildLaunchdEntry({
      label: "com.golems.example",
      trackedSources: [trackedSource],
      deployed,
      target: healthyTarget,
      loaded: { isLoaded: true, state: "not running", lastExitCode: 127, plistPath: deployed.path, runs: 1729 },
    });
    expect(failed.verdict).toBe("DEAD");
    expect(failed.reasons).toContain("loaded job last exited with code 127");
  });

  test("keeps installed-without-source visible but non-fatal", () => {
    const entry = buildLaunchdEntry({
      label: "com.golems.untracked",
      trackedSources: [],
      deployed,
      target: healthyTarget,
      checkout: { ...cleanCheckout, relation: "behind" },
      loaded: { isLoaded: true, state: "running", lastExitCode: null, plistPath: deployed.path, runs: 1 },
    });
    const report = buildReport({ source: { repoRoot: "/repo", commit: "a".repeat(40) }, entries: [entry] });
    expect(entry.verdict).toBe("UNTRACKED");
    expect(entry.reasons).toContain("deployed plist has no tracked source");
    expect(reportExitCode(report)).toBe(0);
  });

  test("classifies semantic, duplicate-source, target, and checkout drift", () => {
    const cases = [
      { plistMatch: false },
      { trackedSources: [trackedSource, { ...trackedSource, path: "/other.plist" }] },
      { target: { ...healthyTarget, tracked: false, ignored: true } },
      { checkout: { ...cleanCheckout, dirty: true } },
      { checkout: { ...cleanCheckout, relation: "behind" } },
    ];
    for (const overrides of cases) {
      const entry = buildLaunchdEntry({
        label: "com.golems.example",
        trackedSources: [trackedSource],
        deployed,
        plistMatch: true,
        target: healthyTarget,
        checkout: cleanCheckout,
        ...overrides,
      });
      expect(entry.verdict).toBe("DRIFT");
    }
  });

  test("treats healthy source-only jobs as OK but still validates targets", () => {
    const entry = buildLaunchdEntry({
      label: "com.golems.source-only",
      trackedSources: [trackedSource],
      target: healthyTarget,
      checkout: { ...cleanCheckout, dirty: true, relation: "behind" },
    });
    expect(entry.verdict).toBe("OK");
    expect(entry.deployed).toBeNull();
    expect(entry.warnings).toContain("tracked source is not deployed or loaded");
  });

  test("retired absence is OK and unexpected presence is DRIFT", () => {
    const absent = buildLaunchdEntry({ label: "com.golems.mcp-reaper", retired: true });
    const present = buildLaunchdEntry({ label: "com.golems.mcp-reaper", retired: true, deployed });
    expect(absent.verdict).toBe("OK");
    expect(absent.retiredState).toBe("absent");
    expect(present.verdict).toBe("DRIFT");
    expect(present.retiredState).toBe("present");
  });
});

describe("report contract", () => {
  test("emits schema version 1 with one summary count per entry", () => {
    const entries = [
      buildLaunchdEntry({ label: "com.golems.ok", trackedSources: [trackedSource], target: healthyTarget }),
      buildLaunchdEntry({ label: "com.golems.dead", trackedSources: [trackedSource], target: { ...healthyTarget, exists: false } }),
    ];
    const report = buildReport({
      generatedAt: "2026-07-13T12:34:56.000Z",
      source: { repoRoot: "/repo", commit: "a".repeat(40) },
      entries,
    });
    expect(report.schemaVersion).toBe(1);
    expect(report.generatedAt).toBe("2026-07-13T12:34:56.000Z");
    expect(report.readOnly).toBe(true);
    expect(report.summary).toEqual({ OK: 1, DRIFT: 0, DEAD: 1, UNTRACKED: 0, total: 2 });
    expect(report.entries.length).toBe(report.summary.total);
    expect(reportExitCode(report)).toBe(1);
  });

  test("inspection errors force exit 2 and cannot become OK", () => {
    const entry = buildLaunchdEntry({
      label: "com.golems.unknown",
      inspectionErrors: [{ operation: "plutil", subject: "/bad.plist", message: "parse failed" }],
    });
    const report = buildReport({ source: { repoRoot: "/repo", commit: null }, entries: [entry] });
    expect(entry.verdict).toBe("DRIFT");
    expect(reportExitCode(report)).toBe(2);
  });

  test("human output groups every verdict and shows totals", () => {
    const entries = ["OK", "DRIFT", "DEAD", "UNTRACKED"].map((verdict) => ({
      kind: "launchd",
      id: `com.golems.${verdict.toLowerCase()}`,
      label: `com.golems.${verdict.toLowerCase()}`,
      verdict,
      reasons: verdict === "OK" ? [] : ["example reason"],
      warnings: [],
      inspectionErrors: [],
    }));
    const text = formatHumanReport(buildReport({ source: { repoRoot: "/repo", commit: null }, entries }));
    for (const heading of ["OK (1)", "DRIFT (1)", "DEAD (1)", "UNTRACKED (1)"]) expect(text).toContain(heading);
    expect(text).toContain("Total: 4");
  });

  test("human output includes deployment provenance and runtime state", () => {
    const entry = buildLaunchdEntry({
      label: "com.golems.example",
      trackedSources: [trackedSource],
      deployed,
      plistMatch: true,
      target: healthyTarget,
      loaded: { isLoaded: true, state: "running", lastExitCode: null, plistPath: deployed.path, runs: 1 },
      checkout: cleanCheckout,
      envContract: { configuredKeys: [], unusedKeys: [] },
    });
    const text = formatHumanReport(buildReport({ source: { repoRoot: "/repo", commit: "a".repeat(40) }, entries: [entry] }));
    expect(text).toContain(`source: ${trackedSource.path} @ ${trackedSource.commit} sha256:${trackedSource.sha256}`);
    expect(text).toContain(`deployed: ${deployed.path} sha256:${deployed.sha256}`);
    expect(text).toContain(`target: ${healthyTarget.path} exists=true tracked=true`);
    expect(text).toContain("loaded: state=running lastExit=null runs=1");
  });
});

describe("environment contracts", () => {
  test("warns only for non-sensitive variables the target never reads", () => {
    const contract = findUnusedEnvironmentKeys({
      EnvironmentVariables: {
        HOME: "/Users/e",
        PATH: "/bin",
        SESSIONS_TO_KEEP: "7",
        ACTIVITY_DAYS_TO_KEEP: "7",
        TELEGRAM_BOT_TOKEN: "redacted",
      },
    }, "const days = process.env.ACTIVITY_DAYS_TO_KEEP ?? '7';");
    expect(contract.configuredKeys).toEqual([
      "ACTIVITY_DAYS_TO_KEEP",
      "HOME",
      "PATH",
      "SESSIONS_TO_KEEP",
      "TELEGRAM_BOT_TOKEN",
    ]);
    expect(contract.unusedKeys).toEqual(["SESSIONS_TO_KEEP"]);
  });

  test("recognizes JavaScript, Python, and shell environment access forms", () => {
    const plist = { EnvironmentVariables: { JS_KEY: "1", PY_KEY: "2", SHELL_KEY: "3", BRACED_KEY: "4" } };
    const source = "process.env[\"JS_KEY\"]\nos.environ.get('PY_KEY')\necho $SHELL_KEY ${BRACED_KEY}";
    expect(findUnusedEnvironmentKeys(plist, source).unusedKeys).toEqual([]);
  });
});

describe("managed hook entries", () => {
  const hookSource = {
    path: "/Users/e/Gits/golems/hooks/precompact-checkpoint.py",
    repoRoot: "/Users/e/Gits/golems",
    commit: "a".repeat(40),
    sha256: "b".repeat(64),
  };

  test("keeps a matching regular-file copy OK but warns about durability", () => {
    const entry = buildHookEntry({
      name: "precompact-checkpoint.py",
      trackedSource: hookSource,
      deployed: { path: "/Users/e/.claude/hooks/precompact-checkpoint.py", sha256: hookSource.sha256 },
      linkMode: "copy",
      linkTarget: null,
    });
    expect(entry.verdict).toBe("OK");
    expect(entry.warnings).toContain("deployed hook is a regular-file copy, not a symlink");
  });

  test("classifies a missing hook as DEAD and a hash mismatch as DRIFT", () => {
    const missing = buildHookEntry({ name: "precompact-checkpoint.py", trackedSource: hookSource });
    const changed = buildHookEntry({
      name: "precompact-checkpoint.py",
      trackedSource: hookSource,
      deployed: { path: "/Users/e/.claude/hooks/precompact-checkpoint.py", sha256: "c".repeat(64) },
      linkMode: "copy",
    });
    expect(missing.verdict).toBe("DEAD");
    expect(changed.verdict).toBe("DRIFT");
  });

  test("classifies a symlink to the wrong source as DRIFT", () => {
    const entry = buildHookEntry({
      name: "precompact-checkpoint.py",
      trackedSource: hookSource,
      deployed: { path: "/Users/e/.claude/hooks/precompact-checkpoint.py", sha256: hookSource.sha256 },
      linkMode: "symlink",
      linkTarget: "/tmp/other.py",
    });
    expect(entry.verdict).toBe("DRIFT");
    expect(entry.reasons).toContain("deployed hook symlink does not target tracked source");
  });
});

function initGit(path) {
  mkdirSync(path, { recursive: true });
  execFileSync("git", ["init", "-q", path]);
}

describe("read-only runtime adapters", () => {
  test("parses CLI paths and JSON mode", () => {
    expect(parseArgs(["--json", "--home", "/tmp/home", "--gits-root", "/tmp/repos"])).toEqual({
      format: "json",
      home: "/tmp/home",
      gitsRoot: "/tmp/repos",
      sourceRoot: null,
      launchAgentsDir: null,
      hooksDir: null,
      help: false,
    });
    expect(() => parseArgs(["--mutate"])).toThrow("unknown argument: --mutate");
  });

  test("discovers ecosystem repositories while giving the checker checkout source precedence", () => {
    const root = mkdtempSync(join(tmpdir(), "deploy-drift-repos-"));
    try {
      initGit(root);
      const gitsRoot = join(root, "Gits");
      const sourceRoot = join(root, "worktrees", "deploy-drift-checker");
      initGit(sourceRoot);
      initGit(join(gitsRoot, "golems"));
      execFileSync("git", ["-C", sourceRoot, "remote", "add", "origin", "https://example.test/EtanHey/golems.git"]);
      execFileSync("git", ["-C", join(gitsRoot, "golems"), "remote", "add", "origin", "https://example.test/EtanHey/golems.git"]);
      initGit(join(gitsRoot, "orchestrator"));
      initGit(join(gitsRoot, "ignored.wt"));
      mkdirSync(join(gitsRoot, "not-a-repo"), { recursive: true });

      const repos = discoverGitRepositories({ gitsRoot, sourceRoot });
      expect(repos[0]).toMatchObject({ repoRoot: realpathSync(sourceRoot), scanSources: true });
      expect(repos.find((repo) => basename(repo.repoRoot) === "orchestrator")?.scanSources).toBe(true);
      expect(repos.find((repo) => repo.repoRoot === realpathSync(join(gitsRoot, "golems")))?.scanSources).toBe(false);
      expect(repos.some((repo) => repo.repoRoot.endsWith("ignored.wt"))).toBe(false);
      expect(repos.some((repo) => repo.repoRoot.endsWith("not-a-repo"))).toBe(false);
      expect(repos.some((repo) => repo.repoRoot === realpathSync(root))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("discovers only in-scope installed plist filenames", () => {
    const root = mkdtempSync(join(tmpdir(), "deploy-drift-plists-"));
    try {
      for (const name of ["com.golems.a.plist", "com.golemszikaron.b.plist", "com.cmuxlayer.c.plist", "notes.txt"]) {
        writeFileSync(join(root, name), "fixture");
      }
      expect(discoverInstalledPlists(root).map((path) => basename(path))).toEqual([
        "com.golems.a.plist",
        "com.golemszikaron.b.plist",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("parses XML plists without changing them and hashes raw bytes", () => {
    const root = mkdtempSync(join(tmpdir(), "deploy-drift-read-"));
    try {
      const path = join(root, "job.plist");
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>com.golems.example</string></dict></plist>\n`;
      writeFileSync(path, xml);
      expect(readPlist(path)).toEqual({ Label: "com.golems.example" });
      expect(sha256File(path)).toBe(createHash("sha256").update(xml).digest("hex"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("checks target existence, trackedness, and ignored state in the owning repository", () => {
    const root = mkdtempSync(join(tmpdir(), "deploy-drift-target-"));
    try {
      initGit(root);
      const tracked = join(root, "tracked.sh");
      const ignored = join(root, "ignored.sh");
      writeFileSync(tracked, "#!/bin/sh\n");
      writeFileSync(ignored, "#!/bin/sh\n");
      writeFileSync(join(root, ".gitignore"), "ignored.sh\n");
      execFileSync("git", ["-C", root, "add", "tracked.sh", ".gitignore"]);
      const repos = [{ repoRoot: root, scanSources: true }];

      expect(inspectTarget(tracked, repos)).toMatchObject({ exists: true, repoRoot: root, tracked: true, ignored: false });
      expect(inspectTarget(ignored, repos)).toMatchObject({ exists: true, repoRoot: root, tracked: false, ignored: true });
      expect(inspectTarget(join(root, "missing.sh"), repos)).toMatchObject({ exists: false, repoRoot: root, tracked: false });
      expect(inspectTarget("/bin/sh", repos)).toMatchObject({ exists: true, repoRoot: null, tracked: null, ignored: false });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports checkout equality and dirtiness without fetching", () => {
    const calls = [];
    const fakeRun = (_program, args) => {
      calls.push(args.join(" "));
      const command = args.slice(2).join(" ");
      if (command === "rev-parse HEAD") return { ok: true, status: 0, stdout: `${"a".repeat(40)}\n`, stderr: "" };
      if (command === "rev-parse --verify origin/master") return { ok: true, status: 0, stdout: `${"a".repeat(40)}\n`, stderr: "" };
      if (command === "status --porcelain --untracked-files=all") return { ok: true, status: 0, stdout: " M tracked.sh\n", stderr: "" };
      return { ok: false, status: 1, stdout: "", stderr: "unexpected command" };
    };
    expect(inspectCheckout("/repo", fakeRun)).toEqual({
      repoRoot: "/repo",
      head: "a".repeat(40),
      upstream: "a".repeat(40),
      relation: "equal",
      dirty: true,
    });
    expect(calls.some((call) => call.includes("fetch"))).toBe(false);
  });

  test("uses the remote default branch instead of a stale origin/master ref", () => {
    const head = "a".repeat(40);
    const staleMaster = "b".repeat(40);
    const fakeRun = (_program, args) => {
      const command = args.slice(2).join(" ");
      if (command === "rev-parse HEAD") return { ok: true, status: 0, stdout: `${head}\n`, stderr: "" };
      if (command === "symbolic-ref --quiet --short refs/remotes/origin/HEAD") return { ok: true, status: 0, stdout: "origin/main\n", stderr: "" };
      if (command === "rev-parse --verify origin/main") return { ok: true, status: 0, stdout: `${head}\n`, stderr: "" };
      if (command === "rev-parse --verify origin/master") return { ok: true, status: 0, stdout: `${staleMaster}\n`, stderr: "" };
      if (command === "status --porcelain --untracked-files=all") return { ok: true, status: 0, stdout: "", stderr: "" };
      return { ok: false, status: 1, stdout: "", stderr: "unexpected command" };
    };
    expect(inspectCheckout("/repo", fakeRun).relation).toBe("equal");
    expect(inspectCheckout("/repo", fakeRun).upstream).toBe(head);
  });
});
