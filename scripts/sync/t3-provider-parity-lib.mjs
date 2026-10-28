import { createHash } from "node:crypto";

// The T3 provider set every Mac must share byte-for-byte. Default model
// selections are per-Mac user preferences and stay out.
export const PARITY_KEYS = ["providerInstances", "providerModelPreferences"];

export const VERSION_BINARIES = ["~/.local/bin/codex", "~/.local/bin/claude"];

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : isObject(value)
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
      : value;

const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

function diff(a, b, path, out) {
  if (isObject(a) && isObject(b)) {
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      diff(a[key], b[key], path ? `${path}.${key}` : key, out);
    }
    return out;
  }
  if (!same(a, b)) out.push({ path, a, b });
  return out;
}

export function compareParity(a, b) {
  const out = [];
  for (const key of PARITY_KEYS) diff(a?.[key], b?.[key], key, out);
  return out;
}

export function validateSettings(settings, host) {
  if (!isObject(settings) || !isObject(settings.providerInstances)) {
    throw new Error(`${host}: settings have no providerInstances object`);
  }
  if ("providerModelPreferences" in settings && !isObject(settings.providerModelPreferences)) {
    throw new Error(`${host}: providerModelPreferences is not an object`);
  }
  return settings;
}

// Provider configs can hold inline secrets, so a report names shapes, never values.
export function redact(value) {
  if (value === undefined) return "<absent>";
  if (isObject(value)) return `object{${Object.keys(value).sort().join(",")}}`;
  const json = JSON.stringify(canonical(value));
  const kind = Array.isArray(value) ? `array[${value.length}]` : value === null ? "null" : typeof value;
  return `${kind} #${createHash("sha256").update(json).digest("hex").slice(0, 8)}`;
}

export function formatReport({ hosts, settingsDrift, versionDrift }) {
  const [left, right] = hosts;
  if (settingsDrift.length === 0 && versionDrift.length === 0) {
    return `T3 provider parity OK: ${left} == ${right}`;
  }
  const lines = [`T3 PROVIDER DRIFT between ${left} and ${right}:`];
  for (const d of settingsDrift) {
    lines.push(`  ${d.path}\n    ${left}: ${redact(d.a)}\n    ${right}: ${redact(d.b)}`);
  }
  for (const d of versionDrift) {
    lines.push(`  ${d.path}\n    ${left}: ${d.a}\n    ${right}: ${d.b}`);
  }
  lines.push("Fix: apply the same change to both Macs' ~/.t3/userdata/settings.json, then rerun.");
  return lines.join("\n");
}
