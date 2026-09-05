import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import profile from "../profile.json";

describe("public example matching profile", () => {
  it("uses synthetic identity and portable example data", () => {
    expect(profile.name).toBe("Avery Example");
    expect(profile.location).toBe("Remote");
    expect(profile.targetLocation).toBe("Remote");
    expect(profile.resumePath).toBe("examples/synthetic-candidate-resume.txt");
    expect(existsSync(join(import.meta.dir, "../..", profile.resumePath))).toBe(true);

    const serialized = JSON.stringify(profile);
    expect(serialized).not.toMatch(/Etan|Heyman|Rehovot|\/Users\//i);
  });
});
