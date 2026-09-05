import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertRetireEligible,
  buildManifestCommand,
  buildGitInventoryCommand,
  buildRetireCommands,
  buildRetiredMarkerContent,
  buildSkillPushCommands,
  buildStandaloneSkillInstallCommands,
  compareManifests,
  compareGitInventory,
  needsStandaloneRecheck,
  parseArgs,
  shellQuote,
  summarizeDrift,
  validateProfile,
} from "../reconcile-to-mac-lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => JSON.parse(readFileSync(join(here, "fixtures/reconcile", name), "utf8"));

describe("compareManifests", () => {
  test("reports missing, extra, and changed installed files", () => {
    const drift = compareManifests(fixture("current-manifest.json"), fixture("stale-manifest.json"));

    expect(drift).toEqual({
      drifted: true,
      missing: ["scripts/render.ts"],
      extra: ["stale-only.txt"],
      changed: ["SKILL.md"],
    });
  });

  test("reports no drift for identical manifests", () => {
    const current = fixture("current-manifest.json");
    expect(compareManifests(current, current)).toEqual({
      drifted: false,
      missing: [],
      extra: [],
      changed: [],
    });
  });

  test("uses null hashes for file-list-only entries without reporting false content drift", () => {
    expect(compareManifests(
      { files: { "binary.dat": null, "SKILL.md": "current" } },
      { files: { "binary.dat": "remote-binary-hash", "SKILL.md": "current" } },
    )).toEqual({ drifted: false, missing: [], extra: [], changed: [] });
  });
});

describe("command construction", () => {
  test("shellQuote safely preserves apostrophes and spaces", () => {
    expect(shellQuote("a b's")).toBe("'a b'\\''s'");
  });

  test("builds origin archive, timestamped backup, extraction, and canonical symlink commands", () => {
    const commands = buildSkillPushCommands({
      sourceRef: "origin/master",
      target: "m1",
      targetRepo: "$HOME/Gits/golems",
      installRoot: "$HOME/.claude/skills",
      skillPath: "skills/golem-powers/audio-dashboard",
    });

    expect(commands.archive).toBe("git archive origin/master -- skills/golem-powers/audio-dashboard");
    expect(commands.remote).toContain('repo="$HOME/Gits/golems"');
    expect(commands.remote).toContain('installed="$HOME/.claude/skills/audio-dashboard"');
    expect(commands.remote).toContain('backup="$HOME/audio-dashboard-bak-$ts"');
    expect(commands.remote).toContain('mv "$dest" "$backup"');
    expect(commands.remote).toContain('tar -xf - -C "$repo"');
    expect(commands.remote).toContain('ln -sfn "$dest" "$installed"');
    expect(commands.pipeline).toContain("| ssh m1 ");
    expect(commands.pipeline).not.toContain("rm -");
  });

  test("builds deterministic file-list and SHA-256 manifest command", () => {
    const command = buildManifestCommand("$HOME/Gits/golems/skills/golem-powers/audio-dashboard");
    expect(command).toContain('cd "$HOME/Gits/golems/skills/golem-powers/audio-dashboard"');
    expect(command).toContain("find . -type f -print0 | sort -z | while");
    expect(command).toContain("shasum -a 256");
  });

  test("builds a versioned standalone skill install with no checkout dependency", () => {
    const commands = buildStandaloneSkillInstallCommands({
      sourceRef: "origin/master",
      target: "m1",
      installRoot: "$HOME/.golems/skills",
      linkRoot: "$HOME/.claude/skills",
      skillPath: "skills/golem-powers/audio-dashboard",
    });

    expect(commands.archive).toContain("git archive");
    expect(commands.archive).toContain("origin/master");
    expect(commands.archive).toContain("skills/golem-powers/audio-dashboard");
    expect(commands.archive).toContain(".golems-source-commit");
    expect(commands.remote).toContain('dest="$HOME/.golems/skills/audio-dashboard"');
    expect(commands.remote).toContain('link="$HOME/.claude/skills/audio-dashboard"');
    expect(commands.remote).toContain('test -f "$stage/.golems-source-commit"');
    expect(commands.remote).toContain('mv "$stage" "$dest"');
    expect(commands.remote).toContain('ln -s "$dest" "$link"');
    expect(commands.remote).not.toContain("Gits/golems");
    expect(commands.pipeline).not.toContain("rm -");
  });

  test.each([
    [{ sourceRef: "origin/master;touch-pwn", target: "m1", installRoot: "$HOME/.golems/skills", linkRoot: "$HOME/.claude/skills", skillPath: "skills/golem-powers/audio-dashboard" }, "source"],
    [{ sourceRef: "origin/master", target: "m1;touch-pwn", installRoot: "$HOME/.golems/skills", linkRoot: "$HOME/.claude/skills", skillPath: "skills/golem-powers/audio-dashboard" }, "SSH"],
    [{ sourceRef: "origin/master", target: "m1", installRoot: "$HOME/.golems/skills", linkRoot: "$HOME/.claude/skills", skillPath: "skills/golem-powers/audio dashboard" }, "skill"],
    [{ sourceRef: "origin/master", target: "m1", installRoot: "$HOME/.golems/skills/../escape", linkRoot: "$HOME/.claude/skills", skillPath: "skills/golem-powers/audio-dashboard" }, "path"],
    [{ sourceRef: "origin/master", target: "m1", installRoot: "$HOME/.golems/skills", linkRoot: "/tmp/skills", skillPath: "skills/golem-powers/audio-dashboard" }, "path"],
  ])("rejects unsafe standalone-install input %#", (input) => {
    expect(() => buildStandaloneSkillInstallCommands(input)).toThrow();
  });

  test("legacy command builders reject traversal and shell metacharacters", () => {
    expect(() => buildSkillPushCommands({
      sourceRef: "origin/master",
      target: "m1",
      targetRepo: "$HOME/Gits/../escape",
      installRoot: "$HOME/.claude/skills",
      skillPath: "skills/golem-powers/audio-dashboard",
    })).toThrow();
    expect(() => buildManifestCommand("$HOME/Gits/golems/../../etc")).toThrow();
  });
});

