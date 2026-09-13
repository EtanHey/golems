import { describe, expect, test } from "bun:test";

import { decideAllRepoActions, decideRepoAction } from "./repo-action.mjs";

const manifest = {
  repositories: {
    "EtanHey/brainlayer": {
      artifact: { kind: "macos-app", identifier: "BrainBar" },
    },
    "EtanHey/golems": {
      artifact: { kind: "none" },
      reason: "consumed from the repo checkout via symlinked skills",
    },
  },
};

describe("wizard repo action", () => {
  test("installable repo on a workspace is installed, never cloned", () => {
    expect(decideRepoAction(manifest, "brainlayer", "workspace")).toEqual({
      action: "INSTALL",
      artifact: "macos-app:BrainBar",
      reason: "brainlayer is distributed as macos-app:BrainBar",
    });
  });

  test("installable repo on a daemon host is installed, never cloned", () => {
    expect(decideRepoAction(manifest, "brainlayer", "daemon-host")).toEqual({
      action: "INSTALL",
      artifact: "macos-app:BrainBar",
      reason: "brainlayer is distributed as macos-app:BrainBar",
    });
  });

  test("kind none repo on a workspace may be cloned", () => {
    expect(decideRepoAction(manifest, "golems", "workspace")).toEqual({
      action: "CLONE",
      artifact: null,
      reason: "consumed from the repo checkout via symlinked skills",
    });
  });

  test("kind none repo on a daemon host is refused with the reason", () => {
    expect(decideRepoAction(manifest, "golems", "daemon-host")).toEqual({
      action: "REFUSE",
      artifact: null,
      reason: "daemon-host machines use installed artifacts and never clone repositories; golems has no installable artifact",
    });
  });

  for (const machineRole of [undefined, "laptop"]) {
    test(`${machineRole ?? "missing"} machine role refuses every repo`, () => {
      expect(decideRepoAction(manifest, "brainlayer", machineRole)).toMatchObject({
        action: "REFUSE",
        reason: `machineRole must be exactly workspace or daemon-host; received ${machineRole ?? "missing"}`,
      });
      expect(decideRepoAction(manifest, "golems", machineRole)).toMatchObject({
        action: "REFUSE",
        reason: `machineRole must be exactly workspace or daemon-host; received ${machineRole ?? "missing"}`,
      });
    });
  }

  test("repo absent from the release gate is refused", () => {
    expect(decideRepoAction(manifest, "orchestrator", "workspace")).toEqual({
      action: "REFUSE",
      artifact: null,
      reason: "orchestrator is not classified in release-gate.json; refusing to clone",
    });
  });

  test("ambiguous basenames are refused while enumeration retains qualified slugs", () => {
    const collisionManifest = {
      repositories: {
        "EtanHey/tool": { artifact: { kind: "none" }, reason: "primary checkout" },
        "SomebodyElse/tool": { artifact: { kind: "macos-app", identifier: "OtherTool" } },
      },
    };

    expect(decideRepoAction(collisionManifest, "tool", "workspace")).toEqual({
      action: "REFUSE",
      artifact: null,
      reason: "tool matches multiple repositories in release-gate.json; use a qualified slug",
    });
    expect(decideAllRepoActions(collisionManifest, "workspace").map(({ repo, action }) => ({ repo, action }))).toEqual([
      { repo: "EtanHey/tool", action: "CLONE" },
      { repo: "SomebodyElse/tool", action: "INSTALL" },
    ]);
  });
});
