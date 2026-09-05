/**
 * Plugin Loader - Auto-inject project-specific context
 *
 * Plugins are JSON files with:
 * - name: unique identifier
 * - triggers: array of file extensions or path substrings
 * - context: markdown text to inject
 *
 * Usage:
 *   const plugins = loadPlugins("/path/to/plugins/");
 *   const matches = matchPlugins("/src/App.tsx", plugins);
 *   const context = injectContext(matches);
 */

import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";

/** A plugin that injects context based on file type triggers */
export interface Plugin {
  name: string;
  triggers: string[];
  context: string;
}

/**
 * Load all plugins from a directory
 * @param dir - Directory containing .json plugin files
 * @returns Array of valid plugins
 */
export function loadPlugins(dir: string): Plugin[] {
  if (!existsSync(dir)) {
    return [];
  }

  const plugins: Plugin[] = [];

  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

    for (const file of files) {
      try {
        const content = readFileSync(join(dir, file), "utf-8");
        const plugin = JSON.parse(content);

        // Validate required fields
        if (
          plugin.name &&
          Array.isArray(plugin.triggers) &&
          typeof plugin.context === "string"
        ) {
          plugins.push(plugin as Plugin);
        }
      } catch (err) {
        // Skip invalid JSON files
        continue;
      }
    }
  } catch (err) {
    // Directory read error
    return [];
  }

  return plugins;
}

/**
 * Match plugins that should be loaded for a given file path
 * @param filePath - File path to match against
 * @param plugins - Array of available plugins
 * @returns Plugins that match the file path
 */
export function matchPlugins(filePath: string, plugins: Plugin[]): Plugin[] {
  const lowerPath = filePath.toLowerCase();

  return plugins.filter((plugin) => {
    return plugin.triggers.some((trigger) => {
      const lowerTrigger = trigger.toLowerCase();

      // Check if trigger is a file extension
      if (trigger.startsWith(".")) {
        return lowerPath.endsWith(lowerTrigger);
      }

      // Otherwise check if trigger substring exists in path
      return lowerPath.includes(lowerTrigger);
    });
  });
}

/**
 * Format plugin contexts for injection into Claude's context
 * @param plugins - Matched plugins
 * @returns Formatted markdown string
 */
export function injectContext(plugins: Plugin[]): string {
  if (plugins.length === 0) {
    return "";
  }

  const sections = plugins.map((plugin) => {
    return `## Plugin: ${plugin.name}\n\n${plugin.context}`;
  });

  return `# Loaded Plugins\n\n${sections.join("\n\n")}`;
}
