// One T3 project per repo per Mac. T3 joins the Macs' projects into one by repository key,
// so a second registration on the same Mac shows up as an extra project, and settings
// (icon, favicon, title, scripts) are per machine and must be copied by hand.
export const SYNCED_FIELDS = ["title", "icon", "favicon", "scripts"];

const REMOTE = /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i;

export function canonicalRepoKey(remoteUrl) {
  const match = REMOTE.exec(remoteUrl?.trim() ?? "");
  if (!match || !match[1].includes(".")) return null;
  return match.slice(1).join("/").toLowerCase();
}

const groupBy = (items, keyOf) => {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
};

export function auditProjects(projects) {
  const findings = [];
  for (const [key, members] of groupBy(projects.filter((p) => p.key), (p) => p.key)) {
    const byHost = groupBy(members, (p) => p.host);
    for (const [host, same] of byHost) {
      if (same.length > 1) findings.push({ kind: "duplicate", key, host, ids: same.map((p) => p.id).sort() });
    }
    if (byHost.size < 2) continue;
    // Compare each Mac's primary project, the one at the shortest root.
    const primaries = [...byHost.values()].map((same) => same.toSorted((a, b) => a.root.length - b.root.length)[0]);
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
