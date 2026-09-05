import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  loadPlugins,
  matchPlugins,
  injectContext,
  type Plugin,
} from "@golems/shared/lib/plugin-loader";

describe("plugin-loader", () => {
  let testPluginDir: string;

  beforeEach(() => {
    testPluginDir = join(tmpdir(), `plugin-test-${Date.now()}`);
    mkdirSync(testPluginDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testPluginDir)) {
      rmSync(testPluginDir, { recursive: true });
    }
  });

  describe("loadPlugins", () => {
    test("loads plugins from directory", () => {
      const plugin1 = {
        name: "frontend-design",
        triggers: [".tsx", ".jsx"],
        context: "UI design rules for React components",
      };
      const plugin2 = {
        name: "database",
        triggers: [".sql", "migration"],
        context: "Supabase patterns and SQL best practices",
      };

      writeFileSync(
        join(testPluginDir, "frontend-design.json"),
        JSON.stringify(plugin1)
      );
      writeFileSync(
        join(testPluginDir, "database.json"),
        JSON.stringify(plugin2)
      );

      const plugins = loadPlugins(testPluginDir);

      expect(plugins).toHaveLength(2);
      // Sort by name for consistent comparison (filesystem order is not guaranteed)
      plugins.sort((a, b) => a.name.localeCompare(b.name));
      expect(plugins[0]).toEqual(plugin2); // database comes first alphabetically
      expect(plugins[1]).toEqual(plugin1); // frontend-design comes second
    });

    test("returns empty array for non-existent directory", () => {
      const plugins = loadPlugins("/nonexistent/path");
      expect(plugins).toEqual([]);
    });

    test("skips invalid JSON files", () => {
      const validPlugin = {
        name: "valid",
        triggers: [".ts"],
        context: "Valid plugin",
      };

      writeFileSync(
        join(testPluginDir, "valid.json"),
        JSON.stringify(validPlugin)
      );
      writeFileSync(join(testPluginDir, "invalid.json"), "{ invalid json }");

      const plugins = loadPlugins(testPluginDir);

      expect(plugins).toHaveLength(1);
      expect(plugins[0].name).toBe("valid");
    });

    test("skips files missing required fields", () => {
      const incomplete = {
        name: "incomplete",
        // missing triggers and context
      };

      writeFileSync(
        join(testPluginDir, "incomplete.json"),
        JSON.stringify(incomplete)
      );

      const plugins = loadPlugins(testPluginDir);
      expect(plugins).toEqual([]);
    });
  });

  describe("matchPlugins", () => {
    let plugins: Plugin[];

    beforeEach(() => {
      plugins = [
        {
          name: "frontend-design",
          triggers: [".tsx", ".jsx"],
          context: "UI design rules",
        },
        {
          name: "database",
          triggers: [".sql", "migration"],
          context: "SQL patterns",
        },
        {
          name: "typescript",
          triggers: [".ts", ".tsx"],
          context: "TypeScript best practices",
        },
      ];
    });

    test("matches by file extension", () => {
      const matches = matchPlugins("/path/to/file.tsx", plugins);

      expect(matches).toHaveLength(2);
      expect(matches.map((p) => p.name)).toEqual([
        "frontend-design",
        "typescript",
      ]);
    });

    test("matches by substring in path", () => {
      const matches = matchPlugins(
        "/path/to/migrations/001_create_users.sql",
        plugins
      );

      expect(matches).toHaveLength(1);
      expect(matches[0].name).toBe("database");
    });

    test("returns empty array when no matches", () => {
      const matches = matchPlugins("/path/to/file.md", plugins);
      expect(matches).toEqual([]);
    });

    test("is case-insensitive for extensions", () => {
      const matches = matchPlugins("/path/to/FILE.TSX", plugins);
      expect(matches).toHaveLength(2);
    });

    test("matches multiple triggers", () => {
      const sqlMatches = matchPlugins("/path/to/schema.sql", plugins);
      expect(sqlMatches).toHaveLength(1);
      expect(sqlMatches[0].name).toBe("database");

      const migrationMatches = matchPlugins(
        "/path/to/migration/001.sql",
        plugins
      );
      expect(migrationMatches).toHaveLength(1);
      expect(migrationMatches[0].name).toBe("database");
    });
  });

  describe("injectContext", () => {
    test("formats single plugin context", () => {
      const plugins: Plugin[] = [
        {
          name: "frontend-design",
          triggers: [".tsx"],
          context: "UI design rules for React",
        },
      ];

      const context = injectContext(plugins);

      expect(context).toContain("## Plugin: frontend-design");
      expect(context).toContain("UI design rules for React");
    });

    test("formats multiple plugin contexts", () => {
      const plugins: Plugin[] = [
        {
          name: "frontend-design",
          triggers: [".tsx"],
          context: "UI design rules",
        },
        {
          name: "typescript",
          triggers: [".ts"],
          context: "TypeScript patterns",
        },
      ];

      const context = injectContext(plugins);

      expect(context).toContain("## Plugin: frontend-design");
      expect(context).toContain("UI design rules");
      expect(context).toContain("## Plugin: typescript");
      expect(context).toContain("TypeScript patterns");
    });

    test("returns empty string for no plugins", () => {
      const context = injectContext([]);
      expect(context).toBe("");
    });

    test("includes header when plugins present", () => {
      const plugins: Plugin[] = [
        {
          name: "test",
          triggers: [".ts"],
          context: "Test context",
        },
      ];

      const context = injectContext(plugins);

      expect(context).toContain("# Loaded Plugins");
      expect(context).toContain("## Plugin: test");
    });
  });

  describe("integration", () => {
    test("full workflow: load -> match -> inject", () => {
      // Create plugins
      const frontendPlugin = {
        name: "frontend-design",
        triggers: [".tsx", ".jsx"],
        context:
          "Use semantic HTML. Follow RTL design for Hebrew. Keep components small.",
      };
      const dbPlugin = {
        name: "database",
        triggers: [".sql", "migration"],
        context: "Always use RLS. Enable realtime where needed.",
      };

      writeFileSync(
        join(testPluginDir, "frontend-design.json"),
        JSON.stringify(frontendPlugin)
      );
      writeFileSync(
        join(testPluginDir, "database.json"),
        JSON.stringify(dbPlugin)
      );

      // Load all plugins
      const allPlugins = loadPlugins(testPluginDir);
      expect(allPlugins).toHaveLength(2);

      // Match for a .tsx file
      const tsxMatches = matchPlugins("/src/components/Button.tsx", allPlugins);
      expect(tsxMatches).toHaveLength(1);
      expect(tsxMatches[0].name).toBe("frontend-design");

      // Inject context
      const context = injectContext(tsxMatches);
      expect(context).toContain("frontend-design");
      expect(context).toContain("RTL design");
      expect(context).not.toContain("database");

      // Match for a migration file
      const sqlMatches = matchPlugins(
        "/supabase/migrations/001.sql",
        allPlugins
      );
      expect(sqlMatches).toHaveLength(1);
      expect(sqlMatches[0].name).toBe("database");

      // Inject SQL context
      const sqlContext = injectContext(sqlMatches);
      expect(sqlContext).toContain("database");
      expect(sqlContext).toContain("RLS");
      expect(sqlContext).not.toContain("RTL");
    });
  });
});
