// One T3 project per repo per Mac. T3 joins the Macs' projects into one by repository key,
// so a second registration on the same Mac shows up as an extra project, and settings
// (icon, favicon, title, scripts) are per machine and must be copied by hand.
// The key rules below port t3code packages/shared/src/git.ts (normalizeGitRemoteUrl) and
// apps/server/src/project/RepositoryIdentityResolver.ts; keep them in step with those.
export const SYNCED_FIELDS = ["title", "icon", "favicon", "scripts"];

const lowerCaseRemote = (value) =>
  value
    .trim()
    .replace(/\/+$/g, "")
    .replace(/\.git$/i, "")
    .toLowerCase();

export function canonicalRepoKey(remoteUrl) {
  const normalized = lowerCaseRemote(remoteUrl ?? "");
  if (/^(?:ssh|https?|git):\/\//i.test(normalized)) {
    try {
      const url = new URL(normalized);
      const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
      if (url.hostname && segments.length > 1) return `${url.hostname}/${segments.join("/")}`;
    } catch {
      return null;
    }
  }
  const scp = /^[a-z]:/i.test(normalized)
    ? null
    : /^(?:[a-zA-Z0-9._-]+@)?([^@:/\\\s]+):\/?([^/\s]+(?:\/[^/\s]+)+)$/i.exec(normalized);
  return scp ? `${scp[1]}/${scp[2]}` : null;
}

function isLocalRemoteUrl(url) {
  if (/^file:/i.test(url)) return true;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return false;
  if (/^[a-z]:[\\/]/i.test(url)) return true;
  const colon = url.indexOf(":");
  const slash = url.search(/[\\/]/);
  return colon === -1 || (slash !== -1 && slash < colon);
}

// `git remote -v` output -> the key T3 groups by: the origin remote's key when there is one,
// else the identity remote (upstream, origin, then the first remote by name).
export function groupingKeyFromRemotes(remoteVerbose) {
  const remotes = new Map();
  for (const line of remoteVerbose.split("\n")) {
    const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)(?:\s+\[[^\]]+\])?$/.exec(line.trim());
    if (match && match[3] === "fetch" && !isLocalRemoteUrl(match[2])) remotes.set(match[1], match[2]);
  }
  const identity =
    remotes.get("upstream") ??
    remotes.get("origin") ??
    [...remotes.entries()].toSorted(([a], [b]) => a.localeCompare(b))[0]?.[1];
  const url = remotes.get("origin") ?? identity;
  return url ? canonicalRepoKey(url) : null;
}

const groupBy = (items, keyOf) => {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
};

// The project at ~/Gits/<repo> when there is one, else the shortest root; ties by id.
const primaryOf = (same, key) =>
  same.toSorted(
    (a, b) =>
      Number(b.root.endsWith(`/${key.split("/").at(-1)}`)) - Number(a.root.endsWith(`/${key.split("/").at(-1)}`)) ||
      a.root.length - b.root.length ||
      a.id.localeCompare(b.id),
  )[0];

export function auditProjects(projects) {
  const findings = [];
  for (const [key, members] of groupBy(projects.filter((p) => p.key), (p) => p.key)) {
    const byHost = groupBy(members, (p) => p.host);
    for (const [host, same] of byHost) {
      if (same.length > 1) findings.push({ kind: "duplicate", key, host, ids: same.map((p) => p.id).sort() });
    }
    if (byHost.size < 2) continue;
    const primaries = [...byHost.values()].map((same) => primaryOf(same, key));
    const fields = SYNCED_FIELDS.filter((field) => new Set(primaries.map((p) => p[field] ?? null)).size > 1);
    if (fields.length > 0) findings.push({ kind: "drift", key, fields });
  }
  return findings;
}

export function precheckRegistration(projects, host, remoteUrl) {
  const key = canonicalRepoKey(remoteUrl);
  if (!key) return { ok: false, error: "unparsable remote" };
  const existing = projects.find((p) => p.host === host && p.key === key);
  return existing ? { ok: false, reuse: { id: existing.id, root: existing.root } } : { ok: true };
}
