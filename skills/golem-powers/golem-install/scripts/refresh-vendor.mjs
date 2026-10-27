// Refresh only from already-reviewed local clones; never runs upstream code.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function refreshVendor({ vendor, clones, reviewed, apply = false, git = spawnSync }) {
  const manifestPath = path.join(vendor, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath));
  const copies = [], changes = [];
  if (clones.length !== manifest.upstreams.length || reviewed.length !== clones.length) throw new Error("provide one clone and reviewed SHA per upstream");
  for (const [i, clone] of clones.entries()) {
    const result = git("git", ["-C", clone, "rev-parse", "HEAD"], { encoding: "utf8" });
    const commit = result.stdout.trim();
    if (result.status !== 0 || !/^[a-f0-9]{40}$/.test(reviewed[i]) || commit !== reviewed[i]) throw new Error("clone HEAD does not match reviewed SHA");
    const clean = git("git", ["-C", clone, "status", "--porcelain", "--untracked-files=all", "--", "skills", "LICENSE"], { encoding: "utf8" });
    if (clean.status !== 0 || clean.stdout.trim()) throw new Error("reviewed skill sources must be clean");
    changes.push({ url: manifest.upstreams[i].url, from: manifest.upstreams[i].commit, to: commit });
    manifest.upstreams[i].commit = commit;
    const owner = i === 0 ? "anthropic" : "emilkowalski";
    for (const skill of manifest.skills.filter((s) => s.path.startsWith(`${owner}/`))) {
      const dir = path.join(clone, "skills", skill.name);
      for (const entry of readdirSync(dir)) {
        const src = path.join(dir, entry);
        if (!lstatSync(src).isFile() || !/^(.*\.md|LICENSE(\.txt)?)$/.test(entry)) throw new Error(`new script/type requires separate review: ${src}`);
        copies.push({ src, file: `${skill.path}/${entry}` });
      }
      if (owner === "emilkowalski") copies.push({ src: path.join(clone, "LICENSE"), file: `${skill.path}/LICENSE` });
    }
  }
  const files = Object.fromEntries(copies.map(({ src, file }) => [file, createHash("sha256").update(readFileSync(src)).digest("hex")]));
  if (Object.keys(manifest.files).some((file) => !(file in files))) throw new Error("upstream removed a file; review retirement separately");
  manifest.files = { ...manifest.files, ...files };
  if (apply) {
    for (const { src, file } of copies) cpSync(src, path.join(vendor, file));
    const provenance = path.join(vendor, "VENDOR.md");
    let text = readFileSync(provenance, "utf8");
    for (const change of changes) text = text.replaceAll(change.from, change.to);
    writeFileSync(provenance, text);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  }
  return { apply, changes, files: Object.keys(files).length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [anthropic, emil, shaA, shaE, flag] = process.argv.slice(2);
    if (!anthropic || !emil || !shaA || !shaE || (flag && flag !== "--apply")) throw new Error("usage: refresh-vendor.mjs <anthropic-clone> <emil-clone> <reviewed-sha-A> <reviewed-sha-E> [--apply]");
    console.log(JSON.stringify(refreshVendor({ vendor: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../vendor"), clones: [anthropic, emil], reviewed: [shaA, shaE], apply: flag === "--apply" }), null, 2));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
