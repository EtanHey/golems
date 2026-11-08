// Copy expected upstream commits as inert PR data; review before merge/install.
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readVendor } from "./vendor-skills.mjs";

export function refreshVendor({ vendor, clones, expected, apply = false, git = spawnSync }) {
  const manifestPath = path.join(vendor, "manifest.json");
  const { manifest, root } = readVendor(vendor);
  const copies = [], changes = [];
  let versionChanged = false;
  if (clones.length !== manifest.upstreams.length || expected.length !== clones.length) throw new Error("provide one clone and expected SHA per upstream");
  for (const [i, clone] of clones.entries()) {
    const result = git("git", ["-C", clone, "rev-parse", "HEAD"], { encoding: "utf8" });
    const commit = result.stdout.trim();
    if (result.status !== 0 || !/^[a-f0-9]{40}$/.test(expected[i]) || commit !== expected[i]) throw new Error("clone HEAD does not match expected SHA");
    const upstream = manifest.upstreams[i];
    const skillsRoot = upstream.skillsRoot ?? "skills";
    for (const relative of [skillsRoot, upstream.pluginMetadata].filter(Boolean)) {
      if (path.isAbsolute(relative) || relative.split("/").some((part) => !part || part === "..")) throw new Error("unsafe upstream path");
      let current = clone;
      for (const part of relative.split("/")) {
        current = path.join(current, part);
        if (lstatSync(current).isSymbolicLink()) throw new Error("upstream type requires separate review");
      }
    }
    const clean = git("git", ["-C", clone, "status", "--porcelain", "--untracked-files=all", "--", skillsRoot, "LICENSE", ...(upstream.pluginMetadata ? [upstream.pluginMetadata] : [])], { encoding: "utf8" });
    if (clean.status !== 0 || clean.stdout.trim()) throw new Error("expected skill sources must be clean");
    if (upstream.pluginMetadata) {
      const metadata = path.join(clone, upstream.pluginMetadata);
      if (!lstatSync(metadata).isFile()) throw new Error("upstream type requires separate review");
      const { version } = JSON.parse(readFileSync(metadata, "utf8"));
      if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version)) throw new Error("invalid official plugin version");
      versionChanged ||= upstream.version !== version;
      upstream.version = version;
    }
    changes.push({ url: manifest.upstreams[i].url, from: manifest.upstreams[i].commit, to: commit });
    manifest.upstreams[i].commit = commit;
    const owner = i === 0 ? "anthropic" : "emilkowalski";
    for (const skill of manifest.skills.filter((s) => s.path.startsWith(`${owner}/`))) {
      const dir = path.join(clone, skillsRoot, skill.name);
      if (!lstatSync(dir).isDirectory()) throw new Error(`upstream type requires separate review: ${dir}`);
      for (const entry of readdirSync(dir)) {
        const src = path.join(dir, entry);
        if (!lstatSync(src).isFile() || !/^(.*\.md|LICENSE(\.txt)?)$/.test(entry)) throw new Error(`upstream type or script requires separate review: ${src}`);
        copies.push({ src, file: `${skill.path}/${entry}` });
      }
      if (owner === "emilkowalski") {
        const license = path.join(clone, "LICENSE");
        if (!lstatSync(license).isFile()) throw new Error(`upstream type requires separate review: ${license}`);
        copies.push({ src: license, file: `${skill.path}/LICENSE` });
      }
    }
  }
  const files = Object.fromEntries(copies.map(({ src, file }) => [file, createHash("sha256").update(readFileSync(src)).digest("hex")]));
  if (Object.keys(manifest.files).some((file) => !(file in files))) throw new Error("upstream removed a file; review retirement separately");
  if (!versionChanged && Object.keys(files).length === Object.keys(manifest.files).length && Object.entries(files).every(([file, sum]) => manifest.files[file] === sum)) return { apply: false, changed: false, changes: [], files: Object.keys(files).length };
  manifest.files = { ...manifest.files, ...files };
  if (apply) {
    let text = readFileSync(path.join(root, "VENDOR.md"), "utf8");
    for (const change of changes) text = text.replaceAll(change.from, change.to);
    const generations = path.join(vendor, "generations");
    mkdirSync(generations, { recursive: true });
    const staging = mkdtempSync(path.join(generations, ".staging-"));
    const pending = path.join(vendor, `.manifest-${randomUUID()}`);
    try {
      for (const { src, file } of copies) {
        const destination = path.join(staging, file);
        mkdirSync(path.dirname(destination), { recursive: true });
        cpSync(src, destination);
        if (createHash("sha256").update(readFileSync(destination)).digest("hex") !== files[file]) throw new Error(`source changed during copy: ${file}`);
      }
      writeFileSync(path.join(staging, "VENDOR.md"), text);
      manifest.generation = randomUUID();
      const bytes = JSON.stringify(manifest, null, 2) + "\n";
      writeFileSync(path.join(staging, "manifest.json"), bytes);
      renameSync(staging, path.join(generations, manifest.generation));
      writeFileSync(pending, bytes);
      renameSync(pending, manifestPath);
    } finally {
      rmSync(staging, { recursive: true, force: true });
      rmSync(pending, { force: true });
    }
  }
  return { apply, changed: true, changes, files: Object.keys(files).length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [anthropic, emil, shaA, shaE, flag] = process.argv.slice(2);
    if (!anthropic || !emil || !shaA || !shaE || (flag && flag !== "--apply")) throw new Error("usage: refresh-vendor.mjs <anthropic-clone> <emil-clone> <expected-sha-A> <expected-sha-E> [--apply]");
    console.log(JSON.stringify(refreshVendor({ vendor: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../vendor"), clones: [anthropic, emil], expected: [shaA, shaE], apply: flag === "--apply" }), null, 2));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
