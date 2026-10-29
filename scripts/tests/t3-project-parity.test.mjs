import { describe, expect, test } from "bun:test";

import {
  auditProjects,
  canonicalRepoKey,
  groupingKeyFromRemotes,
  precheckRegistration,
} from "../sync/t3-project-parity-lib.mjs";

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

  test("ports drop, subgroups stay and single-label hosts work, as in T3", () => {
    expect(canonicalRepoKey("ssh://git@github.com:22/EtanHey/repo.git")).toBe("github.com/etanhey/repo");
    expect(canonicalRepoKey("https://gitlab.com/group/sub/repo.git")).toBe("gitlab.com/group/sub/repo");
    expect(canonicalRepoKey("git@gitbox:team/repo")).toBe("gitbox/team/repo");
  });

  test("a folder without a parsable remote has no key", () => {
    expect(canonicalRepoKey("")).toBeNull();
    expect(canonicalRepoKey("not a url")).toBeNull();
  });
});

describe("groupingKeyFromRemotes", () => {
  const remotes = (...pairs) => pairs.map(([name, url]) => `${name}\t${url} (fetch)\n${name}\t${url} (push)`).join("\n");

  test("T3 groups by the origin remote when a fork also has upstream", () => {
    const text = remotes(["origin", "https://github.com/EtanHey/t3code.git"], ["upstream", "https://github.com/pingdotgg/t3code.git"]);
    expect(groupingKeyFromRemotes(text)).toBe("github.com/etanhey/t3code");
  });

  test("without origin, upstream and then the first remote by name decide", () => {
    expect(groupingKeyFromRemotes(remotes(["upstream", "https://github.com/a/b"], ["zeta", "https://github.com/z/z"]))).toBe("github.com/a/b");
    expect(groupingKeyFromRemotes(remotes(["zeta", "https://github.com/z/z"], ["beta", "https://github.com/b/b"]))).toBe("github.com/b/b");
  });

  test("local remotes are ignored and partial-clone filters still parse", () => {
    expect(groupingKeyFromRemotes(remotes(["origin", "/home/example/repo"]))).toBeNull();
    expect(groupingKeyFromRemotes("origin\thttps://github.com/a/b (fetch) [blob:none]\n")).toBe("github.com/a/b");
    expect(groupingKeyFromRemotes("")).toBeNull();
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
