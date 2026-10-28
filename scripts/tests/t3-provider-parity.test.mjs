import { describe, expect, test } from "bun:test";

import { compareParity, PARITY_KEYS } from "../sync/t3-provider-parity-lib.mjs";

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
    expect(compareParity(settings(), b)).toEqual([
      {
        path: "providerInstances.codex-worker.config.launchArgs",
        a: "-c mcp_servers.node_repl.enabled=false",
        b: "",
      },
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
});
