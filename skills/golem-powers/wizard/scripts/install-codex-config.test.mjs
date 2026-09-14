import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { installCodexConfig } from "./install-codex-config.mjs";

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
        'default_subagent_model = "old-model"',
        "max_depth = 1",
        "",
        "[mcp_servers.brainlayer]",
        'url = "http://127.0.0.1:9999"',
        "",
      ].join("\n"),
    );
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
    expect(installed).toContain('[mcp_servers.brainlayer]\nurl = "http://127.0.0.1:9999"');
    expect(installed).toContain('default_subagent_model = "gpt-5.6-luna"');
    expect(installed).toContain('default_subagent_reasoning_effort = "xhigh"');
    expect(installed).toContain("max_concurrent_threads_per_session = 4");
    expect(installed.match(/default_subagent_model/g)).toHaveLength(1);
    expect(await readFile(join(codexHome, "agents", "recon.toml"), "utf8")).toBe(
      'name = "recon"\n',
    );
    expect(await readFile(join(codexHome, "agents", "packet.toml"), "utf8")).toBe(
      'name = "packet"\n',
    );
  });

  test("creates config and agent directory when Codex has no existing config", async () => {
    const root = await scratchDir();
    const codexHome = join(root, "codex-home");
    const sourceDir = join(root, "source");
    await mkdir(join(sourceDir, "agents"), { recursive: true });
    await writeFile(
      join(sourceDir, "config.toml"),
      '[agents]\ndefault_subagent_model = "gpt-5.6-luna"\n',
    );
    await writeFile(join(sourceDir, "agents", "recon.toml"), 'name = "recon"\n');
    await writeFile(join(sourceDir, "agents", "packet.toml"), 'name = "packet"\n');

    await installCodexConfig({ sourceDir, codexHome });

    expect(await readFile(join(codexHome, "config.toml"), "utf8")).toBe(
      '[agents]\ndefault_subagent_model = "gpt-5.6-luna"\n',
    );
  });
});