describe("retire law", () => {
  test("rejects retirement unless every required install verification is green", () => {
    const component = { name: "golems", requiresGreen: ["skills-install", "launcher-verify"] };
    expect(() => assertRetireEligible(component, {
      "skills-install": "green",
      "launcher-verify": "failed",
    })).toThrow("launcher-verify");
    expect(assertRetireEligible(component, {
      "skills-install": "green",
      "launcher-verify": "green",
    })).toBe(true);
    expect(() => assertRetireEligible({ name: "golems", requiresGreen: [] }, {})).toThrow("requiresGreen");
  });

  test("retired marker content names the replacement and exact restore command", () => {
    const content = buildRetiredMarkerContent({
      component: "golems",
      replacement: "$HOME/.golems/skills plus $HOME/.claude/skills links",
      checkoutPath: "$HOME/Gits/golems",
      backupPath: "$HOME/M1-retired-20260712-210000/golems",
    });

    expect(content).toContain("golems was retired");
    expect(content).toContain("Replaced by: $HOME/.golems/skills plus $HOME/.claude/skills links");
    expect(content).toContain("mv '$HOME/M1-retired-20260712-210000/golems' '$HOME/Gits/golems'");
  });

  test("retire command publishes a marker, rolls back on marker failure, and never removes", () => {
    const commands = buildRetireCommands({
      target: "m1",
      gitRoot: "$HOME/Gits",
      backupRoot: "$HOME/.golems/backups",
      component: "golems",
      replacement: "$HOME/.golems/skills",
    });
    expect(commands.remote).toContain(".RETIRED-$marker_stamp.md");
    expect(commands.remote).toContain("Restore exactly with");
    expect(commands.remote).toContain('mv "$checkout" "$backup"');
    expect(commands.remote).toContain('mv "$backup" "$checkout"');
    expect(commands.remote).toContain("RETIRE COMPLETE");
    expect(commands.remote).not.toContain("rm ");
  });

  test("retire command fails closed when a checkout is absent without a valid marker and backup", () => {
    const home = mkdtempSync(join(tmpdir(), "retire-absent-"));
    const commands = buildRetireCommands({
      target: "m1",
      gitRoot: "$HOME/Gits",
      backupRoot: "$HOME/.golems/backups",
      component: "golems",
      replacement: "$HOME/.golems/skills",
    });
    const result = spawnSync("zsh", ["-c", commands.remote], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("valid RETIRED marker");
  });

  test("retire command rejects a marker that points at an unrelated existing directory", () => {
    const home = mkdtempSync(join(tmpdir(), "retire-forged-"));
    const gitRoot = join(home, "Gits");
    const unrelated = join(gitRoot, "unrelated-live-repo");
    mkdirSync(unrelated, { recursive: true });
    writeFileSync(
      join(gitRoot, "golems.RETIRED-2026-07-12-000000.md"),
      `# forged\n\nBackup path: ${unrelated}\n\nRestore exactly with:\necho not-a-restore\n`,
    );
    const commands = buildRetireCommands({
      target: "m1",
      gitRoot: "$HOME/Gits",
      backupRoot: "$HOME/.golems/backups",
      component: "golems",
      replacement: "$HOME/.golems/skills",
    });
    const result = spawnSync("zsh", ["-c", commands.remote], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("valid RETIRED marker");
  });

  test("retire command moves a checkout, publishes a restorable marker, and verifies idempotent reruns", () => {
    const home = mkdtempSync(join(tmpdir(), "retire-present-"));
    const checkout = join(home, "Gits/golems");
    mkdirSync(checkout, { recursive: true });
    writeFileSync(join(checkout, "sentinel"), "preserved");
    const commands = buildRetireCommands({
      target: "m1",
      gitRoot: "$HOME/Gits",
      backupRoot: "$HOME/.golems/backups",
      component: "golems",
      replacement: "$HOME/.golems/skills",
    });

    const first = spawnSync("zsh", ["-c", commands.remote], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
    expect(first.status).toBe(0);
    expect(existsSync(checkout)).toBe(false);
    const markerName = readdirSync(join(home, "Gits")).find((name) => name.startsWith("golems.RETIRED-"));
    const marker = readFileSync(join(home, "Gits", markerName), "utf8");
    const backupPath = marker.match(/^Backup path: (.+)$/m)?.[1];
    expect(backupPath).toBeTruthy();
    expect(readFileSync(join(backupPath, "sentinel"), "utf8")).toBe("preserved");
    expect(marker).toContain(`mv '${backupPath}' '${checkout}'`);

    const second = spawnSync("zsh", ["-c", commands.remote], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("RETIRE ALREADY COMPLETE");
  });
});

describe("final git inventory", () => {
  test("reports extra and missing checkout directories against the exact allowlist", () => {
    expect(compareGitInventory(
      ["artifact-uprising-audit", "golems", "mimir"],
      ["artifact-uprising-audit", "mimir", "mimir.wt"],
    )).toEqual({
      clean: false,
      extra: ["golems"],
      missing: ["mimir.wt"],
    });
  });

  test("allows an optional worktree to be absent while still rejecting unlisted directories", () => {
    expect(compareGitInventory(
      ["artifact-uprising-audit", "mimir"],
      ["artifact-uprising-audit", "mimir", "mimir.wt"],
      ["artifact-uprising-audit", "mimir"],
    )).toEqual({ clean: true, extra: [], missing: [] });
  });

  test("builds a read-only canonical checkout inventory command", () => {
    const command = buildGitInventoryCommand("$HOME/Gits");
    expect(command).toContain('find "$HOME/Gits"');
    expect(command).toContain("-type d");
    expect(command).toContain("basename");
    expect(command).not.toContain("rm ");
    expect(command).not.toContain("mv ");
  });
});

describe("profile safety", () => {
  const valid = {
    version: 1,
    defaults: { target: "m1", sourceRef: "origin/master" },
    targets: {
      m1: {
        sshHost: "m1",
        repoPath: "$HOME/Gits/golems",
        installRoot: "$HOME/.claude/skills",
        keepList: ["$HOME/Gits/golems"],
        skills: [{ path: "skills/golem-powers/audio-dashboard", keyFiles: ["SKILL.md"] }],
        hostEnvCheckers: [],
        runtimeChecks: [],
      },
    },
  };

  test("accepts the canonical M1 profile shape", () => {
    expect(validateProfile(valid)).toBe(valid);
  });

  test.each(["Theo", "Ben", "Huberman", "voice-clone", "voices/"])(
    "rejects private carveout content: %s",
    (privateName) => {
      const unsafe = structuredClone(valid);
      unsafe.targets.m1.hostEnvCheckers.push({ id: "bad", checkCommand: `test -e ${privateName}` });
      expect(() => validateProfile(unsafe)).toThrow("private voice asset");
    },
  );

  test("rejects any Mimir path operation", () => {
    const unsafe = structuredClone(valid);
    unsafe.targets.m1.repoPath = "$HOME/Gits/mimir";
    expect(() => validateProfile(unsafe)).toThrow("mimir");
  });

  test("rejects duplicate phase IDs and unguarded retire entries", () => {
    const duplicate = structuredClone(valid);
    duplicate.targets.m1.standaloneSkills = {
      id: "fixture-phase",
      sourceRoot: "skills/golem-powers",
      installRoot: "$HOME/.golems/skills",
      linkRoot: "$HOME/.claude/skills",
      legacyCheckoutRoot: "$HOME/Gits/golems",
      include: ["audio-dashboard"],
      verifyCommands: ["true"],
    };
    duplicate.targets.m1.hostEnvCheckers.push({
      id: "fixture-phase",
      checkCommand: "true",
      provisionCommand: "true",
    });
    expect(() => validateProfile(duplicate)).toThrow("duplicate phase id");

    const unguarded = structuredClone(valid);
    unguarded.targets.m1.retireGitRoot = "$HOME/Gits";
    unguarded.targets.m1.retireBackupRoot = "$HOME/.golems/backups";
    unguarded.targets.m1.retire = [{ name: "golems", replacement: "$HOME/.golems/skills", requiresGreen: [] }];
    expect(() => validateProfile(unguarded)).toThrow("requiresGreen");
  });

  test("production profile pins the public MLX model and waits for daemon restart", () => {
    const production = JSON.parse(readFileSync(join(here, "../reconcile-profile.json"), "utf8"));
    expect(validateProfile(production)).toBe(production);
    const mlx = production.targets.m1.hostEnvCheckers.find((item) => item.id === "voicelayer-stt-polish");
    expect(mlx.provisionCommand).toContain("--break-system-packages mlx-lm");
    expect(mlx.provisionCommand).toContain("mlx-community/Qwen3-4B-Instruct-2507-4bit");
    expect(mlx.provisionCommand).toContain("seq 1 30");
  });

  test("production audio-dashboard host-tool checks resolve the non-interactive SSH PATH", () => {
    const production = JSON.parse(readFileSync(join(here, "../reconcile-profile.json"), "utf8"));
    const target = production.targets.m1;
    const pathPrefix = 'export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"; ';
    const hardDeps = target.hostEnvCheckers.find((item) => item.id === "audio-dashboard-hard-deps");
    const tts = target.runtimeChecks.find((item) => item.id === "audio-dashboard-tts-8880");

    expect(target.standaloneSkills.verifyCommands[0]).toStartWith(pathPrefix);
    expect(hardDeps.checkCommand).toStartWith(pathPrefix);
    expect(hardDeps.provisionCommand).toStartWith(pathPrefix);
    expect(hardDeps.verifyCommand).toStartWith(pathPrefix);
    expect(tts.checkCommand).toStartWith(pathPrefix);
  });

  test("production profile packages all canonical skills and guards every checkout retirement", () => {
    const production = JSON.parse(readFileSync(join(here, "../reconcile-profile.json"), "utf8"));
    expect(validateProfile(production)).toBe(production);
    const target = production.targets.m1;
    expect(target.skills).toEqual([]);
    expect(target.standaloneSkills).toMatchObject({
      id: "skills-install",
      sourceRoot: "skills/golem-powers",
      installRoot: "$HOME/.golems/skills",
      linkRoot: "$HOME/.claude/skills",
    });
    expect(target.standaloneSkills.include).toBeUndefined();
    expect(target.ralphtools.verifyCommand).toContain("type golemsClaude");
    expect(target.ralphtools.verifyCommand).toContain("type hcGemini");
    expect(target.ralphtools.verifyCommand).toContain("type aftercodeGemini");
    expect(target.rewires.find((phase) => phase.id === "narration-config").fixCommand).toContain("$HOME/.voicelayer/profiles.local.yaml");
    expect(target.gitInventory).toEqual({
      id: "gits-end-state",
      root: "$HOME/Gits",
      allow: ["artifact-uprising-audit", "mimir", "mimir.wt"],
      required: ["artifact-uprising-audit", "mimir"],
    });
    expect(target.retire.map((component) => component.name)).toEqual([
      "aftercode",
      "narrationlayer",
      "ralph",
      "golems",
    ]);
  });
});

describe("CLI mode", () => {
  test("defaults to a non-executing dry run", () => {
    expect(parseArgs([])).toEqual({ target: undefined, profile: undefined, apply: false, fix: false, json: true });
  });

  test("requires --apply before --fix can mutate", () => {
    expect(() => parseArgs(["--fix"])).toThrow("--fix requires --apply");
    expect(parseArgs(["--apply", "--fix", "--target", "m1"])).toMatchObject({
      target: "m1",
      apply: true,
      fix: true,
    });
  });

  test("default CLI run executes nothing and prints exact planned commands in its JSON receipt", () => {
    const result = spawnSync(
      process.execPath,
      [join(here, "../reconcile-to-mac.mjs"), "--profile", join(here, "fixtures/reconcile/profile.json")],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    const receipt = JSON.parse(result.stdout);
    expect(receipt.mode).toBe("dry-run");
    expect(receipt.target).toBe("m1");
    expect(receipt.skills[0].status).toBe("planned");
    expect(receipt.skills[0].commands.pipeline).toContain("git archive origin/master");
    expect(receipt.hostEnv[0]).toMatchObject({ id: "fixture-dep", status: "planned" });
    expect(receipt.skillsInstall).toMatchObject({ id: "skills-install", status: "planned" });
    expect(receipt.skillsInstall.skills[0]).toMatchObject({ name: "audio-dashboard", status: "planned" });
    expect(receipt.skillsInstall.skills[0].commands.pipeline).toContain("$HOME/.golems/skills/audio-dashboard");
    expect(receipt.ralphtools).toMatchObject({ id: "ralphtools-install", status: "planned" });
    expect(receipt.rewires[0]).toMatchObject({ id: "narration-config", status: "planned" });
    expect(receipt.retire[0]).toMatchObject({
      name: "golems",
      status: "guarded",
      requiresGreen: ["skills-install"],
    });
    expect(receipt.retire[0].command).toContain(".RETIRED-");
    expect(receipt.retire[0].command).toContain("Restore exactly with");
    expect(receipt.gitInventory).toMatchObject({ id: "gits-end-state", status: "planned" });
    expect(receipt.gitInventory.required).toEqual(["artifact-uprising-audit", "mimir"]);
    expect(receipt.drift.status).toBe("not-executed");
  });
});

describe("receipt drift summary", () => {
  test("rechecks a non-green standalone phase after apply-fix host provisioning", () => {
    expect(needsStandaloneRecheck({ fix: true, status: "drift" })).toBe(true);
    expect(needsStandaloneRecheck({ fix: true, status: "green" })).toBe(false);
    expect(needsStandaloneRecheck({ fix: false, status: "drift" })).toBe(false);
  });

  test("retains found-and-fixed evidence separately from remaining drift", () => {
    expect(summarizeDrift({
      skills: [{ name: "audio-dashboard", status: "synced" }],
      hostEnv: [{ id: "mlx", status: "provisioned" }],
      runtime: [{ id: "tts", status: "ok" }],
      fix: true,
    })).toEqual({
      status: "clean",
      found: [
        ["skill", "audio-dashboard", "synced"],
        ["host-env", "mlx", "provisioned"],
      ],
      remaining: [],
      fixed: true,
    });
  });
});
