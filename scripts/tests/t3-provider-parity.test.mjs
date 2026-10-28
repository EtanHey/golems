import { describe, expect, test } from "bun:test";

import { compareParity, formatReport, PARITY_KEYS, validateSettings } from "../sync/t3-provider-parity-lib.mjs";

const settings = () => ({
  providerInstances: {
    codex: { driver: "codex", config: { binaryPath: "~/.local/bin/codex" } },
    "codex-worker": {
      driver: "codex",
      config: { binaryPath: "~/.local/bin/codex", launchArgs: "-c mcp_servers.node_repl.enabled=false" },
    },
  },
  providerModelPreferences: { codex: { hiddenModels: ["gpt-5.6-luna"], modelOrder: [] } },
  defaultModelSelection: { instanceId: "claudeAgent" },
});

describe("compareParity", () => {
  test("identical provider settings have no drift", () => {
    expect(compareParity(settings(), settings())).toEqual([]);
  });

  test("key order does not count as drift", () => {
    const a = settings();
    const b = settings();
    b.providerInstances = { "codex-worker": a.providerInstances["codex-worker"], codex: a.providerInstances.codex };
    expect(compareParity(a, b)).toEqual([]);
  });

  test("an instance missing on one Mac is drift at its path", () => {
    const b = settings();
    delete b.providerInstances["codex-worker"];
    expect(compareParity(settings(), b).map((d) => d.path)).toEqual(["providerInstances.codex-worker"]);
  });

  test("a changed launch arg is drift at the leaf", () => {
    const b = settings();
    b.providerInstances["codex-worker"].config.launchArgs = "";
    expect(compareParity(settings(), b).map((d) => d.path)).toEqual([
      "providerInstances.codex-worker.config.launchArgs",
    ]);
  });

  test("hidden model drift is caught", () => {
    const b = settings();
    b.providerModelPreferences.codex.hiddenModels = [];
    expect(compareParity(settings(), b).map((d) => d.path)).toEqual(["providerModelPreferences.codex.hiddenModels"]);
  });

  test("per-Mac default model selections are not part of the provider set", () => {
    const b = settings();
    b.defaultModelSelection = { instanceId: "codex" };
    expect(PARITY_KEYS).not.toContain("defaultModelSelection");
    expect(compareParity(settings(), b)).toEqual([]);
  });

  test("an absolute home path is drift even when it resolves the same", () => {
    const b = settings();
    b.providerInstances.codex.config.binaryPath = "/Users/someone/.local/bin/codex";
    expect(compareParity(settings(), b).map((d) => d.path)).toEqual(["providerInstances.codex.config.binaryPath"]);
  });

  test("object key order inside arrays is not drift, array order is", () => {
    const a = settings();
    const b = settings();
    a.providerInstances.codex.config.environment = [{ name: "A", value: "1" }];
    b.providerInstances.codex.config.environment = [{ value: "1", name: "A" }];
    expect(compareParity(a, b)).toEqual([]);
    b.providerModelPreferences.codex.hiddenModels = ["x", "gpt-5.6-luna"];
    a.providerModelPreferences.codex.hiddenModels = ["gpt-5.6-luna", "x"];
    expect(compareParity(a, b).map((d) => d.path)).toEqual(["providerModelPreferences.codex.hiddenModels"]);
  });
});

describe("formatReport", () => {
  test("never prints a drifted value, even inside a missing subtree", () => {
    const secret = "SYNTHETIC_PARITY_VALUE_42";
    const a = settings();
    const b = settings();
    a.providerInstances.codex.config.environment = [{ name: "API_KEY", value: secret }];
    b.providerInstances.codex.config.apiKey = secret;
    a.providerInstances.extra = { config: { token: secret } };
    const report = formatReport({ hosts: ["local", "m1"], settingsDrift: compareParity(a, b), versionDrift: [] });
    expect(report).toContain("providerInstances.extra");
    expect(report).toContain("providerInstances.codex.config.apiKey");
    expect(report).not.toContain(secret);
  });
});

describe("validateSettings", () => {
  test("a settings document without a provider-instance object is rejected", () => {
    for (const bad of [null, [], "x", {}, { providerInstances: [] }, { providerInstances: {}, providerModelPreferences: 1 }]) {
      expect(() => validateSettings(bad, "m1")).toThrow();
    }
    expect(() => validateSettings(settings(), "m1")).not.toThrow();
  });
});

