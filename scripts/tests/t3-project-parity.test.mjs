import { describe, expect, test } from "bun:test";

import { auditProjects, canonicalRepoKey, precheckRegistration } from "../sync/t3-project-parity-lib.mjs";

const project = (host, id, root, key, extra = {}) => ({
  host,
  id,
  title: root.split("/").at(-1),
  root,
  key,
  icon: null,
  favicon: null,
  scripts: "[]",
  ...extra,
});

describe("canonicalRepoKey", () => {
  test("https, ssh and .git forms of one repo share a key", () => {
    for (const url of [
      "https://github.com/EtanHey/tokenlayer",
      "https://github.com/EtanHey/tokenlayer.git",
      "git@github.com:EtanHey/tokenlayer.git",
      "ssh://git@github.com/EtanHey/tokenlayer",
    ]) {
      expect(canonicalRepoKey(url)).toBe("github.com/etanhey/tokenlayer");
    }
  });

  test("a folder without a parsable remote has no key", () => {
    expect(canonicalRepoKey("")).toBeNull();
    expect(canonicalRepoKey("not a url")).toBeNull();
  });
});

describe("auditProjects", () => {
  test("one project per repo per Mac with matching settings is clean", () => {
    const projects = [
      project("m4", "a", "/m4/Gits/tokenlayer", "github.com/etanhey/tokenlayer", { icon: '{"kind":"emoji"}' }),
      project("m1", "b", "/m1/Gits/tokenlayer", "github.com/etanhey/tokenlayer", { icon: '{"kind":"emoji"}' }),
    ];
    expect(auditProjects(projects)).toEqual([]);
  });

  test("a second project for the same repo on one Mac is a duplicate", () => {
    const projects = [
      project("m1", "b", "/m1/Gits/tokenlayer", "github.com/etanhey/tokenlayer"),
      project("m1", "c", "/m1/Gits/tokenlayer-slot1", "github.com/etanhey/tokenlayer"),
    ];
    expect(auditProjects(projects)).toEqual([
      { kind: "duplicate", key: "github.com/etanhey/tokenlayer", host: "m1", ids: ["b", "c"] },
    ]);
  });

  test("a repo on both Macs with a different icon, title or scripts is drift", () => {
    const projects = [
      project("m4", "a", "/m4/Gits/tokenlayer", "github.com/etanhey/tokenlayer", {
        icon: '{"kind":"lucide","name":"coins"}',
        scripts: '[{"id":"install"}]',
      }),
      project("m1", "b", "/m1/Gits/tokenlayer", "github.com/etanhey/tokenlayer"),
    ];
    expect(auditProjects(projects)).toEqual([
      { kind: "drift", key: "github.com/etanhey/tokenlayer", fields: ["icon", "scripts"] },
    ]);
  });

  test("a repo on only one Mac and a folder with no remote are not findings", () => {
    const projects = [
      project("m4", "a", "/m4/Gits/coach", "github.com/etanhey/coach"),
      project("m4", "s", "/m4/.t3/scratch", null),
      project("m1", "t", "/m1/.t3/scratch", null),
    ];
    expect(auditProjects(projects)).toEqual([]);
  });
});

describe("precheckRegistration", () => {
  const projects = [project("m1", "b", "/m1/Gits/tokenlayer", "github.com/etanhey/tokenlayer")];

  test("refuses when the target Mac already has a project for the repo", () => {
    expect(precheckRegistration(projects, "m1", "git@github.com:EtanHey/tokenlayer.git")).toEqual({
      ok: false,
      reuse: { id: "b", root: "/m1/Gits/tokenlayer" },
    });
  });

  test("allows the first project for a repo on that Mac", () => {
    expect(precheckRegistration(projects, "m4", "https://github.com/EtanHey/tokenlayer")).toEqual({ ok: true });
    expect(precheckRegistration(projects, "m1", "https://github.com/EtanHey/coach")).toEqual({ ok: true });
  });

  test("an unparsable remote is refused rather than waved through", () => {
    expect(precheckRegistration(projects, "m1", "nonsense")).toEqual({ ok: false, error: "unparsable remote" });
  });
});
