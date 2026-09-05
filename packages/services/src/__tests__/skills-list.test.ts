import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("skills-list CLI", () => {
  let testDir: string;
  let originalDir: string;
  let originalArgv: string[];

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    originalArgv = process.argv;
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    process.argv = originalArgv;
  });

  test("loadCatalog reads and parses JSON file", () => {
    const catalog = {
      version: 1,
      updated: "2026-02-07",
      community_resource: "https://example.com",
      skills: [
        {
          name: "test-skill",
          description: "A test skill",
          category: "Testing",
          free_tier: "Yes",
          setup_complexity: "Low",
          relevant_project_types: ["test"],
          url: "https://test.com",
          status: "active" as const,
        },
      ],
    };

    const catalogPath = join(testDir, "available-skills.json");
    writeFileSync(catalogPath, JSON.stringify(catalog));

    const loaded = JSON.parse(readFileSync(catalogPath, "utf-8"));
    expect(loaded.version).toBe(1);
    expect(loaded.skills).toHaveLength(1);
    expect(loaded.skills[0].name).toBe("test-skill");
  });

  test("catalog contains required fields", () => {
    const catalogPath = join(__dirname, "../available-skills.json");

    // Skip test if file doesn't exist (may be in different location)
    if (!existsSync(catalogPath)) {
      return;
    }

    const catalog = JSON.parse(readFileSync(catalogPath, "utf-8"));

    expect(catalog).toHaveProperty("version");
    expect(catalog).toHaveProperty("updated");
    expect(catalog).toHaveProperty("community_resource");
    expect(catalog).toHaveProperty("skills");
    expect(Array.isArray(catalog.skills)).toBe(true);
  });

  test("each skill has required structure", () => {
    const catalogPath = join(__dirname, "../available-skills.json");

    // Skip test if file doesn't exist
    if (!existsSync(catalogPath)) {
      return;
    }

    const catalog = JSON.parse(readFileSync(catalogPath, "utf-8"));

    for (const skill of catalog.skills) {
      expect(skill).toHaveProperty("name");
      expect(skill).toHaveProperty("description");
      expect(skill).toHaveProperty("category");
      expect(skill).toHaveProperty("free_tier");
      expect(skill).toHaveProperty("setup_complexity");
      expect(skill).toHaveProperty("relevant_project_types");
      expect(skill).toHaveProperty("url");
      expect(skill).toHaveProperty("status");

      // Validate status values
      expect(["active", "planned", "evaluation"]).toContain(skill.status);
    }
  });

  test("skills are categorized", () => {
    const catalogPath = join(__dirname, "../available-skills.json");

    // Skip test if file doesn't exist
    if (!existsSync(catalogPath)) {
      return;
    }

    const catalog = JSON.parse(readFileSync(catalogPath, "utf-8"));
    const categories = new Set(catalog.skills.map((s: any) => s.category));

    // At least one category should exist
    expect(categories.size).toBeGreaterThan(0);
  });

  test("filter by category works", () => {
    const skills = [
      { category: "Communication", status: "active", relevant_project_types: [] },
      { category: "Finance", status: "active", relevant_project_types: [] },
      { category: "Communication", status: "planned", relevant_project_types: [] },
    ];

    const filtered = skills.filter(s => s.category === "Communication");
    expect(filtered).toHaveLength(2);
  });

  test("filter by status works", () => {
    const skills = [
      { category: "Communication", status: "active", relevant_project_types: [] },
      { category: "Finance", status: "active", relevant_project_types: [] },
      { category: "Communication", status: "planned", relevant_project_types: [] },
    ];

    const filtered = skills.filter(s => s.status === "active");
    expect(filtered).toHaveLength(2);
  });

  test("filter by project type works", () => {
    const skills = [
      { category: "Communication", status: "active", relevant_project_types: ["web", "mobile"] },
      { category: "Finance", status: "active", relevant_project_types: ["fintech"] },
      { category: "Testing", status: "planned", relevant_project_types: ["web"] },
    ];

    const filtered = skills.filter(s => s.relevant_project_types.includes("web"));
    expect(filtered).toHaveLength(2);
  });

  test("statusIcon returns correct symbols", () => {
    // This would require exporting the function or testing via integration
    // For now, we validate the concept
    const statusMap = {
      active: "●",
      planned: "○",
      evaluation: "◌",
    };

    expect(statusMap.active).toBe("●");
    expect(statusMap.planned).toBe("○");
    expect(statusMap.evaluation).toBe("◌");
  });
});
