import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const rulesDir = fileURLToPath(new URL("../../.claude/rules/", import.meta.url));
const rules = readdirSync(rulesDir, { recursive: true })
  .filter((file) => file.endsWith(".md"));

for (const file of rules) {
  test(`${file} uses Claude paths frontmatter for scoping`, () => {
    const source = readFileSync(`${rulesDir}/${file}`, "utf8");
    const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!frontmatter) return; // Unscoped rules are valid.
    const fields = parse(frontmatter[1]) ?? {};
    expect(fields).not.toHaveProperty("globs");
    if ("paths" in fields) {
      expect(Array.isArray(fields.paths)).toBe(true);
      expect(fields.paths.length).toBeGreaterThan(0);
      for (const pattern of fields.paths) {
        expect(typeof pattern).toBe("string");
        expect(pattern.trim().length).toBeGreaterThan(0);
      }
    }
  });
}
