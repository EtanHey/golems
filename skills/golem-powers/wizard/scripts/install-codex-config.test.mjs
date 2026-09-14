import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { installCodexConfig, parseArgs } from "./install-codex-config.mjs";

const scratchRoots = [];

afterEach(async () => {
  await Promise.all(
    scratchRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function scratchDir() {
  const path = await mkdtemp(join(import.meta.dirname, ".install-codex-config-"));
  scratchRoots.push(path);
  return path;
}

describe("installCodexConfig", () => {
  test("rejects unknown CLI options", () => {
    expect(() => parseArgs(["--codex-hmoe", "/somewhere"])).toThrow("Usage:");
  });

  test("merges managed agent defaults without clobbering unrelated config", async () => {
    const root = await scratchDir();
    const codexHome = join(root, "codex-home");
    const sourceDir = join(root, "source");
    await mkdir(join(sourceDir, "agents"), { recursive: true });
    await mkdir(codexHome, { recursive: true });

    await writeFile(
      join(codexHome, "config.toml"),
      [
        'model = "gpt-5.6-sol"',
        'approval_policy = "never"',
        "",
        "[agents]",
        "enabled = true",
        "max_threads = 9",
        'default_subagent_model = "old-model"',
        "max_depth = 1",
        "",
        "[mcp_servers.brainlayer]",
        'url = "http://127.0.0.1:9999"',
        "",
      ].join("\n"),
    );
    await chmod(join(codexHome, "config.toml"), 0o600);
    await writeFile(
      join(sourceDir, "config.toml"),
      [
        "[agents]",
        'default_subagent_model = "gpt-5.6-luna"',
        'default_subagent_reasoning_effort = "xhigh"',
        "max_concurrent_threads_per_session = 4",
        "",
      ].join("\n"),
    );
    await writeFile(join(sourceDir, "agents", "recon.toml"), 'name = "recon"\n');
    await writeFile(join(sourceDir, "agents", "packet.toml"), 'name = "packet"\n');

    await installCodexConfig({ sourceDir, codexHome });

    const installed = await readFile(join(codexHome, "config.toml"), "utf8");
    expect(installed).toContain('model = "gpt-5.6-sol"');
    expect(installed).toContain('approval_policy = "never"');
    expect(installed).toContain("enabled = true");
    expect(installed).toContain("max_depth = 1");
    expect(installed).not.toContain("max_threads");
    expect(installed).toContain('[mcp_servers.brainlayer]\nurl = "http://127.0.0.1:9999"');
    expect(installed).toContain('default_subagent_model = "gpt-5.6-luna"');
    expect(installed).toContain('default_subagent_reasoning_effort = "xhigh"');
    expect(installed).toContain("max_concurrent_threads_per_session = 4");
    expect(installed.match(/default_subagent_model/g)).toHaveLength(1);
    expect((await stat(join(codexHome, "config.toml"))).mode & 0o777).toBe(0o600);
    expect(await readFile(join(codexHome, "agents", "recon.toml"), "utf8")).toBe(
      'name = "recon"\n',
    );
    expect(await readFile(join(codexHome, "agents", "packet.toml"), "utf8")).toBe(
      'name = "packet"\n',
    );
  });

  test("adds agents defaults to an existing non-empty config without an agents table", async () => {
    const root = await scratchDir();
    const codexHome = join(root, "codex-home");
    const sourceDir = join(root, "source");
    await mkdir(join(sourceDir, "agents"), { recursive: true });
    await mkdir(codexHome, { recursive: true });
    const original = 'model = "gpt-5.6-sol"\napproval_policy = "never"\n';
    await writeFile(join(codexHome, "config.toml"), original);
    await writeFile(
      join(sourceDir, "config.toml"),
      '[agents]\ndefault_subagent_model = "gpt-5.6-luna"\ndefault_subagent_reasoning_effort = "xhigh"\nmax_concurrent_threads_per_session = 4\n',
    );
    await writeFile(join(sourceDir, "agents", "recon.toml"), 'name = "recon"\n');
    await writeFile(join(sourceDir, "agents", "packet.toml"), 'name = "packet"\n');

    await installCodexConfig({ sourceDir, codexHome });

    const installed = await readFile(join(codexHome, "config.toml"), "utf8");
    expect(installed).toStartWith(original);
    expect(installed).toContain('[agents]\ndefault_subagent_model = "gpt-5.6-luna"');
  });

  test("merges a legal agents header with whitespace inside the brackets", async () => {
    const root = await scratchDir();
    const codexHome = join(root, "codex-home");
    const sourceDir = join(root, "source");
    await mkdir(join(sourceDir, "agents"), { recursive: true });
    await mkdir(codexHome, { recursive: true });
    await writeFile(join(codexHome, "config.toml"), '[ agents ]\nenabled = true\nmax_threads = 6\n');
    await writeFile(
      join(sourceDir, "config.toml"),
      '[agents]\ndefault_subagent_model = "gpt-5.6-luna"\ndefault_subagent_reasoning_effort = "xhigh"\nmax_concurrent_threads_per_session = 4\n',
    );
    await writeFile(join(sourceDir, "agents", "recon.toml"), 'name = "recon"\n');
    await writeFile(join(sourceDir, "agents", "packet.toml"), 'name = "packet"\n');

    await installCodexConfig({ sourceDir, codexHome });

    const installed = await readFile(join(codexHome, "config.toml"), "utf8");
    expect(installed.match(/\[\s*agents\s*\]/g)).toHaveLength(1);
    expect(installed).not.toContain("max_threads");
    expect(installed).toContain("max_concurrent_threads_per_session = 4");
  });

  test("refuses a root dotted agents key without changing the live config", async () => {
    const root = await scratchDir();
    const codexHome = join(root, "codex-home");
    const sourceDir = join(root, "source");
    await mkdir(join(sourceDir, "agents"), { recursive: true });
    await mkdir(codexHome, { recursive: true });
    const original = 'model = "gpt-5.6-sol"\nagents.max_threads = 6\n';
    await writeFile(join(codexHome, "config.toml"), original);
    await writeFile(
      join(sourceDir, "config.toml"),
      '[agents]\ndefault_subagent_model = "gpt-5.6-luna"\ndefault_subagent_reasoning_effort = "xhigh"\nmax_concurrent_threads_per_session = 4\n',
    );
    await writeFile(join(sourceDir, "agents", "recon.toml"), 'name = "recon"\n');
    await writeFile(join(sourceDir, "agents", "packet.toml"), 'name = "packet"\n');

    await expect(installCodexConfig({ sourceDir, codexHome })).rejects.toThrow(
      "root dotted agents key",
    );
    expect(await readFile(join(codexHome, "config.toml"), "utf8")).toBe(original);
  });

  test("creates config and agent directory when Codex has no existing config", async () => {
    const root = await scratchDir();
    const codexHome = join(root, "codex-home");
    const sourceDir = join(root, "source");
    await mkdir(join(sourceDir, "agents"), { recursive: true });
    await writeFile(
      join(sourceDir, "config.toml"),
      [
        "[agents]",
        'default_subagent_model = "gpt-5.6-luna"',
        'default_subagent_reasoning_effort = "xhigh"',
        "max_concurrent_threads_per_session = 4",
        "",
      ].join("\n"),
    );
    await writeFile(join(sourceDir, "agents", "recon.toml"), 'name = "recon"\n');
    await writeFile(join(sourceDir, "agents", "packet.toml"), 'name = "packet"\n');

    await installCodexConfig({ sourceDir, codexHome });

    expect(await readFile(join(codexHome, "config.toml"), "utf8")).toBe(
      [
        "[agents]",
        'default_subagent_model = "gpt-5.6-luna"',
        'default_subagent_reasoning_effort = "xhigh"',
        "max_concurrent_threads_per_session = 4",
        "",
      ].join("\n"),
    );
  });

  test("installs the repository source of truth", async () => {
    const root = await scratchDir();
    const codexHome = join(root, "codex-home");
    const sourceDir = resolve(import.meta.dirname, "../../../../config/codex");

    await installCodexConfig({ sourceDir, codexHome });

    const installed = await readFile(join(codexHome, "config.toml"), "utf8");
    expect(installed).toContain('default_subagent_model = "gpt-5.6-luna"');
    expect(installed).toContain('default_subagent_reasoning_effort = "xhigh"');
    expect(installed).toContain("max_concurrent_threads_per_session = 4");
    expect(await readFile(join(codexHome, "agents", "recon.toml"), "utf8")).toContain(
      'model = "gpt-5.6-terra"',
    );
    expect(await readFile(join(codexHome, "agents", "packet.toml"), "utf8")).toContain(
      'model = "gpt-5.6-luna"',
    );
  });
});
