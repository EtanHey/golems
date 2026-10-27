import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, renameSync, symlinkSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const roots = { claude: ".claude/skills", codex: ".codex/skills", cursor: ".cursor/skills", gemini: ".gemini/config/skills" };
const present = (p) => { try { lstatSync(p); return true; } catch (e) { if (e.code === "ENOENT") return false; throw e; } };

function verify(root, files) {
  for (const [file, expected] of Object.entries(files)) {
    if (!/^(anthropic|emilkowalski)\/[a-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(file)) throw new Error(`unsafe vendor path: ${file}`);
    const p = path.join(root, file);
    if (lstatSync(path.dirname(p)).isSymbolicLink() || !lstatSync(p).isFile() || lstatSync(p).isSymbolicLink() || hash(readFileSync(p)) !== expected) throw new Error(`vendor hash/type drift: ${file}`);
  }
}

export function installVendorSkills({ home, source, apply = false }) {
  home = realpathSync(home);
  const vendor = path.resolve(source, "..", "vendor");
  const bytes = readFileSync(path.join(vendor, "manifest.json"));
  const manifest = JSON.parse(bytes);
  if (manifest.schema !== 1) throw new Error("unsupported vendor manifest");
  verify(vendor, manifest.files);
  const ownedRoot = path.join(home, ".golems/vendor/design-skills");
  const snapshot = path.join(ownedRoot, hash(JSON.stringify({ skills: manifest.skills.map(({ name, path }) => ({ name, path })), files: manifest.files, upstreams: manifest.upstreams })));
  const links = [];
  for (const provider of manifest.providers) {
    if (!roots[provider]) throw new Error(`unsupported vendor provider: ${provider}`);
    const root = path.join(home, roots[provider]);
    for (let p = root; p !== home; p = path.dirname(p)) {
      if (present(p) && lstatSync(p).isSymbolicLink()) throw new Error(`vendor root is symlinked: ${p}`);
    }
    for (const skill of manifest.skills) {
      if (skill.providers && !skill.providers.includes(provider)) continue;
      if (!/^[a-z0-9-]+$/.test(skill.name) || !manifest.files[`${skill.path}/SKILL.md`] || path.basename(skill.path) !== skill.name) throw new Error("invalid vendor skill entry");
      const entry = path.join(root, skill.name), target = path.join(snapshot, skill.path);
      if (present(entry)) {
        if (!lstatSync(entry).isSymbolicLink()) throw new Error(`vendor conflict; back up and retire explicitly: ${entry}`);
        const previous = existsSync(entry) ? realpathSync(entry) : path.resolve(path.dirname(entry), readlinkSync(entry));
        const relative = path.relative(existsSync(ownedRoot) ? realpathSync(ownedRoot) : ownedRoot, previous);
        const pin = relative.split(path.sep)[0];
        if (!/^[a-f0-9]{64}$/.test(pin) || relative !== path.join(pin, skill.path)) throw new Error(`vendor conflict; back up and retire explicitly: ${entry}`);
      }
      links.push({ entry, target, name: skill.name, provider });
    }
  }
  if (existsSync(snapshot)) verify(snapshot, manifest.files);
  if (apply && !existsSync(snapshot)) {
    mkdirSync(path.dirname(snapshot), { recursive: true });
    const staging = `${snapshot}.staging-${process.pid}`;
    mkdirSync(staging);
    for (const file of Object.keys(manifest.files)) {
      const dest = path.join(staging, file);
      mkdirSync(path.dirname(dest), { recursive: true });
      copyFileSync(path.join(vendor, file), dest);
    }
    verify(staging, manifest.files);
    renameSync(staging, snapshot);
  }
  for (const link of links) {
    if (apply && (!existsSync(link.entry) || realpathSync(link.entry) !== realpathSync(link.target))) {
      if (present(link.entry)) unlinkSync(link.entry);
      mkdirSync(path.dirname(link.entry), { recursive: true });
      symlinkSync(link.target, link.entry);
    }
  }
  return links.map(({ provider, name }) => `vendor ${provider}: ${name} ${apply ? "linked" : "verified (dry-run)"}`);
}

export function checkUpstream(manifest, query = (url, ref) => {
  const r = spawnSync("git", ["ls-remote", "--exit-code", url, ref], { encoding: "utf8", timeout: 20000 });
  if (r.status !== 0) throw new Error(`upstream query failed: ${url}`);
  return r.stdout.trim().split(/\s+/)[0];
}) {
  return manifest.upstreams.map(({ url, ref, commit }) => {
    const remote = query(url, ref);
    if (!/^[a-f0-9]{40}$/.test(remote)) throw new Error(`invalid upstream response: ${url}`);
    return { url, pinned: commit, remote, drift: remote !== commit };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const vendor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../vendor");
    const manifest = JSON.parse(readFileSync(path.join(vendor, "manifest.json")));
    verify(vendor, manifest.files);
    if (process.argv[2] === "--check-upstream") {
      const results = checkUpstream(manifest);
      console.log(JSON.stringify(results, null, 2));
      process.exitCode = results.some((r) => r.drift) ? 3 : 0;
    } else if (!process.argv[2] || process.argv[2] === "--check") console.log(`vendor hashes OK: ${Object.keys(manifest.files).length} files`);
    else throw new Error("usage: vendor-skills.mjs [--check|--check-upstream]");
  } catch (e) { console.error(e.message); process.exitCode = 2; }
}
