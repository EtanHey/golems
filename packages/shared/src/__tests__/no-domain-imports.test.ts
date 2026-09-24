/**
 * Layering guard: @golems/shared is the base layer. Other workspace packages
 * import it, so it must never import them back (statically, dynamically, by a
 * relative path that climbs out of packages/shared, or as a dependency).
 *
 * An allow-list, not a deny-list (r5 on #197): the only @golems/* specifier
 * shared may use is @golems/shared itself, so a package added later is covered.
 */

import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "fs";
import { dirname, join, relative, resolve, sep } from "path";

const SHARED_ROOT = join(import.meta.dir, "..", "..");
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^import\s+)["'`]([^"'`]+)["'`]/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : sourceFiles(path);
    return /\.(ts|tsx|js|mjs)$/.test(name) && !/\.test\.[a-z]+$/.test(name) ? [path] : [];
  });
}

const isWorkspaceOther = (spec: string) => spec.startsWith("@golems/") && !/^@golems\/shared(\/|$)/.test(spec);

function climbsOut(file: string, spec: string): boolean {
  if (!spec.startsWith(".")) return false;
  const target = resolve(dirname(file), spec);
  return target !== SHARED_ROOT && !target.startsWith(SHARED_ROOT + sep);
}

/** Import specifiers in `text` (a file at `file`) that leave the shared layer. */
export function layerViolations(file: string, text: string): string[] {
  const hits: string[] = [];
  text.split("\n").forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "").trim();
    if (code.startsWith("*") || code.startsWith("/*")) return;
    for (const [, spec] of code.matchAll(SPECIFIER)) {
      if (isWorkspaceOther(spec) || climbsOut(file, spec)) hits.push(`${relative(SHARED_ROOT, file)}:${i + 1}: ${spec}`);
    }
  });
  return hits;
}

describe("shared imports nothing but itself from the workspace", () => {
  it("no source file imports another workspace package or climbs out of packages/shared", () => {
    const hits = sourceFiles(join(SHARED_ROOT, "src")).flatMap((file) => layerViolations(file, readFileSync(file, "utf8")));
    expect(hits).toEqual([]);
  });

  it("package.json declares no other workspace package", () => {
    const pkg = JSON.parse(readFileSync(join(SHARED_ROOT, "package.json"), "utf8"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies });
    expect(deps.filter(isWorkspaceOther)).toEqual([]);
  });

  it("the checker catches any other @golems package and relative escapes, and allows shared's own paths", () => {
    const file = join(SHARED_ROOT, "src", "email", "a.ts");
    const text = [
      'import { x } from "@golems/golems-tui/foo";',
      'const t = await import("../../../teller/src/index");',
      'import "@golems/green-invoice-mcp";',
      'import { y } from "@golems/shared/lib/event-log";',
      'import { z } from "../lib/config";',
      'import "./types";',
      "// import { no } from \"@golems/teller\";",
    ].join("\n");
    expect(layerViolations(file, text).map((h) => h.split(": ")[1])).toEqual([
      "@golems/golems-tui/foo",
      "../../../teller/src/index",
      "@golems/green-invoice-mcp",
    ]);
  });
});
