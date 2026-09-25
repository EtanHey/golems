// repogolem-config.ts import: registry.json + seat YAML -> one config.yaml.
// Fixtures are synthetic.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const REPO = join(import.meta.dir, "..", "..");
const CLI = join(REPO, "scripts", "repogolem", "repogolem-config.ts");
const FIX = join(import.meta.dir, "fixtures", "repogolem-config");
const REGISTRY = join(FIX, "registry.json");
const SEATS = join(FIX, "seats.yaml");

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "repogolem-config-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(args: string[]) {
  const proc = Bun.spawnSync(["bun", CLI, ...args], { stdout: "pipe", stderr: "pipe" });
  return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

const runImport = (out: string, ...extra: string[]) =>
  run(["import", "--registry", REGISTRY, "--seats", SEATS, "--out", out, ...extra]);

function importTo(out: string, extra: string[] = []) {
  const r = runImport(out, "--write", ...extra);
  expect(r.stderr).not.toContain("repogolem-config:");
  expect(r.code).toBe(0);
  return readFileSync(out, "utf8");
}

// The exact text cmuxlayer's line parser reads: `seatRegistry:` up to the
// next column-0 line (seat-identity.ts parseSeatRegistryConfig).
function seatBlock(text: string) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^seatRegistry:\s*$/.test(l));
  expect(start).toBeGreaterThan(-1);
  let end = start + 1;
  while (end < lines.length && (lines[end] === "" || /^[\s#]/.test(lines[end]))) end++;
  return lines.slice(start, end).join("\n");
}

const registryInput = () => JSON.parse(readFileSync(REGISTRY, "utf8"));

describe("import", () => {
  test("dry-run is the default: prints a summary, writes nothing", () => {
    const out = join(dir, "config.yaml");
    const r = runImport(out);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("projects 4");
    expect(r.stdout).toContain("mcpDefinitions 5");
    expect(r.stdout).toContain("dropped 0");
    expect(r.stdout).toContain("dry-run");
    expect(existsSync(out)).toBe(false);
  });

  test("warns about non-op:// secret/env literals by key path, never by value", () => {
    const r = runImport(join(dir, "c.yaml"));
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("literals 2");
    expect(r.stderr).toContain("warning: 2 literal (non-op://) secret/env value(s)");
    expect(r.stderr).toContain("global.env.FIXTURE_FLAG");
    expect(r.stderr).toContain("mcpDefinitions.literal-mcp.env.FIXTURE_LITERAL");
    // op:// refs are not literals, and no value is ever printed.
    expect(r.stderr).not.toContain("FIXTURE_TOKEN");
    expect(r.stderr).not.toContain("FIXTURE_API_KEY");
    expect(r.stdout + r.stderr).not.toContain("fixture-literal-value");
  });

  test("(ii) the seat file survives byte-for-byte; new keys are additive", () => {
    const seats = readFileSync(SEATS, "utf8");
    const text = importTo(join(dir, "config.yaml"));
    expect(text.startsWith(seats)).toBe(true);
    expect(seatBlock(text)).toBe(seatBlock(seats));

    const before = parseYaml(seats);
    const after = parseYaml(text);
    for (const key of Object.keys(before)) expect(after[key]).toEqual(before[key]);
    const added = ["coderabbit", "global", "mcpDefinitions", "projects", "registryVersion"];
    expect(Object.keys(after).sort()).toEqual([...Object.keys(before), ...added].sort());
    expect(after.projects).toEqual(registryInput().projects);
  });

  test("refuses a seat file that already has one of the imported keys", () => {
    const seats = join(dir, "seats.yaml");
    writeFileSync(seats, `${readFileSync(SEATS, "utf8")}projects:\n  x: {}\n`);
    const r = run([
      "import", "--registry", REGISTRY, "--seats", seats, "--out", join(dir, "c.yaml"), "--write",
    ]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("projects");
    expect(existsSync(join(dir, "c.yaml"))).toBe(false);
  });

  test("(iii) --drop-cli kiro removes only kiro", () => {
    const plain = parseYaml(importTo(join(dir, "plain.yaml")));
    const dropped = parseYaml(importTo(join(dir, "dropped.yaml"), ["--drop-cli", "kiro"]));
    const input = registryInput();
    for (const [name, project] of Object.entries<any>(input.projects)) {
      const got = dropped.projects[name];
      if (project.clis === undefined) {
        expect(got.clis).toBeUndefined();
      } else {
        expect(got.clis).toEqual(project.clis.filter((c: string) => c !== "kiro"));
      }
      const { clis: _a, ...restGot } = got;
      const { clis: _b, ...restPlain } = plain.projects[name];
      expect(restGot).toEqual(restPlain);
    }
    expect(dropped.mcpDefinitions).toEqual(plain.mcpDefinitions);

    const r = runImport(join(dir, "x.yaml"), "--drop-cli", "kiro");
    expect(r.stdout).toContain("dropped 3");
  });

  test("(vi) refuses to overwrite without --force; --force writes a .bak first", () => {
    const out = join(dir, "config.yaml");
    writeFileSync(out, "original: true\n");
    const refused = runImport(out, "--write");
    expect(refused.code).not.toBe(0);
    expect(refused.stderr).toContain("--force");
    expect(readFileSync(out, "utf8")).toBe("original: true\n");

    importTo(out, ["--force"]);
    const baks = readdirSync(dir).filter((f) => f.startsWith("config.yaml.bak-"));
    expect(baks).toHaveLength(1);
    expect(baks[0]).toMatch(/^config\.yaml\.bak-\d{4}-\d{2}-\d{2}T\d{6}Z$/);
    expect(readFileSync(join(dir, baks[0]), "utf8")).toBe("original: true\n");
    expect(parseYaml(readFileSync(out, "utf8")).projects.alpha.path).toBe("/fixture/gits/alpha");
  });
});
