import { describe, it, expect } from "bun:test";

import {
  checkPrerequisite,
  getPrerequisites,
  getRequiredEnvVars,
  getServiceOptions,
  generateSetupLog,
  shellExec,
} from "@golems/services/wizard";

describe("wizard", () => {
  describe("checkPrerequisite", () => {
    it("detects installed tool and returns version", () => {
      // bun is always available in the test environment
      const result = checkPrerequisite("bun", "--version", "curl install");

      expect(result.name).toBe("bun");
      expect(result.found).toBe(true);
      expect(result.version).toBeDefined();
      expect(result.installCmd).toBeUndefined();
    });

    it("detects missing tool and returns install command", () => {
      const result = checkPrerequisite("nonexistent-tool-xyz-999", "--version", "npm i -g xyz");

      expect(result.name).toBe("nonexistent-tool-xyz-999");
      expect(result.found).toBe(false);
      expect(result.version).toBeUndefined();
      expect(result.installCmd).toBe("npm i -g xyz");
    });
  });

  describe("service catalog", () => {
    it("does not expose retired Railway setup as a selectable service", () => {
      const services = getServiceOptions();
      const serviceText = services
        .map((service) => `${service.key} ${service.name} ${service.description} ${service.diskImpact}`)
        .join("\n");

      expect(services.map((service) => service.key)).not.toContain("cloud");
      expect(serviceText).not.toContain("Railway");
    });

    it("does not require the Railway CLI for setup", () => {
      expect(getPrerequisites().map((prereq) => prereq.name)).not.toContain("railway");
    });
  });

  describe("getRequiredEnvVars", () => {
    it("returns unique env vars for selected services", () => {
      const vars = getRequiredEnvVars(["email", "job"]);

      expect(vars).toContain("GMAIL_CLIENT_ID");
      expect(vars).toContain("SUPABASE_URL");
      expect(vars).toContain("SUPABASE_ANON_KEY");
      // SUPABASE_URL appears in both but should be deduplicated
      const supabaseCount = vars.filter((v) => v === "SUPABASE_URL").length;
      expect(supabaseCount).toBe(1);
    });

    it("returns empty array when no services selected", () => {
      const vars = getRequiredEnvVars([]);
      expect(vars).toEqual([]);
    });

    it("returns telegram vars for telegram service", () => {
      const vars = getRequiredEnvVars(["telegram"]);
      expect(vars).toContain("TELEGRAM_BOT_TOKEN");
      expect(vars).toContain("TELEGRAM_CHAT_ID");
      expect(vars).not.toContain("SUPABASE_URL");
    });
  });

  describe("generateSetupLog", () => {
    it("generates valid markdown with all phases", () => {
      const log: Array<{
        phase: string;
        item: string;
        status: "ok" | "skipped" | "failed" | "warning";
        detail?: string;
      }> = [
        { phase: "preflight", item: "bun", status: "ok", detail: "1.1.42" },
        { phase: "preflight", item: "git", status: "ok", detail: "git version 2.43" },
        { phase: "core", item: "repo", status: "ok" },
        { phase: "services", item: "telegram", status: "ok", detail: "selected" },
        { phase: "services", item: "email", status: "skipped" },
        { phase: "secrets", item: "TELEGRAM_BOT_TOKEN", status: "warning", detail: "missing" },
      ];

      const md = generateSetupLog(log, ["telegram"]);

      expect(md).toContain("# Golems Setup Log");
      expect(md).toContain("**Selected Services:** telegram");
      expect(md).toContain("## Phase: preflight");
      expect(md).toContain("## Phase: core");
      expect(md).toContain("## Phase: services");
      expect(md).toContain("## Phase: secrets");
      expect(md).toContain("| bun | OK | 1.1.42 |");
      expect(md).toContain("| TELEGRAM_BOT_TOKEN | WARN | missing |");
      expect(md).toContain("## Next Steps");
    });

    it("handles empty log gracefully", () => {
      const md = generateSetupLog([], []);

      expect(md).toContain("# Golems Setup Log");
      expect(md).toContain("**Selected Services:** none");
      expect(md).toContain("## Next Steps");
    });
  });

  describe("shellExec", () => {
    it("returns ok true on successful command", () => {
      const result = shellExec("echo hello");

      expect(result.ok).toBe(true);
      expect(result.output).toContain("hello");
    });

    it("returns ok false on failed command", () => {
      const result = shellExec("nonexistent-cmd-xyz-999");

      expect(result.ok).toBe(false);
      expect(result.output).toBe("");
    });
  });
});
