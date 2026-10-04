import { afterEach, expect, test } from "bun:test";
import { chmod, cp, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { installCodexConfig, mergeCodexConfig, parseArgs } from "./install-codex-config.mjs";
const repo = resolve(import.meta.dirname, "../../../..");
const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function fixture(model) {
  const root = await mkdtemp(join(import.meta.dirname, ".codex-test-")); roots.push(root);
  for (const path of ["config/codex", "standards", "scripts/ci"]) {
    await mkdir(join(root, path), { recursive: true });
  }
  for (const path of ["config/codex", "standards/model-roles.json", "standards/model-roles.schema.json", "scripts/model-roles.mjs", "scripts/ci/check-model-role-drift.mjs"]) {
    await cp(join(repo, path), join(root, path), { recursive: true });
  }
  if (model) {
    const roles = JSON.parse(await readFile(join(root, "standards/model-roles.json"), "utf8"));
    roles.roles["codex.implement"].model = model;
    await writeFile(join(root, "standards/model-roles.json"), JSON.stringify(roles));
  }
  const codexHome = join(root, "home/.codex"); await mkdir(codexHome, { recursive: true });
  return { root, codexHome, sourceDir: join(root, "config/codex") };
}
const original = `# synthetic config\nmodel = "old-parent"\napproval_policy = "never"\nnote = """\n[agents]\nmodel = "inside-string"\n"""\n[agents]\nmax_threads = 9\ndefault_subagent_reasoning_effort = "medium"\nmax_concurrent_threads_per_session = 8\ndefault_subagent_model = "old-child"\n[agents.custom]\nmodel = "custom-model"\n[mcp_servers.synthetic]\nurl = "http://127.0.0.1:9999"\n[profiles.sample]\nmodel = "profile-model"\n`;
test("CLI rejects typos", () => { expect(() => parseArgs(["--codex-hmoe", "/unused"])).toThrow("Usage:"); });
test("role change propagates to parent, default child and packet in a standalone bundle", async () => {
  const f = await fixture("synthetic-next-model"); await installCodexConfig(f);
  const config = Bun.TOML.parse(await readFile(join(f.codexHome, "config.toml"), "utf8"));
  expect(config.model).toBe("synthetic-next-model");
  expect(config.agents.default_subagent_model).toBe("synthetic-next-model");
  expect(Bun.TOML.parse(await readFile(join(f.codexHome, "agents/packet.toml"), "utf8")).model).toBe("synthetic-next-model");
});
test("only two model assignments change; backup and file modes survive; reinstall is idempotent", async () => {
  const f = await fixture("synthetic-stable-model"); const path = join(f.codexHome, "config.toml");
  await writeFile(path, original); await chmod(path, 0o600); await installCodexConfig(f);
  const expected = original.replace('model = "old-parent"', 'model = "synthetic-stable-model"').replace('default_subagent_model = "old-child"', 'default_subagent_model = "synthetic-stable-model"');
  expect(await readFile(path, "utf8")).toBe(expected);
  const backups = (await readdir(f.codexHome)).filter(n => n.startsWith("config.toml.golems-backup-")); expect(backups).toHaveLength(1);
  expect(await readFile(join(f.codexHome, backups[0]), "utf8")).toBe(original);
  expect((await stat(join(f.codexHome, backups[0]))).mode & 0o777).toBe(0o600);
  const before = (await stat(path)).mtimeMs; await installCodexConfig(f);
  expect(await readFile(path, "utf8")).toBe(expected); expect((await stat(path)).mtimeMs).toBe(before);
  expect((await readdir(f.codexHome)).filter(n => n.startsWith("config.toml.golems-backup-"))).toHaveLength(1);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
});
test("repository templates use role tokens, not model literals; packet uses stable implementation role", async () => {
  const f = await fixture(); const roles = JSON.parse(await readFile(join(repo, "standards/model-roles.json"), "utf8"));
  for (const path of ["config.toml", "agents/packet.toml"]) {
    const text = await readFile(join(f.sourceDir, path), "utf8"); expect(text).toContain("{{codex.implement}}"); expect(text).not.toMatch(/gpt-/);
  }
  await installCodexConfig(f); expect(Bun.TOML.parse(await readFile(join(f.codexHome, "agents/packet.toml"), "utf8")).model).toBe(roles.roles["codex.implement"].model);
});
test("quoted keys, CRLF, multiline model and missing keys preserve unrelated bytes", () => {
  const fragment = 'model = "next"\n[agents]\ndefault_subagent_model = "next"\n';
  const input = '"model" = """old\nparent"""\r\n# keep\r\n[ "agents" ]\r\n\'default_subagent_model\' = "old"\r\nenabled = true\r\n';
  expect(mergeCodexConfig(input, fragment)).toBe('model = "next"\r\n# keep\r\n[ "agents" ]\r\ndefault_subagent_model = "next"\r\nenabled = true\r\n');
  const parsed = Bun.TOML.parse(mergeCodexConfig('[mcp_servers.synthetic]\nurl = "keep"', fragment));
  expect(parsed.model).toBe("next"); expect(parsed.agents.default_subagent_model).toBe("next"); expect(parsed.mcp_servers.synthetic.url).toBe("keep");
});
test("invalid config and dotted agents definitions fail without any write", async () => {
  const f = await fixture(); const path = join(f.codexHome, "config.toml");
  for (const input of ['model = "unterminated', 'agents.max_depth = 2\n']) {
    await writeFile(path, input); await expect(installCodexConfig(f)).rejects.toThrow(); expect(await readFile(path, "utf8")).toBe(input);
    expect(await readdir(f.codexHome)).toEqual(["config.toml"]);
  }
});
test("missing agent source fails before config is changed", async () => {
  const f = await fixture(); const path = join(f.codexHome, "config.toml"); await writeFile(path, original);
  await rm(join(f.sourceDir, "agents/packet.toml")); await expect(installCodexConfig(f)).rejects.toThrow();
  expect(await readFile(path, "utf8")).toBe(original); expect(await readdir(f.codexHome)).toEqual(["config.toml"]);
});

test("unbenched implementation role fails before writing any destination", async () => {
  const f = await fixture(); const path = join(f.root, "standards/model-roles.json");
  const data = JSON.parse(await readFile(path, "utf8")); data.roles["codex.implement"].status = "candidate";
  await writeFile(path, JSON.stringify(data)); await expect(installCodexConfig(f)).rejects.toThrow("unbenched");
  expect(await readdir(f.codexHome)).toEqual([]);
});
