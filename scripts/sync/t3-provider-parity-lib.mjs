// The T3 provider set every Mac must share byte-for-byte. Default model
// selections are per-Mac user preferences and stay out.
export const PARITY_KEYS = ["providerInstances", "providerModelPreferences"];

export const VERSION_BINARIES = ["~/.local/bin/codex", "~/.local/bin/claude"];

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function diff(a, b, path, out) {
  if (isObject(a) && isObject(b)) {
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      diff(a[key], b[key], path ? `${path}.${key}` : key, out);
    }
    return out;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path, a, b });
  return out;
}

export function compareParity(a, b) {
  const out = [];
  for (const key of PARITY_KEYS) diff(a?.[key], b?.[key], key, out);
  return out;
}

export function formatReport({ hosts, settingsDrift, versionDrift }) {
  const [left, right] = hosts;
  if (settingsDrift.length === 0 && versionDrift.length === 0) {
    return `T3 provider parity OK: ${left} == ${right}`;
  }
  const lines = [`T3 PROVIDER DRIFT between ${left} and ${right}:`];
  for (const d of [...settingsDrift, ...versionDrift]) {
    lines.push(`  ${d.path}\n    ${left}: ${JSON.stringify(d.a)}\n    ${right}: ${JSON.stringify(d.b)}`);
  }
  lines.push("Fix: apply the same change to both Macs' ~/.t3/userdata/settings.json, then rerun.");
  return lines.join("\n");
}
