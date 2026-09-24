/**
 * Layering guard: @golems/shared is the base layer. Domain packages import it,
 * so it must never import them back (statically, dynamically, or as a dependency).
 */

import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const SHARED_ROOT = join(import.meta.dir, "..", "..");
const DOMAIN = /@golems\/(teller|recruiter|coach|jobs|claude|content|services)\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : sourceFiles(path);
    return /\.(ts|tsx|js|mjs)$/.test(name) && !/\.test\.[a-z]+$/.test(name) ? [path] : [];
  });
}

describe("shared has no domain-package imports", () => {
  it("no source file imports a domain package", () => {
    const hits: string[] = [];
    for (const file of sourceFiles(join(SHARED_ROOT, "src"))) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, "").trim();
        if (code.startsWith("*") || code.startsWith("/*")) return;
        if (/(from|import\(|require\()\s*["'`]/.test(code) && DOMAIN.test(code)) {
          hits.push(`${relative(SHARED_ROOT, file)}:${i + 1}: ${code}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });

  it("package.json declares no domain package", () => {
    const pkg = JSON.parse(readFileSync(join(SHARED_ROOT, "package.json"), "utf8"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies });
    expect(deps.filter((name) => DOMAIN.test(name))).toEqual([]);
  });
});
