import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// SOUL.md is the bot's system prompt, loaded at runtime (lib/bot-shared.ts).
const soul = readFileSync(join(import.meta.dir, "..", "SOUL.md"), "utf-8");

describe("SOUL.md persona", () => {
  it("names only projects that still exist", () => {
    // Zikaron was renamed BrainLayer; Ralph (claude-golem) and the
    // GolemsZikaron bot name are retired.
    for (const retired of ["Zikaron", "Ralph", "Claude-Golem", "Moltbook"]) {
      expect(soul).not.toContain(retired);
    }
    expect(soul).toContain("BrainLayer");
  });

  it("keeps the voice", () => {
    expect(soul).toContain("**Formality: 2/10**");
    expect(soul).toContain('**Tagline:** "I post, I chat, I represent us."');
  });
});
