import { afterEach, describe, expect, it } from "bun:test";
import { $ } from "bun";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  defaultWorktreePath,
  resolveExistingWorktreePath,
} from "@golems/services/worktree-path";
import { createWorktree } from "@golems/services/night-shift";

const temporaryRepositories: string[] = [];

afterEach(() => {
  for (const repository of temporaryRepositories.splice(0)) {
    rmSync(repository, { recursive: true, force: true });
  }
});

describe("worktree paths", () => {
  it("defaults new worktrees inside the repository", () => {
    expect(defaultWorktreePath("/Users/example/Gits/golems", "nightshift-123"))
      .toBe("/Users/example/Gits/golems/.worktrees/nightshift-123");
  });

  it("resolves an existing legacy sibling worktree during migration", () => {
    const legacyPath = "/Users/example/Gits/golems.wt/nightshift-123";

    expect(
      resolveExistingWorktreePath(
        "/Users/example/Gits/golems",
        "nightshift-123",
        (path) => path === legacyPath,
      ),
    ).toBe(legacyPath);
  });

  it("creates Night Shift worktrees below the repository", async () => {
    const repository = mkdtempSync(join(tmpdir(), "night-shift-worktree-"));
    temporaryRepositories.push(repository);
    writeFileSync(join(repository, "README.md"), "fixture\n");
    await $`git -C ${repository} init -q -b main`;
    await $`git -C ${repository} config user.email test@example.com`;
    await $`git -C ${repository} config user.name Test`;
    await $`git -C ${repository} add README.md`;
    await $`git -C ${repository} commit -q -m fixture`;

    const worktree = await createWorktree(repository, "nightshift/test");

    expect(worktree).toMatch(new RegExp(`^${repository}/\\.worktrees/nightshift-\\d+$`));
    expect(await $`git -C ${repository} worktree list --porcelain`.text()).toContain(worktree);
    await $`git -C ${repository} worktree remove --force ${worktree}`;
  });
});
