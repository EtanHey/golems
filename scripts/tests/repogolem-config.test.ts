// repogolem-config.ts: importer (registry.json + seat YAML -> one config.yaml)
// and generator (config.yaml -> dispatch-compatible registry.json + launchers.zsh).
// Fixtures are synthetic; launchers.golden.zsh comes from Ralph's own generator
// (see fixtures/repogolem-config/make-golden.zsh).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const REPO = join(import.meta.dir, "..", "..");
const CLI = join(REPO, "scripts", "repogolem", "repogolem-config.ts");
const FIX = join(import.meta.dir, "fixtures", "repogolem-config");
const REGISTRY = join(FIX, "registry.json");
const SEATS = join(FIX, "seats.yaml");
const GOLDEN = join(FIX, "launchers.golden.zsh");
const SOURCE_SHA = "0123456789abcdef0123456789abcdef01234567";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "repogolem-config-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(args: string[]) {
  const env = { ...process.env, REPOGOLEM_SOURCE_SHA: SOURCE_SHA };
  const proc = Bun.spawnSync(["bun", CLI, ...args], { env, stdout: "pipe", stderr: "pipe" });
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

function generateTo(config: string, outDir: string, extra: string[] = []) {
  return run([
    "generate",
    "--config",
    config,
    "--out-dir",
    outDir,
    "--home",
    "/home/fixture",
    ...extra,
  ]);
}

// Everything after the bootstrap block (the header Ralph and we both emit).
function launcherBody(text: string) {
  const marker = "\nfi\n\n";
  const at = text.indexOf(marker);
  expect(at).toBeGreaterThan(-1);
  return text.slice(at + marker.length);
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
    expect(r.stdout).toContain("literals 3");
    expect(r.stderr).toContain("warning: 3 literal (non-op://, non-$) secret/env value(s)");
    expect(r.stderr).toContain("global.env.FIXTURE_FLAG");
    expect(r.stderr).toContain("mcpDefinitions.literal-mcp.env.FIXTURE_LITERAL");
    // Any `env`/`secrets` mapping counts, not only the three known locations.
    expect(r.stderr).toContain("projects.gamma.env.GAMMA_LITERAL");
    // op:// and $ refs are not literals, and no value is ever printed.
    expect(r.stderr).not.toContain("FIXTURE_TOKEN");
    expect(r.stderr).not.toContain("FIXTURE_API_KEY");
    expect(r.stderr).not.toContain("FIXTURE_ENV_REF");
    expect(r.stderr).not.toContain("FIXTURE_BRACED_REF");
    expect(r.stdout + r.stderr).not.toContain("fixture-literal-value");
    expect(r.stdout + r.stderr).not.toContain("fixture-gamma-value");
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

describe("generate", () => {
  test("(i) round trip: import -> generate gives back the input registry.json", () => {
    const config = join(dir, "config.yaml");
    importTo(config);
    const r = generateTo(config, join(dir, "gen"));
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);

    const generated = JSON.parse(readFileSync(join(dir, "gen", "registry.json"), "utf8"));
    const { _generated, ...rest } = generated;
    expect(rest).toEqual(registryInput());
    // Project order drives launcher order, so it must survive too.
    expect(Object.keys(rest.projects)).toEqual(Object.keys(registryInput().projects));

    const configSha = createHash("sha256").update(readFileSync(config)).digest("hex");
    expect(_generated).toEqual({
      generator: "golems/scripts/repogolem/repogolem-config.ts",
      sourceSha: SOURCE_SHA,
      configSha256: configSha,
    });
  });

  test("(iv) launchers.zsh matches Ralph's generator on the same fixture", () => {
    const config = join(dir, "config.yaml");
    importTo(config);
    expect(generateTo(config, join(dir, "gen")).code).toBe(0);

    const ours = readFileSync(join(dir, "gen", "launchers.zsh"), "utf8");
    const golden = readFileSync(GOLDEN, "utf8");
    expect(launcherBody(ours)).toBe(launcherBody(golden));

    const configSha = createHash("sha256").update(readFileSync(config)).digest("hex");
    expect(ours).toContain(`# generator-sha: ${SOURCE_SHA}`);
    expect(ours).toContain(`# config-sha256: ${configSha}`);
  });

  test("(v) --check passes when fresh and fails on a one-field config edit", () => {
    const config = join(dir, "config.yaml");
    const out = join(dir, "gen");
    importTo(config);
    expect(generateTo(config, out).code).toBe(0);
    expect(generateTo(config, out, ["--check"]).code).toBe(0);

    // --check never writes.
    const registryBefore = readFileSync(join(out, "registry.json"), "utf8");

    const text = readFileSync(config, "utf8");
    const edited = text.replace('"/fixture/gits/gamma"', '"/fixture/gits/gamma2"');
    expect(edited).not.toBe(text);
    writeFileSync(config, edited);

    const stale = generateTo(config, out, ["--check"]);
    expect(stale.code).not.toBe(0);
    expect(stale.stdout + stale.stderr).toContain("stale");
    expect(readFileSync(join(out, "registry.json"), "utf8")).toBe(registryBefore);
  });

  test("(v) --check also fails on a hand-edited or missing output", () => {
    const config = join(dir, "config.yaml");
    const out = join(dir, "gen");
    importTo(config);
    expect(generateTo(config, out).code).toBe(0);

    const launchers = join(out, "launchers.zsh");
    writeFileSync(launchers, `${readFileSync(launchers, "utf8")}alias x=y\n`);
    expect(generateTo(config, out, ["--check"]).code).not.toBe(0);

    expect(generateTo(config, out).code).toBe(0);
    rmSync(join(out, "registry.json"));
    expect(generateTo(config, out, ["--check"]).code).not.toBe(0);
  });

  test("refuses integer-like project keys in a hand-edited config", () => {
    const config = join(dir, "config.yaml");
    writeFileSync(config, 'projects:\n  zeta:\n    path: "/fixture/z"\n  "42":\n    path: "/fixture/42"\n');
    const r = generateTo(config, join(dir, "gen"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("integer-like");
    expect(existsSync(join(dir, "gen"))).toBe(false);
  });

  test("input errors exit 2, never the 1 that --check means stale", () => {
    const missing = generateTo(join(dir, "nope.yaml"), join(dir, "gen"), ["--check"]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain("repogolem-config:");

    const broken = join(dir, "broken.yaml");
    writeFileSync(broken, "projects: [unclosed\n");
    const r = generateTo(broken, join(dir, "gen"), ["--check"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("repogolem-config:");
  });

  test("refuses a config without the imported sections", () => {
    const r = generateTo(SEATS, join(dir, "gen"));
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("projects");
  });
});
